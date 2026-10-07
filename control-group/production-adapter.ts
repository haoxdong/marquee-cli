import { assetFromAttributes, type Asset } from '../entity/index.js';
import { record, text } from '../lib/json-value.js';
import { ControlGroupApi } from '../api/control-group/index.js';
import { MarqueeError } from '../transport/index.js';
import type { Endpoint, HttpRequestInit } from '../transport/index.js';
import type {
  ControlGroupError,
  ControlGroupExpansion,
  ControlGroupResult,
} from './types.js';
import type { ControlGroupAdapter } from './port.js';

const EXPANSION_LIMIT = 100;
const MATCH_HEDGE_DELAYS_MS = [500, 1250];

type ControlGroupRequestInit = HttpRequestInit & { hedgeDelaysMs?: number[] };
type ControlGroupTransport = {
  request(endpoint: Endpoint, init?: ControlGroupRequestInit): Promise<unknown>;
};

function decodeAsset(value: Record<string, unknown>): Asset | undefined {
  return assetFromAttributes(value, text(value.constituentId) ?? text(value.assetId));
}

function dependencyError(
  error: unknown,
  controlGroupIds: readonly string[],
): ControlGroupError {
  if (error instanceof MarqueeError) {
    if (error.details?.status === 403) {
      return { kind: 'access-denied', controlGroupIds };
    }
    if (error.code === 'auth_expired') {
      return {
        kind: 'dependency',
        controlGroupIds,
        failure: { kind: 'authentication-required', realm: 'marquee' },
      };
    }
    if (error.details?.status === 429) {
      return {
        kind: 'dependency',
        controlGroupIds,
        failure: { kind: 'rate-limited' },
      };
    }
    if (error.code === 'timeout') {
      return {
        kind: 'dependency',
        controlGroupIds,
        failure: { kind: 'timeout' },
      };
    }
    if (error.details?.isCanceled === true) {
      return {
        kind: 'dependency',
        controlGroupIds,
        failure: { kind: 'cancelled' },
      };
    }
  }
  return {
    kind: 'dependency',
    controlGroupIds,
    failure: { kind: 'unavailable' },
  };
}

function malformedMemberError(
  controlGroupIds: readonly string[],
  problem: Extract<ControlGroupError, { kind: 'malformed-member' }>['problem'] = 'invalid-response',
): ControlGroupError {
  return { kind: 'malformed-member', controlGroupIds, problem };
}

function decodeMembers(
  response: unknown,
  controlGroupIds: readonly string[],
): ControlGroupResult<readonly Asset[]> {
  const results = record(response)?.results;
  if (!Array.isArray(results)) {
    return {
      ok: false,
      error: malformedMemberError(controlGroupIds),
    };
  }
  const members = results.map((value) => {
    const member = record(value);
    return member ? decodeAsset(member) : undefined;
  });
  if (members.some((member) => member === undefined)) {
    return {
      ok: false,
      error: malformedMemberError(controlGroupIds),
    };
  }
  return { ok: true, value: members as Asset[] };
}

type ExpansionBatch = Readonly<{
  controlGroupIds: readonly string[];
  results: readonly Record<string, unknown>[];
  complete: boolean;
}>;

class ExpansionBatchFailure extends Error {
  constructor(readonly controlGroupError: ControlGroupError) {
    super(controlGroupError.kind);
  }
}

function expansionBatch(
  response: unknown,
  controlGroupIds: readonly string[],
): ControlGroupResult<ExpansionBatch> {
  const source = record(response);
  const results = source?.results;
  if (!Array.isArray(results)) {
    return {
      ok: false,
      error: malformedMemberError(controlGroupIds),
    };
  }
  const decoded = results.map(record);
  if (!decoded.every((value): value is Record<string, unknown> => value !== undefined)) {
    return {
      ok: false,
      error: malformedMemberError(controlGroupIds),
    };
  }
  const totalResults = source?.total_results;
  if (totalResults !== undefined && (
    !Number.isInteger(totalResults) || Number(totalResults) < 0
  )) {
    return {
      ok: false,
      error: malformedMemberError(controlGroupIds),
    };
  }
  return {
    ok: true,
    value: {
      controlGroupIds,
      results: decoded,
      complete: typeof totalResults === 'number' && totalResults <= decoded.length,
    },
  };
}

async function requestExpansionBatch(
  transport: ControlGroupTransport,
  controlGroupIds: readonly string[],
): Promise<ControlGroupResult<ExpansionBatch>> {
  try {
    const response = await new ControlGroupApi(transport).getConstituents({
      groupIds: controlGroupIds,
      limit: EXPANSION_LIMIT,
    });
    return expansionBatch(response, controlGroupIds);
  } catch (error) {
    return { ok: false, error: dependencyError(error, controlGroupIds) };
  }
}

async function requestExpansionBatchOrThrow(
  transport: ControlGroupTransport,
  controlGroupId: string,
): Promise<ExpansionBatch> {
  const result = await requestExpansionBatch(transport, [controlGroupId]);
  if (!result.ok) throw new ExpansionBatchFailure(result.error);
  return result.value;
}

async function loadExpansionBatches(
  transport: ControlGroupTransport,
  controlGroupIds: readonly string[],
): Promise<ControlGroupResult<readonly ExpansionBatch[]>> {
  const first = await requestExpansionBatch(transport, controlGroupIds);
  if (!first.ok) return first;
  if (
    controlGroupIds.length <= 1
    || first.value.results.length < EXPANSION_LIMIT
    || first.value.complete
  ) {
    return { ok: true, value: [first.value] };
  }
  try {
    return {
      ok: true,
      value: await Promise.all(controlGroupIds.map((controlGroupId) => (
        requestExpansionBatchOrThrow(transport, controlGroupId)
      ))),
    };
  } catch (error) {
    if (error instanceof ExpansionBatchFailure) {
      return { ok: false, error: error.controlGroupError };
    }
    throw error;
  }
}

function decodeExpansions(
  batches: readonly ExpansionBatch[],
  controlGroupIds: readonly string[],
): ControlGroupResult<readonly ControlGroupExpansion[]> {
  const memberships = new Map(controlGroupIds.map((controlGroupId) => (
    [controlGroupId, [] as Asset[]]
  )));
  for (const batch of batches) {
    if (batch.results.length >= EXPANSION_LIMIT && !batch.complete) {
      return {
        ok: false,
        error: malformedMemberError(batch.controlGroupIds, 'incomplete-expansion'),
      };
    }
    for (const value of batch.results) {
      const member = decodeAsset(value);
      const evidenceGroupIds = value.controlGroups;
      if (!member || !Array.isArray(evidenceGroupIds) || !evidenceGroupIds.every(
        (id): id is string => typeof id === 'string',
      )) {
        return {
          ok: false,
          error: malformedMemberError(batch.controlGroupIds),
        };
      }
      const memberGroupIds = batch.controlGroupIds.length === 1
        ? batch.controlGroupIds
        : evidenceGroupIds;
      for (const groupId of memberGroupIds) memberships.get(groupId)?.push(member);
    }
  }
  return {
    ok: true,
    value: controlGroupIds.map((controlGroupId) => ({
      controlGroupId,
      members: memberships.get(controlGroupId) ?? [],
    })),
  };
}

export function createControlGroupProductionAdapter(
  transport: ControlGroupTransport,
): ControlGroupAdapter {
  return {
    async expand(controlGroupIds, signal) {
      const expansionTransport = signal ? {
        request: (endpoint: Endpoint, init?: ControlGroupRequestInit) => transport.request(
          endpoint,
          { ...init, signal },
        ),
      } : transport;
      const batches = await loadExpansionBatches(expansionTransport, controlGroupIds);
      return batches.ok ? decodeExpansions(batches.value, controlGroupIds) : batches;
    },
    async match(controlGroupIds, query, limit) {
      try {
        const response = await new ControlGroupApi({
          request: (endpoint, init) => transport.request(endpoint, { ...init, hedgeDelaysMs: MATCH_HEDGE_DELAYS_MS }),
        }).getConstituents({
          groupIds: controlGroupIds,
          query,
          limit,
        });
        return decodeMembers(response, controlGroupIds);
      } catch (error) {
        return { ok: false, error: dependencyError(error, controlGroupIds) };
      }
    },
  };
}
