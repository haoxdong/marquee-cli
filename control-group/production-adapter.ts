import { assetFromAttributes, type Asset } from '../entity/index.js';
import { record, text } from '../lib/json-value.js';
import { ControlGroupApi } from '../api/control-group/index.js';
import { MarqueeError } from '../transport/index.js';
import type { Endpoint, HttpRequestInit } from '../transport/index.js';
import { allOk } from '../lib/result.js';
import type {
  ControlGroupError,
  ControlGroupExpansion,
  ControlGroupResult,
} from './types.js';
import type { ControlGroupAdapter } from './port.js';

const EXPANSION_LIMIT = 100;

type ControlGroupTransport = {
  request(endpoint: Endpoint, init?: HttpRequestInit): Promise<unknown>;
};

function decodeAsset(value: Record<string, unknown>): Asset | undefined {
  return assetFromAttributes(value, text(value.constituentId) ?? text(value.assetId));
}

function dependencyError(
  error: unknown,
  controlGroupIds: readonly string[],
): ControlGroupError {
  if (error instanceof MarqueeError && error.details?.status === 403) {
    return { kind: 'access-denied', controlGroupIds };
  }
  return { kind: 'dependency', controlGroupIds, failure: dependencyFailure(error) };
}

function dependencyFailure(
  error: unknown,
): Extract<ControlGroupError, { kind: 'dependency' }>['failure'] {
  if (!(error instanceof MarqueeError)) return { kind: 'unavailable' };
  if (error.code === 'auth_expired') return { kind: 'authentication-required', realm: 'marquee' };
  if (error.details?.status === 429) return { kind: 'rate-limited' };
  if (error.code === 'timeout') return { kind: 'timeout' };
  if (error.details?.isCanceled === true) return { kind: 'cancelled' };
  const answer = error.marqueeAnswer();
  return answer === undefined ? { kind: 'unavailable' } : { kind: 'unavailable', ...answer };
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
  const members = Array.isArray(results)
    ? results.map((value) => {
        const member = record(value);
        return member ? decodeAsset(member) : undefined;
      })
    : undefined;
  if (!members?.every((member): member is Asset => member !== undefined)) {
    return { ok: false, error: malformedMemberError(controlGroupIds) };
  }
  return { ok: true, value: members };
}

type ExpansionBatch = Readonly<{
  controlGroupIds: readonly string[];
  results: readonly Record<string, unknown>[];
  complete: boolean;
}>;

function expansionBatch(
  response: unknown,
  controlGroupIds: readonly string[],
): ControlGroupResult<ExpansionBatch> {
  const source = record(response);
  const results = source?.results;
  const decoded = Array.isArray(results) ? results.map(record) : [];
  const totalResults = source?.total_results;
  if (
    !Array.isArray(results)
    || !decoded.every((value): value is Record<string, unknown> => value !== undefined)
    || (totalResults !== undefined && (!Number.isInteger(totalResults) || Number(totalResults) < 0))
  ) {
    return { ok: false, error: malformedMemberError(controlGroupIds) };
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
  return allOk(controlGroupIds.map((controlGroupId) => (
    requestExpansionBatch(transport, [controlGroupId])
  )));
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
        request: (endpoint: Endpoint, init?: HttpRequestInit) => transport.request(
          endpoint,
          { ...init, signal },
        ),
      } : transport;
      const batches = await loadExpansionBatches(expansionTransport, controlGroupIds);
      return batches.ok ? decodeExpansions(batches.value, controlGroupIds) : batches;
    },
    async match(controlGroupIds, query, limit) {
      try {
        const response = await new ControlGroupApi(transport).getConstituents({
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
