import { MarketViewApi } from '../../api/marketview/index.js';
import { WidgetApi } from '../../api/widget/index.js';
import type { Endpoint, HttpRequestInit } from '../../transport/index.js';
import { MarqueeError } from '../../transport/index.js';
import {
  type WidgetDates,
  type WidgetParameterOverride,
} from '../../widget/index.js';
import { parseConfigId, parseWidgetId } from '../../widget/identifiers.js';
import type {
  EntityFeedEntry,
  EntityFeedError,
  EntityFeedResult,
} from '../types.js';
import type {
  EntityFeedAdapter,
  EntityFeedSource,
} from '../module.js';
import { record, text } from '../../lib/json-value.js';
import { decodeWidgetPin, normalizedId, type WidgetPin } from '../../lib/widget-pin.js';

type EntityFeedTransport = {
  request(endpoint: Endpoint, init?: HttpRequestInit): Promise<unknown>;
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  const result = record(value);
  if (!result) throw new Error(`Malformed Entity Feed Widget entry: ${label} is not a record`);
  return result;
}

function requiredText(value: unknown, label: string): string {
  const result = text(value);
  if (!result) throw new Error(`Malformed Entity Feed Widget entry: ${label} is not a string`);
  return result;
}

function widgetConfigId(widget: Record<string, unknown>): unknown {
  const metadata = record(widget.metadata);
  const configuration = record(widget.configuration);
  const metadataConfiguration = record(metadata?.configuration);
  const metadataConfig = record(metadata?.config);
  return [
    widget.configurationId,
    widget.configId,
    typeof widget.config === 'string' ? widget.config : undefined,
    configuration?.id,
    metadata?.configurationId,
    metadata?.configId,
    metadataConfiguration?.id,
    metadataConfig?.id,
  ].find((value) => value !== undefined && value !== null);
}

function assignmentValue(control: Record<string, unknown>): unknown {
  if ('value' in control) return control.value;
  if ('default' in control) return control.default;
  return record(control.values)?.default;
}

function widgetParameterOverrides(
  widget: Record<string, unknown>,
): WidgetParameterOverride[] {
  if (widget.renderParams === undefined || widget.renderParams === null) return [];
  const renderParams = requiredRecord(widget.renderParams, 'renderParams');
  const assignments: WidgetParameterOverride[] = [];
  const componentFields = new Set<string>();
  if (renderParams.component !== undefined && renderParams.component !== null) {
    const component = requiredRecord(renderParams.component, 'renderParams.component');
    for (const [field, value] of Object.entries(component)) {
      componentFields.add(field);
      assignments.push({ field, value });
    }
  }
  if (renderParams.controls === undefined || renderParams.controls === null) {
    return assignments;
  }
  if (!Array.isArray(renderParams.controls)) {
    throw new Error('Malformed Entity Feed Widget entry: renderParams.controls is not an array');
  }
  for (const [index, value] of renderParams.controls.entries()) {
    const control = requiredRecord(value, `renderParams.controls[${index}]`);
    const field = text(control.field) ?? text(control.id);
    if (!field) {
      throw new Error(
        `Malformed Entity Feed Widget entry: renderParams.controls[${index}] has no field`,
      );
    }
    if (componentFields.has(field)) continue;
    const assigned = assignmentValue(control);
    if (assigned === undefined) {
      throw new Error(
        `Malformed Entity Feed Widget entry: renderParams.controls[${index}] has no value`,
      );
    }
    assignments.push({ field, value: assigned });
  }
  return assignments;
}

function relativeDate(
  widget: Record<string, unknown>,
  assignments: readonly WidgetParameterOverride[],
): string | undefined {
  const assigned = assignments
    .filter(({ field }) => /^relative(?:\s+)?date$/i.test(field))
    .at(-1)?.value;
  if (widget.relativeDate === undefined || widget.relativeDate === null) {
    return assigned === undefined
      ? undefined
      : requiredText(assigned, 'Relative Date assignment');
  }
  return requiredText(widget.relativeDate, 'relativeDate');
}

function widgetDates(
  widget: Record<string, unknown>,
  assignedRelativeDate: string | undefined,
): WidgetDates | undefined {
  if (widget.calculatedDates === undefined || widget.calculatedDates === null) {
    return undefined;
  }
  const calculated = requiredRecord(widget.calculatedDates, 'calculatedDates');
  return {
    startDate: requiredText(calculated.startDate, 'calculatedDates.startDate'),
    endDate: requiredText(calculated.endDate, 'calculatedDates.endDate'),
    interval: requiredText(calculated.interval, 'calculatedDates.interval'),
    ...(assignedRelativeDate ? { relativeDate: assignedRelativeDate } : {}),
  };
}

function decodeEntry(
  value: unknown,
  entityId: string,
): EntityFeedEntry | undefined {
  const widget = record(value);
  // Stryker disable next-line StringLiteral: any fallback lacking the MW prefix parses to no Widget ID
  const widgetId = parseWidgetId(normalizedId(text(widget?.id) ?? ''));
  const title = text(widget?.title);
  if (!widget || !widgetId || !title) return undefined;
  const rawConfigId = widgetConfigId(widget);
  const configId = typeof rawConfigId === 'string' ? parseConfigId(normalizedId(rawConfigId)) : undefined;
  if (rawConfigId !== undefined && !configId) return undefined;
  const assignments = widgetParameterOverrides(widget);
  const assignedRelativeDate = relativeDate(widget, assignments);
  const dates = widgetDates(widget, assignedRelativeDate);
  const rank = finiteNumber(widget.rank);
  return {
    widgetId,
    title,
    ...(rank !== undefined ? { rank } : {}),
    ...(configId ? { configurationId: configId } : {}),
    widgetDefinition: widget,
    widgetParameterOverrides: assignments.filter(
      ({ field }) => !/^relative(?:\s+)?date$/i.test(field),
    ),
    selectedContext: text(record(widget.contextParameter)?.field) ? entityId : null,
    ...(dates ? { widgetDates: dates } : {}),
  };
}

function widgetValues(value: unknown): unknown[] | undefined {
  const root = record(value);
  if (!root) return undefined;
  if (Array.isArray(root.results)) return root.results;
  const results = record(record(root.resultsMap)?.widgets)?.results;
  return Array.isArray(results) ? results : undefined;
}

function decodeWidgets(
  value: unknown,
  entityId: string,
): EntityFeedResult<Pick<EntityFeedSource, 'entries' | 'total'>> {
  const root = record(value);
  const values = widgetValues(value);
  if (!root || !values) {
    return { ok: false, error: { kind: 'invalid-feed', problem: 'response' } };
  }
  const entries = values.map((entry) => decodeEntry(entry, entityId));
  if (!entries.every((entry): entry is EntityFeedEntry => entry !== undefined)) {
    return { ok: false, error: { kind: 'invalid-feed', problem: 'widget-entry' } };
  }
  const resultMapWidgets = record(record(root.resultsMap)?.widgets);
  const total = finiteNumber(root.total_results)
    ?? finiteNumber(resultMapWidgets?.total)
    ?? entries.length;
  return { ok: true, value: { entries, total } };
}

function decodePins(value: unknown): WidgetPin[] {
  const root = record(value);
  const nestedPins = record(root?.value)?.pins;
  const pins = Array.isArray(nestedPins) ? nestedPins : root?.pins;
  if (!Array.isArray(pins)) return [];
  return pins.map(decodeWidgetPin).filter((pin): pin is WidgetPin => pin !== undefined);
}

export function createEntityFeedProductionAdapter(
  transport: EntityFeedTransport,
): EntityFeedAdapter {
  const sourceFailure = (source: 'feed' | 'preferences', error: unknown) => ({
    ok: false as const,
    error: {
      kind: 'dependency' as const,
      source,
      failure: error instanceof MarqueeError
        ? error.dependencyFailure()
        : { kind: 'unavailable' as const },
    } satisfies EntityFeedError,
  });
  const feed = new WidgetApi(transport);
  return {
    async read(entityId) {
      const settle = async (source: 'feed' | 'preferences', promise: Promise<unknown>) => {
        try {
          return { ok: true as const, value: await promise };
        } catch (error) {
          return sourceFailure(source, error);
        }
      };
      const [widgetsRaw, preferencesRaw] = await Promise.all([
        settle('feed', feed.getWidgets({ context: entityId })),
        settle('preferences', new MarketViewApi(transport).getPreferences()),
      ]);
      if (!widgetsRaw.ok) return { ok: false, error: widgetsRaw.error };
      if (!preferencesRaw.ok) return { ok: false, error: preferencesRaw.error };
      let decoded;
      try {
        decoded = decodeWidgets(widgetsRaw.value, entityId);
      } catch {
        return {
          ok: false,
          error: { kind: 'invalid-feed', problem: 'widget-entry' },
        };
      }
      if (!decoded.ok) return decoded;
      return {
        ok: true,
        value: {
          ...decoded.value,
          pins: decodePins(preferencesRaw.value),
        },
      };
    },
    async page(entityId, page) {
      try {
        const raw = await feed.getWidgets({
          context: entityId,
          limit: page.limit,
          offset: page.offset,
          query: page.query,
        });
        return decodeWidgets(raw, entityId);
      } catch (error) {
        return sourceFailure('feed', error);
      }
    },
  };
}
