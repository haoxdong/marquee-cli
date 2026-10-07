import type { DependencyFailure, Transport } from '../transport/index.js';
import {
  createWidgetConfigurationProjectionPort,
} from './adapters/production.js';
import type { WidgetError } from './types.js';

type ConfiguredWidgetIdentity = Readonly<{
  widgetId: string;
  configurationId: string;
}>;

type ConfiguredWidgetProjection = Readonly<{
  widget: ConfiguredWidgetIdentity;
  bindings: readonly Readonly<{ field: string; value: unknown }>[];
  dateRangeOverride?: string;
}>;

type ConfiguredWidgetProjectionError =
  | { kind: 'access-denied' }
  | { kind: 'not-found' }
  | { kind: 'dependency'; failure: DependencyFailure }
  | {
      kind: 'invalid-projection';
      problem: 'invalid-identity' | 'malformed-binding' | 'unsupported-configuration';
    };

type ConfiguredWidgetProjectionResult =
  | { ok: true; value: ConfiguredWidgetProjection }
  | { ok: false; error: ConfiguredWidgetProjectionError };

function projectionFailure(error: WidgetError): ConfiguredWidgetProjectionError {
  if (error.kind === 'widget-access-denied') {
    return { kind: 'access-denied' };
  }
  if (error.kind === 'configuration-not-found') {
    return { kind: 'not-found' };
  }
  if (error.kind === 'widget-load-failure') {
    return {
      kind: 'dependency',
      failure: error.failure,
    };
  }
  return {
    kind: 'invalid-projection',
    problem: 'unsupported-configuration',
  };
}

function binding(value: unknown): Readonly<{ field: string; value: unknown }> | undefined {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || !('field' in value)
    || typeof value.field !== 'string'
    || !('value' in value)
  ) {
    return undefined;
  }
  return { field: value.field, value: value.value };
}

function isConfiguredWidgetIdentity(
  identity: ConfiguredWidgetIdentity,
): boolean {
  return /^MW[A-Z0-9_]+$/i.test(identity.widgetId)
    && /^WC[A-Z0-9_]+$/i.test(identity.configurationId);
}

export function createConfiguredWidgetProjection(
  transport: Pick<Transport, 'request'>,
): {
  project(input: {
    widget: ConfiguredWidgetIdentity;
    purpose: 'create' | 'add';
  }): Promise<ConfiguredWidgetProjectionResult>;
} {
  const configuration = createWidgetConfigurationProjectionPort(transport);
  return {
    async project(input) {
      if (!isConfiguredWidgetIdentity(input.widget)) {
        return {
          ok: false,
          error: {
            kind: 'invalid-projection',
            problem: 'invalid-identity',
          },
        };
      }
      if (input.purpose === 'create') {
        return {
          ok: true,
          value: {
            widget: input.widget,
            bindings: [],
          },
        };
      }
      const result = await configuration.resolve(input.widget.configurationId);
      if (!result.ok) return { ok: false, error: projectionFailure(result.error) };
      const bindings = result.value.parameters.map(binding);
      if (bindings.some((value) => value === undefined)) {
        return {
          ok: false,
          error: {
            kind: 'invalid-projection',
            problem: 'malformed-binding',
          },
        };
      }
      return {
        ok: true,
        value: {
          widget: input.widget,
          bindings: bindings as Readonly<{ field: string; value: unknown }>[],
          ...(result.value.relativeDate
            ? { dateRangeOverride: result.value.relativeDate }
            : {}),
        },
      };
    },
  };
}
