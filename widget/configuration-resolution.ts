import type { WidgetError, WidgetResult } from './types.js';
import type {
  WidgetPersistenceAnchorPort,
  WidgetPersistenceAnchors,
} from './persistence-anchor.js';

export async function resolveWidgetConfiguration(
  port: WidgetPersistenceAnchorPort,
  configurationId: string,
  mapThrown: (error: unknown) => WidgetError,
): Promise<WidgetResult<WidgetPersistenceAnchors>> {
  try {
    const result = await port.resolve(configurationId);
    if (result.ok) return { ok: true, value: result.value };
    if (result.error.kind === 'not-found') {
      return {
        ok: false,
        error: {
          kind: 'configuration-not-found',
          identity: { widgetId: '', configurationId },
        },
      };
    }
    if (result.error.kind === 'access-denied') {
      return {
        ok: false,
        error: { kind: 'widget-access-denied', identity: { widgetId: '' } },
      };
    }
    return {
      ok: false,
      error: {
        kind: 'widget-load-failure',
        identity: { widgetId: '' },
        failure: result.error.failure,
      },
    };
  } catch (error) {
    return { ok: false, error: mapThrown(error) };
  }
}
