import { MarketViewApi } from '../../api/marketview/index.js';
import {
  MarqueeError,
  type DependencyFailure,
  type Transport,
} from '../../transport/index.js';
import { record } from '../../lib/json-value.js';
import { decodeWidgetPin, type WidgetPin } from '../../lib/widget-pin.js';

export type DashboardPreferencesError =
  | Readonly<{
      kind: 'dependency';
      failure: DependencyFailure;
    }>
  | Readonly<{
      kind: 'invalid-response';
      problem: 'response' | 'pin-entry';
    }>;

type DashboardPreferencesResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DashboardPreferencesError };

export type DashboardPreferencesReader = () => Promise<
  DashboardPreferencesResult<readonly WidgetPin[]>
>;

function decodePins(
  value: unknown,
): DashboardPreferencesResult<readonly WidgetPin[]> {
  const root = record(value);
  if (root && Object.keys(root).length === 0) {
    return { ok: true, value: [] };
  }
  const nestedPins = record(root?.value)?.pins;
  const pins = Array.isArray(nestedPins)
    ? nestedPins
    : root?.pins;
  if (!Array.isArray(pins)) {
    return { ok: false, error: { kind: 'invalid-response', problem: 'response' } };
  }
  const decoded = pins.map(decodeWidgetPin);
  if (decoded.some((pin) => pin === undefined)) {
    return { ok: false, error: { kind: 'invalid-response', problem: 'pin-entry' } };
  }
  return { ok: true, value: decoded as WidgetPin[] };
}

function preferenceFailure(error: unknown): DashboardPreferencesError {
  return {
    kind: 'dependency',
    failure: error instanceof MarqueeError
      ? error.dependencyFailure()
      : { kind: 'unavailable' },
  };
}

export function createDashboardPreferencesReader(
  requester: ReturnType<Transport['provider']>,
): DashboardPreferencesReader {
  return async () => {
    try {
      const raw = await new MarketViewApi(requester).getPreferences();
      return decodePins(raw);
    } catch (error) {
      return { ok: false, error: preferenceFailure(error) };
    }
  };
}
