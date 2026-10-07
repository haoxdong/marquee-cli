import { InvalidArgumentError, Option, type Command } from 'commander';
import {
  MARKETVIEW_DASHBOARD_VIEW_JSON_FIELDS,
  renderMarketviewDashboardTab,
} from '../../marketview/presenter.js';
import { presentDashboardLimit } from '../../marketview/presenters/command-options.js';
import { renderMarketViewDashboardCreate } from '../../marketview/presenters/dashboard-create.js';
import { renderMarketViewDashboardEdit } from '../../marketview/presenters/dashboard-edit.js';
import {
  MARKETVIEW_SEARCH_JSON_FIELDS,
  runMarketViewSearch,
} from '../../marketview/presenters/search.js';
import {
  MARKETVIEW_WIDGET_VIEW_JSON_FIELDS,
  renderMarketviewWidgetTab,
} from '../../marketview/presenters/widget.js';
import {
  addJsonOutputOptions,
  jsonOutputOptions,
  writePresentation,
  type JsonOutputOptions,
} from '../output-mode.js';
import { addHelpExamples } from '../help.js';
import type { MarketViewRegistration } from './registrations.js';

const DEFAULT_MARKETVIEW_SEARCH_TYPES = [
  'widget',
  'thematic-dashboard',
  'asset-dashboard',
  'country-dashboard',
  'portfolio-dashboard',
].join(',');

type SearchOptions = JsonOutputOptions & Readonly<{ limit: string; type: string }>;
type WidgetOptions = JsonOutputOptions & Readonly<{
  config?: string;
  selectedContext?: string;
  param?: readonly Readonly<{ field: string; value: string }>[];
  snippet?: boolean;
}>;
type DashboardOptions = JsonOutputOptions & Readonly<{
  search?: string;
  limit?: string;
}>;
type DashboardEditOptions = Readonly<{
  addWidget: readonly string[];
  removeWidget: readonly string[];
  addSection: readonly string[];
  removeSection: readonly string[];
  order?: string;
}>;

function collectAssignment(
  value: string,
  previous: Array<{ field: string; value: string }> = [],
): Array<{ field: string; value: string }> {
  const separator = value.indexOf('=');
  const field = value.slice(0, separator).trim();
  const assignmentValue = value.slice(separator + 1).trim();
  if (separator <= 0 || !field) {
    throw new InvalidArgumentError('expected <name=value>');
  }
  return [...previous, { field, value: assignmentValue }];
}

function collectString(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function presentationSink(registration: MarketViewRegistration) {
  return {
    write: registration.write,
    writeError: registration.writeError,
    setExitCode(exitCode: number) {
      process.exitCode = exitCode;
    },
  };
}

function widgetPresentationOptions(
  input: string,
  options: WidgetOptions,
): Parameters<typeof renderMarketviewWidgetTab>[1] {
  const presentation: Parameters<typeof renderMarketviewWidgetTab>[1] = {
    ...jsonOutputOptions(options),
    paramOverrides: [...(options.param ?? [])],
    hasEditableDashboards: true,
  };
  if (options.config !== undefined) presentation.configId = options.config;
  if (options.selectedContext !== undefined) presentation.selectedContext = options.selectedContext;
  if (options.snippet) presentation.isSnippet = true;
  if (input.startsWith('@') && (options.param?.length ?? 0) > 0) {
    presentation.mutationFallbackRef = input.slice(1);
  }
  return presentation;
}

export function registerMarketviewCommands(
  program: Command,
  registration: MarketViewRegistration,
): void {
  const marketview = program
    .command('marketview')
    .description('Search and view MarketView widgets and dashboards')
    .helpCommand(false);

  const search = marketview
    .command('search')
    .description('Search MarketView widgets and dashboards')
    .argument('<query>', 'search query')
    .option('--type <types>', 'result types (widget,widget-semantic,widget-hybrid,thematic-dashboard,asset-dashboard,country-dashboard,portfolio-dashboard)', DEFAULT_MARKETVIEW_SEARCH_TYPES)
    .option('-L, --limit <limit>', 'max results', '10');
  addHelpExamples(search, [
    'marquee marketview search "implied realized vol AUDJPY" --type widget --limit 1',
    'marquee marketview search "fx carry" --type thematic-dashboard',
  ]);
  addJsonOutputOptions(search, MARKETVIEW_SEARCH_JSON_FIELDS)
    .action(async (query: string, options: SearchOptions) => {
      await runMarketViewSearch({
        query,
        type: options.type,
        limit: options.limit,
        typeSource: search.getOptionValueSource('type') === 'cli' ? 'cli' : 'default',
        ...jsonOutputOptions(options),
      }, {
        ...presentationSink(registration),
        marketView: registration.getMarketView(),
      });
    });

  const widget = marketview.command('widget').description('View MarketView widgets').helpCommand(false);
  const getWidget = widget
    .command('view')
    .description('View a widget')
    .argument('<id-or-ref>', 'widget ID (MW...) or widget ref')
    .option('--config <id>', 'widget configuration ID (WC...)')
    .option('--selected-context <id>', 'selected context identifier')
    .option('-p, --param <name=value>', 'override a widget parameter; repeat for multiple parameters', collectAssignment, [])
    .addOption(new Option('--snippet').default(false).hideHelp());
  addHelpExamples(getWidget, [
    'marquee marketview widget view <widget-id> --config <config-id>',
    'marquee marketview widget view <widget-id> --json title,data',
  ]);
  addJsonOutputOptions(getWidget, MARKETVIEW_WIDGET_VIEW_JSON_FIELDS)
    .action(async (input: string, options: WidgetOptions) => {
      const sink = presentationSink(registration);
      const outcome = await registration.getMarketView().widget.get({
        target: input,
        ...(options.config === undefined ? {} : { configurationId: options.config }),
        ...(options.selectedContext === undefined
          ? {}
          : { selectedContext: options.selectedContext }),
        overrides: [...(options.param ?? [])],
        detail: options.snippet ? 'snippet' : 'full',
      });
      await renderMarketviewWidgetTab(
        outcome,
        widgetPresentationOptions(input, options),
        sink,
      );
    });

  const dashboard = marketview
    .command('dashboard')
    .description('View, edit, and create MarketView dashboards')
    .helpCommand(false);
  const getDashboard = dashboard
    .command('view')
    .description('View a dashboard')
    .argument('<identifier>', 'dashboard identifier or dashboard ref')
    .option('-L, --limit <n>', 'max widgets, counted in page order across sections')
    .option('-S, --search <query>', 'find widgets by title or ID in a dashboard ref');
  addHelpExamples(getDashboard, [
    'marquee marketview dashboard view fx-carry',
    'marquee marketview dashboard view @d1 --search vol',
  ]);
  addJsonOutputOptions(getDashboard, MARKETVIEW_DASHBOARD_VIEW_JSON_FIELDS)
    .action(async (input: string, options: DashboardOptions) => {
      const sink = presentationSink(registration);
      const limit = options.limit === undefined
        ? undefined
        : presentDashboardLimit(options.limit, sink);
      if (options.limit !== undefined && limit === undefined) return;
      const outcome = await registration.getMarketView().dashboard.get({
        target: input,
        ...(options.search === undefined ? {} : { search: options.search }),
        ...(limit === undefined ? {} : { limit }),
      });
      await renderMarketviewDashboardTab(outcome, options, sink);
    });

  const editDashboard = dashboard
    .command('edit')
    .description('Edit a dashboard or one of its sections')
    .argument('<target>', 'dashboard ref, ID or alias, or section ref')
    .option('--add-widget <widget-ref>', 'append a widget; repeat for multiple widgets', collectString, [])
    .option('--remove-widget <tile-ref>', 'remove a dashboard tile ref; repeat for multiple tiles', collectString, [])
    .option('--add-section <title>', 'append a section; repeat for multiple sections', collectString, [])
    .option('--remove-section <section-ref>', 'remove a section ref; repeat for multiple sections', collectString, [])
    .option('--order <refs>', 'comma-separated complete order of the target children')
    .action(async (target: string, options: DashboardEditOptions) => {
      const outcome = await registration.getMarketView().dashboard.edit({
        target,
        addWidgetRefs: options.addWidget,
        removeWidgetRefs: options.removeWidget,
        addSectionNames: options.addSection,
        removeSectionRefs: options.removeSection,
        ...(options.order === undefined ? {} : { order: options.order }),
      });
      const presentation = renderMarketViewDashboardEdit(outcome);
      writePresentation(registration, presentation.text, presentation.exitCode);
    });
  addHelpExamples(editDashboard, [
    'marquee marketview dashboard edit @d1 --add-section "Fallback Section"',
    'marquee marketview dashboard edit @d2 --remove-section @d2.s1',
  ]);

  dashboard
    .command('create')
    .description('Create a dashboard')
    .argument('<name>', 'new dashboard name')
    .option('--add <widget-ref>', 'seed a widget; repeat for multiple widgets', collectString, [])
    .action(async (name: string, options: Readonly<{ add: readonly string[] }>) => {
      const outcome = await registration.getMarketView().dashboard.create({
        name,
        widgetRefs: options.add,
      });
      const presentation = renderMarketViewDashboardCreate(outcome);
      writePresentation(registration, presentation.text, presentation.exitCode);
    });
}
