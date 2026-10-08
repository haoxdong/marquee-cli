import { MarketViewApi } from '../../../api/marketview/index.js';
import { MarqueeError, type Endpoint } from '../../../transport/index.js';
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
import type { MarketViewSearchError, MarketViewSearchSelector } from '../types.js';
import {
  type WidgetDates,
} from '../../../widget/index.js';
import { parseConfigId, parseWidgetId } from '../../../widget/identifiers.js';
import {
  isMarketViewSearchWidgetSelector,
  MARKET_VIEW_SEARCH_WIDGET_MODES,
  type MarketViewSearchDiscoveryDashboard,
  type MarketViewSearchDiscoveryEntity,
  type MarketViewSearchDiscoveryEntry,
  type MarketViewSearchDiscoveryWidget,
  type MarketViewSearchPort,
  type MarketViewSearchWidgetSelector,
} from '../module.js';

type MarketViewSearchRequestInit = Readonly<{
  query?: Readonly<Record<string, unknown>>;
  signal?: AbortSignal;
  hedgeDelaysMs?: readonly number[];
  retry?: false;
}>;

export interface MarketViewSearchRequester {
  request(endpoint: Endpoint, init?: MarketViewSearchRequestInit): Promise<unknown>;
}

type ProviderEntry = Record<string, unknown> & {
  data?: Record<string, unknown>;
};

type SearchRaw = Record<string, unknown> & {
  resultsMap?: Record<string, unknown>;
};

class MarketViewSearchDecodeError extends Error {}

type ProviderProjection = Readonly<{
  types: readonly string[];
  newSchema: boolean;
}>;

type NonWidgetSelector = Exclude<
  MarketViewSearchSelector,
  MarketViewSearchWidgetSelector
>;

const NON_WIDGET_SELECTOR_ORDER: readonly NonWidgetSelector[] = [
  'thematic',
  'asset',
  'country',
  'portfolio',
];

const PROVIDER_PROJECTIONS: Readonly<Record<MarketViewSearchSelector, ProviderProjection>> = {
  'keyword-widget': { types: ['Widget'], newSchema: false },
  'semantic-widget': { types: ['Widget LLM'], newSchema: false },
  'hybrid-widget': { types: ['Widget', 'Widget LLM', 'Widget Ranked'], newSchema: true },
  thematic: { types: ['Dashboard'], newSchema: false },
  asset: { types: ['Asset'], newSchema: false },
  country: { types: ['Country'], newSchema: false },
  portfolio: { types: ['Portfolio'], newSchema: false },
};

function providerProjection(selectors: readonly MarketViewSearchSelector[]): ProviderProjection {
  const definitions = selectors.map((selector) => PROVIDER_PROJECTIONS[selector]);
  return {
    types: [...new Set(definitions.flatMap((definition) => definition.types))],
    newSchema: definitions.some((definition) => definition.newSchema),
  };
}

function unsupported(reason: string): never {
  throw new MarketViewSearchDecodeError(
    `Unsupported MarketView search response shape: ${reason}; record a Scenario before accepting this fallback.`,
  );
}

function requiredRecord(value: unknown, reason: string): Record<string, unknown> {
  return isRecord(value) ? value : unsupported(reason);
}

function requiredString(value: unknown, reason: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : unsupported(reason);
}

function requiredArray(value: unknown, reason: string): unknown[] {
  return Array.isArray(value) ? value : unsupported(reason);
}

function marketViewUrl(value: unknown, reason: string): string {
  const path = requiredString(value, reason);
  if (!path.startsWith('/')) unsupported(reason);
  return `https://marquee.gs.com${path}`;
}

function entries(map: Record<string, unknown>, key: string): ProviderEntry[] {
  const value = map[key];
  if (value === undefined) return [];
  return requiredArray(value, `${key} bucket is not an array`).map(
    (entry) => requiredRecord(entry, `${key} entry is not an object`) as ProviderEntry,
  );
}

function widgetEntriesForMode(
  map: Record<string, unknown>,
  selector: MarketViewSearchWidgetSelector,
  ranked: readonly ProviderEntry[],
): ProviderEntry[] {
  if (selector === 'keyword-widget') return entries(map, 'widgets');
  if (selector === 'semantic-widget') return entries(map, 'widgets_llm');
  return ranked.length > 0
    ? [...ranked]
    : [...entries(map, 'widgets'), ...entries(map, 'widgets_llm')];
}

function orderedNonWidgetSelectors(
  selectors: readonly MarketViewSearchSelector[],
): NonWidgetSelector[] {
  const requested = [...new Set(selectors.filter(
    (selector): selector is NonWidgetSelector => !isMarketViewSearchWidgetSelector(selector),
  ))];
  const requestedSet = new Set(requested);
  return [
    ...requested,
    ...NON_WIDGET_SELECTOR_ORDER.filter((selector) => !requestedSet.has(selector)),
  ];
}

function entryData(entry: ProviderEntry, bucket: string): Record<string, unknown> {
  return requiredRecord(entry.data, `${bucket} entry missing data`);
}

function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === 'string' ? value : undefined;
}

function renderAssignmentValue(control: Record<string, unknown>): unknown {
  if ('value' in control) return control.value;
  if ('default' in control) return control.default;
  return isRecord(control.values) ? control.values.default : undefined;
}

function renderControlField(control: Record<string, unknown>): string | null {
  if ('field' in control) {
    const field = control.field;
    if (typeof field !== 'string' || field.length === 0) {
      unsupported('widget entry renderParams control missing field');
    }
    return field;
  }
  if (typeof control.id !== 'string') {
    unsupported('widget entry renderParams control missing field');
  }
  // The provider ships `id: ""` controls with no assignment identity. Marquee
  // Web renders the card, so omit the value instead of inventing a target field.
  return control.id === '' ? null : control.id;
}

function renderAssignments(data: Record<string, unknown>): Array<{
  field: string;
  value: unknown;
}> {
  if (data.renderParams === undefined || data.renderParams === null) return [];
  const renderParams = requiredRecord(
    data.renderParams,
    'widget entry renderParams is malformed',
  );
  const assignments: Array<{ field: string; value: unknown }> = [];
  const componentFields = new Set<string>();
  if (renderParams.component !== undefined && renderParams.component !== null) {
    const component = requiredRecord(
      renderParams.component,
      'widget entry renderParams.component is malformed',
    );
    for (const field of Object.keys(component)) componentFields.add(field);
    assignments.push(...Object.entries(component).map(([field, value]) => ({
      field,
      value,
    })));
  }
  if (renderParams.controls === undefined || renderParams.controls === null) {
    return assignments;
  }
  for (const value of requiredArray(
    renderParams.controls,
    'widget entry renderParams.controls is malformed',
  )) {
    const control = requiredRecord(
      value,
      'widget entry renderParams control is malformed',
    );
    const field = renderControlField(control);
    if (field === null) continue;
    if (componentFields.has(field)) continue;
    const assignment = renderAssignmentValue(control);
    if (assignment === undefined) {
      unsupported(`widget entry renderParams control ${field} missing value`);
    }
    assignments.push({ field, value: assignment });
  }
  return assignments;
}

function selectedContext(
  data: Record<string, unknown>,
  assignments: readonly Readonly<{ field: string; value: unknown }>[],
): Readonly<{ field: string; value: string }> | null {
  if (data.contextParameter === undefined || data.contextParameter === null) {
    return null;
  }
  const context = requiredRecord(
    data.contextParameter,
    'widget entry contextParameter is malformed',
  );
  if (context.field === '') {
    const contextValues = requiredRecord(
      context.values,
      'widget entry contextParameter.values is malformed',
    );
    requiredArray(
      context.options,
      'widget entry contextParameter.options is malformed',
    ).forEach((option) => requiredString(
      option,
      'widget entry contextParameter.options is malformed',
    ));
    if (
      context.elementType !== undefined
      && typeof context.elementType !== 'string'
    ) {
      unsupported('widget entry contextParameter.elementType is malformed');
    }
    if (
      context.value !== undefined
      && context.value !== null
      && context.value !== ''
    ) {
      unsupported('widget entry contextParameter.value is malformed');
    }
    const fieldlessDefault = contextValues.default;
    if (
      fieldlessDefault === undefined
      || fieldlessDefault === null
      || fieldlessDefault === ''
    ) {
      return null;
    }
    return {
      field: '',
      value: requiredString(
        fieldlessDefault,
        'widget entry contextParameter.values.default is malformed',
      ),
    };
  }
  const contextValues = isRecord(context.values) ? context.values : undefined;
  const field = requiredString(
    context.field,
    'widget entry contextParameter.field is malformed',
  );
  const assignedValue = assignments.filter((assignment) => (
    assignment.field === field
  )).at(-1)?.value;
  const value = assignedValue
    ?? context.value
    ?? contextValues?.default;
  if (value === undefined || value === null || value === '') {
    return null;
  }
  return {
    field,
    value: requiredString(
      value,
      'widget entry contextParameter.value is malformed',
    ),
  };
}

function widgetDates(
  data: Record<string, unknown>,
  relativeDate: string | null,
): WidgetDates | undefined {
  if (data.calculatedDates === undefined || data.calculatedDates === null) {
    return undefined;
  }
  const calculatedDates = requiredRecord(
    data.calculatedDates,
    'widget entry calculatedDates is malformed',
  );
  return {
    startDate: requiredString(
      calculatedDates.startDate,
      'widget entry calculatedDates.startDate is malformed',
    ),
    endDate: requiredString(
      calculatedDates.endDate,
      'widget entry calculatedDates.endDate is malformed',
    ),
    interval: requiredString(
      calculatedDates.interval,
      'widget entry calculatedDates.interval is malformed',
    ),
    ...(relativeDate ? { relativeDate } : {}),
  };
}

function decodeSearchResults(
  raw: SearchRaw,
  requestedSelectors: readonly MarketViewSearchSelector[],
  limit: number,
): MarketViewSearchDiscoveryEntry[] {
  const map = requiredRecord(raw.resultsMap, 'missing resultsMap');
  const results: MarketViewSearchDiscoveryEntry[] = [];
  const seen = new Set<string>();
  const accept = <T extends MarketViewSearchDiscoveryEntry>(entry: T): T => {
    const identity = entry.type === 'widget'
      ? entry.widgetId
      : entry.type === 'dashboard'
        ? entry.dashboardId
        : entry.entityId;
    const uniqueIdentity = entry.type === 'widget' && entry.searchMode
      ? `${entry.searchMode}:${identity}`
      : identity;
    if (seen.has(uniqueIdentity)) unsupported(`duplicate id ${identity}`);
    seen.add(uniqueIdentity);
    results.push(entry);
    return entry;
  };
  const decodeSource = (
    providers: readonly ProviderEntry[],
    decode: (provider: ProviderEntry) => void,
  ): void => {
    const firstResultIndex = results.length;
    providers.forEach(decode);
    results.splice(firstResultIndex + limit);
  };
  const widget = (
    provider: ProviderEntry,
    searchMode?: MarketViewSearchDiscoveryWidget['searchMode'],
  ) => {
    const data = entryData(provider, 'widget');
    const id = parseWidgetId(requiredString(data.id, 'widget entry missing id'))
      ?? unsupported('widget entry id is malformed');
    const metadata = isRecord(data.metadata) ? data.metadata : undefined;
    const configurationId = data.configurationId === undefined
      || data.configurationId === null
      ? null
      : parseConfigId(requiredString(
          data.configurationId,
          'widget entry configurationId is malformed',
        )) ?? unsupported('widget entry configurationId is malformed');
    const assignments = renderAssignments(data);
    const assignedRelativeDate = assignments
      .filter(({ field }) => /^relative\s+date$/i.test(field))
      .at(-1)?.value;
    const relativeDateValue = data.relativeDate ?? assignedRelativeDate;
    const relativeDate = relativeDateValue === undefined
      ? null
      : requiredString(relativeDateValue, 'widget entry relativeDate is malformed');
    const dates = widgetDates(data, relativeDate);
    const context = selectedContext(data, assignments);
    const parameters = assignments.filter(({ field }) => (
      field !== context?.field
      && !/^relative\s+date$/i.test(field)
    ));
    accept({
      type: 'widget',
      widgetId: id,
      title: requiredString(metadata?.title ?? data.title, 'widget entry missing title').trim(),
      configurationId,
      parameterLines: [],
      widgetDefinition: data,
      parameters,
      selectedContext: context?.value ?? null,
      ...(dates ? { widgetDates: dates } : {}),
      ...(searchMode ? { searchMode } : {}),
    } satisfies MarketViewSearchDiscoveryWidget);
  };
  const thematic = (provider: ProviderEntry) => {
    const data = entryData(provider, 'dashboards');
    const id = requiredString(data.id, 'thematic-dashboard entry missing id');
    const alias = data.alias;
    const dashboardType = requiredString(data.type, 'dashboards entry missing type');
    const widgetCount = requiredArray(data.children, 'dashboards entry missing children').length;
    accept({
      type: 'dashboard',
      dashboardId: id,
      title: requiredString(data.title, 'thematic-dashboard entry missing title').trim(),
      category: dashboardType === 'Dashboard'
        ? { kind: 'thematic' }
        : { kind: 'named', value: dashboardType },
      widgetCount,
      url: alias === undefined || alias === null || alias === ''
        ? marketViewUrl(data.url, 'dashboards entry missing alias and provider URL')
        : `https://marquee.gs.com/s/marketview/dashboards/${encodeURIComponent(
            requiredString(alias, 'dashboards entry missing alias'),
          )}`,
    } satisfies MarketViewSearchDiscoveryDashboard);
  };
  const asset = (provider: ProviderEntry) => {
    const data = entryData(provider, 'assets');
    const id = requiredString(data.id, 'asset-dashboard entry missing id');
    const providerType = optionalString(data, 'type');
    const qualifiers = [
      optionalString(data, 'assetClass'),
      providerType && providerType !== 'Asset' ? providerType : undefined,
      optionalString(data, 'ticker'),
      optionalString(data, 'bbid'),
    ].filter((part): part is string => Boolean(part));
    // Web keeps a blank-name Asset in place with a dead link; mirror it untitled and unlinked.
    const isUntitled = data.name === '' && data.url === undefined;
    accept({
      type: 'entity',
      entityKind: 'asset',
      entityId: id,
      label: isUntitled
        ? ''
        : requiredString(data.name, 'asset-dashboard entry missing title').trim(),
      qualifiers,
      ...(isUntitled ? {} : {
        url: data.url === undefined
          ? `https://marquee.gs.com/s/marketview/asset/${encodeURIComponent(id)}`
          : marketViewUrl(data.url, 'assets url is not slash-relative'),
      }),
    } satisfies MarketViewSearchDiscoveryEntity);
  };
  const country = (provider: ProviderEntry) => {
    const data = entryData(provider, 'countries');
    const id = requiredString(data.id, 'country-dashboard entry missing id');
    const subRegion = optionalString(data, 'subRegion');
    accept({
      type: 'entity',
      entityKind: 'country',
      entityId: id,
      label: requiredString(data.name, 'country-dashboard entry missing title').trim(),
      qualifiers: subRegion ? [subRegion] : [],
      url: `https://marquee.gs.com/s/marketview/country/${id}`,
    } satisfies MarketViewSearchDiscoveryEntity);
  };
  const portfolio = (provider: ProviderEntry) => {
    const data = entryData(provider, 'portfolios');
    const id = requiredString(data.id, 'portfolio-dashboard entry missing id');
    const currency = optionalString(data, 'currency');
    accept({
      type: 'entity',
      entityKind: 'portfolio',
      entityId: id,
      label: requiredString(data.name, 'portfolio-dashboard entry missing title').trim(),
      qualifiers: currency ? [currency] : [],
      url: `https://marquee.gs.com/s/marketview/portfolio/${id}`,
    } satisfies MarketViewSearchDiscoveryEntity);
  };

  const requestedWidgetModes = requestedSelectors.filter(isMarketViewSearchWidgetSelector);
  const ranked = entries(map, 'widgets_ranked');
  if (requestedWidgetModes.length > 1) {
    for (const selector of requestedWidgetModes) {
      const searchMode = MARKET_VIEW_SEARCH_WIDGET_MODES[selector];
      decodeSource(
        widgetEntriesForMode(map, selector, ranked),
        (provider) => widget(provider, searchMode),
      );
    }
  } else {
    const preferRanked = requestedWidgetModes[0] === 'hybrid-widget';
    const widgets = preferRanked && ranked.length > 0
      ? ranked
      : [
          ...entries(map, 'widgets'),
          ...entries(map, 'widgets_llm'),
          ...ranked,
        ];
    decodeSource(widgets, (provider) => widget(provider));
  }
  const nonWidgetDecoders: Readonly<Record<NonWidgetSelector, () => void>> = {
    thematic: () => decodeSource(entries(map, 'dashboards'), thematic),
    asset: () => decodeSource(entries(map, 'assets'), asset),
    country: () => decodeSource(entries(map, 'countries'), country),
    portfolio: () => decodeSource(entries(map, 'portfolios'), portfolio),
  };
  for (const selector of orderedNonWidgetSelectors(requestedSelectors)) {
    nonWidgetDecoders[selector]();
  }
  return results;
}

function dependencyFailure(error: MarqueeError): MarketViewSearchError {
  const failure = error.code === 'auth_expired'
    ? { kind: 'authentication-required' as const, realm: 'marquee' as const }
    : error.code === 'timeout'
      ? { kind: 'timeout' as const }
      : error.details?.isCanceled
        ? { kind: 'cancelled' as const }
        : error.details?.status === 429
          ? { kind: 'rate-limited' as const }
          : { kind: 'unavailable' as const };
  return { kind: 'discovery-failed', failure };
}

function decodeFailure(): MarketViewSearchError {
  return {
    kind: 'discovery-failed',
    failure: { kind: 'unavailable' },
  };
}

function decodeEvidence(
  error: MarketViewSearchDecodeError,
  selectors: readonly MarketViewSearchSelector[],
): Readonly<Record<string, unknown>> {
  return {
    kind: 'adapter-failure',
    message: `Adapter "marketview.search" failed: ${error.message}`,
    selectors: [...selectors],
  };
}

export function createMarketViewSearchProductionPort(
  requester: MarketViewSearchRequester,
  recordAdapterFailure?: (operation: 'discover', value: unknown) => void,
): MarketViewSearchPort {
  return {
    async discover(input) {
      try {
        const marketView = new MarketViewApi({
          request: (endpoint, init) => requester.request(endpoint, {
            ...init,
            ...(input.selectors.some((selector) => selector === 'semantic-widget' || selector === 'hybrid-widget')
              ? { hedgeDelaysMs: [1000] }
              : { retry: false }),
            ...(input.signal ? { signal: input.signal } : {}),
          }),
        });
        const projection = providerProjection(input.selectors);
        const raw = await marketView.search({
          query: input.query,
          types: projection.types,
          limit: input.limit,
          isNewSchema: projection.newSchema,
        });
        return {
          ok: true,
          value: {
            results: decodeSearchResults(
              raw as SearchRaw,
              input.selectors,
              input.limit,
            ),
          },
        };
      } catch (error) {
        if (error instanceof MarketViewSearchDecodeError) {
          recordAdapterFailure?.('discover', decodeEvidence(error, input.selectors));
          return { ok: false, error: decodeFailure() };
        }
        if (error instanceof MarqueeError) {
          return { ok: false, error: dependencyFailure(error) };
        }
        throw error;
      }
    },
  };
}
