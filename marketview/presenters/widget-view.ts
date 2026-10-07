import type { TextBlock, TextCell, TextHint } from '../../presentation/text.js';
import type { WidgetParameter } from '../../widget/index.js';
import type { WidgetChartText } from '../../widget/text-presenter.js';
import {
  formatDefaultDisplay,
  formatWidgetAuthor,
  OPAQUE_ID_RE,
  sizedParamOptions,
  widgetPresentationUrl,
} from './widget-tree.js';
import type { WidgetPresentation } from './widget-types.js';

const PREVIEW_ROWS = 30;
const ASSET_TYPES = new Set(['Asset', 'AssetList']);

export type WidgetView = Readonly<{
  widget: WidgetPresentation;
  ref: string;
  chart?: WidgetChartText;
  hints: readonly TextHint[];
}>;

/** Widget view text (ADR 0070): fields, description body, Params/Axes/Series/Data tables, hints. */
export function presentWidgetView(view: WidgetView): readonly TextBlock[] {
  const { widget, ref } = view;
  const params = widget.params.filter((param) => !param.isNotParam);
  const table = view.chart?.data;
  const rows = table === undefined ? [] : previewRows(table);
  const total = table?.rows.length ?? 0;
  const command = `marquee marketview widget view @${ref}`;
  return [
    { type: 'field', key: 'title', value: widget.title },
    { type: 'field', key: 'ref', value: `@${ref}` },
    {
      type: 'field',
      key: 'url',
      value: widgetPresentationUrl(widget.widgetId, widget.configurationId, widget.selectedContext),
    },
    {
      type: 'field',
      key: 'author',
      value: { items: (widget.authors ?? []).map(formatWidgetAuthor), separator: '; ' },
    },
    { type: 'field', key: 'access', value: widget.access?.split(':')[0] },
    { type: 'field', key: 'tags', value: widget.tags ?? [] },
    { type: 'field', key: 'sources', value: widget.sources ?? [] },
    { type: 'field', key: 'chart', value: widget.chartId },
    ...(widget.description ? [{ type: 'body', title: 'Description', text: widget.description.trimEnd() } as const] : []),
    {
      type: 'table',
      title: 'Params',
      noun: 'params',
      headers: ['name', 'value', 'type', 'options'],
      rows: params.map(paramRow),
    },
    ...(view.chart?.axes
      ? [{ type: 'table', title: 'Axes', noun: 'axes', ...view.chart.axes } as const]
      : []),
    ...(view.chart?.series
      ? [{ type: 'table', title: 'Series', noun: 'series', ...view.chart.series } as const]
      : []),
    ...(table === undefined
      ? []
      : [{
          type: 'table',
          title: 'Data',
          noun: 'rows',
          ...(rows.length < total ? { count: { shown: rows.length, total } } : {}),
          headers: table.headers,
          rows,
        } as const]),
    ...(view.chart?.message === undefined
      ? []
      : [{ type: 'sentence', text: view.chart.message } as const]),
    {
      type: 'hints',
      hints: [
        ...(rows.length < total
          ? [{ action: 'get all rows as raw numbers', command: `${command} --json data` }]
          : []),
        ...(params.length > 0
          ? [{ action: 'change a param', command: `${command} -p <name>=<value>` }]
          : []),
        ...view.hints,
        ...(widget.dashboards === undefined
          ? []
          : [{
              action: 'add it to a dashboard',
              command: `marquee marketview dashboard edit <dashboard> --add-widget @${ref}`,
            }]),
      ],
    },
  ];
}

function paramRow(param: WidgetParameter): readonly TextCell[] {
  const value = formatDefaultDisplay(param);
  const { type, options } = sizedParamOptions(param);
  return [
    param.refKey ?? param.field,
    value && !OPAQUE_ID_RE.test(value) ? value : undefined,
    type,
    'count' in options
      ? `${options.count} options`
      : ASSET_TYPES.has(type) ? { items: options, separator: '; ' } : options,
  ];
}

/** The fixed Data preview (ADR 0071): date-ordered rows newest first, other tables in provider order. */
function previewRows(table: WidgetChartText['data']): WidgetChartText['data']['rows'] {
  const ordered = table.dateOrdered ? [...table.rows].reverse() : table.rows;
  return ordered.slice(0, PREVIEW_ROWS);
}
