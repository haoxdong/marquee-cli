import { InvalidArgumentError, Option, type Command } from 'commander';
import type { DataRegistration } from './registrations.js';
import {
  dataDateForms,
  dataEvalJsonFields,
  dataIntervals,
  dataListJsonFields,
  dataSearchClasses,
  dataSearchJsonFields,
  dataSearchLimits,
  dataViewJsonFields,
  parseDataDate,
  parseDataInterval,
  presentDataEval,
  presentDataList,
  presentDataSearch,
  presentDataView,
  type DataDate,
  type DataInterval,
  type DataSearchClass,
} from '../../data/index.js';
import {
  addJsonOutputOptions,
  jsonOutputOptions,
  writeRowsAndErrors,
  type JsonOutputOptions,
} from '../output-mode.js';
import { addHelpExamples } from '../help.js';

type DataEvalOptions = JsonOutputOptions & Readonly<{
  startDate?: DataDate;
  endDate?: DataDate;
  interval?: DataInterval;
  picture?: string;
}>;

type DataSearchOptions = JsonOutputOptions & Readonly<{ class?: DataSearchClass; limit?: string }>;

export function registerDataCommands(program: Command, ctx: DataRegistration): void {
  const data = program
    .command('data')
    .description('Search and evaluate market data')
    .helpCommand(false);

  registerDataSearch(data, ctx);
  registerDataList(data, ctx);
  registerDataView(data, ctx);

  const evaluate = data
    .command('eval')
    .description('Evaluate Expressions to one summary row each and save them as a PlotTool Pro chart')
    .argument('<expression...>', 'PlotTool Pro Expression, such as FRED(UNRATE).value()')
    .option('--start-date <date>', `Start of the window: ${dataDateForms()} (default -1y)`, dataDate)
    .option('--end-date <date>', `End of the window, spelled like --start-date (default 0d)`, dataDate)
    .addOption(new Option('--interval <interval>', 'Sampling interval (default 1D)').choices(dataIntervals()).argParser(dataInterval))
    .option('--picture <file>', "Write the saved chart's PNG to <file>");
  addHelpExamples(evaluate, [
    "marquee data eval 'FRED(UNRATE).value()'",
    "marquee data eval 'FRED(DGS10).value()' --start-date -10y --interval 1W",
    "marquee data eval 'FRED(UNRATE).value()' --json results --jq '.results[0].values[-1]'",
    "marquee data eval 'SPX.spot()' 'SPX.implied_volatility(1m, forward, 100)' --picture spx.png",
  ]);
  addJsonOutputOptions(evaluate, dataEvalJsonFields())
    .action(async (expressions: string[], options: DataEvalOptions) => {
      const { startDate, endDate, interval, picture } = options;
      const outcome = await ctx.getData().eval({
        expressions,
        ...(startDate === undefined ? {} : { startDate }),
        ...(endDate === undefined ? {} : { endDate }),
        ...(interval === undefined ? {} : { interval }),
        ...(picture === undefined ? {} : { picture }),
      });
      writeRowsAndErrors(ctx, await presentDataEval(outcome, jsonOutputOptions(options)));
    });
}

function dataInterval(token: string): DataInterval {
  const interval = parseDataInterval(token);
  if (interval === undefined) throw new InvalidArgumentError(`Allowed choices are ${dataIntervals().join(', ')}.`);
  return interval;
}

function dataDate(token: string): DataDate {
  const date = parseDataDate(token);
  if (date === undefined) throw new InvalidArgumentError(`expected ${dataDateForms()}`);
  return date;
}

function registerDataSearch(data: Command, ctx: DataRegistration): void {
  const { defaultLimit, everyClassLimit, maximum } = dataSearchLimits();
  const maximums = dataSearchClasses().map((each) => `${each} ${maximum[each]}`).join(', ');
  const search = data
    .command('search')
    .description('Search every Class or one, one row per entry with the Class(args) and Measure(args) an Expression pastes')
    .argument('<query...>', 'search text')
    .addOption(new Option('--class <class>', `Class to search in depth (default: every Class, ${everyClassLimit} rows each)`).choices(dataSearchClasses()))
    .option('-L, --limit <limit>', `maximum rows for --class (default ${defaultLimit}; max: ${maximums})`);
  addHelpExamples(search, [
    'marquee data search "unemployment rate"',
    'marquee data search "unemployment rate" --class FRED --limit 20',
    'marquee data search "ISM Manufacturing" --class HAVER',
    'marquee data search EURUSD --class Asset',
    'marquee data search "United States" --class Country',
    'marquee data search IR_USD_SWAP --class MarketCoordinate --limit 30',
    'marquee data search VIX120 --class TSDB',
    'marquee data search "fx spot" --class Dataset',
  ]);
  addJsonOutputOptions(search, dataSearchJsonFields())
    .action(async (queryParts: string[], options: DataSearchOptions) => {
      const { class: searched, limit } = options;
      const outcome = await ctx.getData().search({
        query: queryParts.join(' '),
        ...(searched === undefined ? {} : { class: searched }),
        ...(limit === undefined ? {} : { limit }),
      });
      writeRowsAndErrors(ctx, await presentDataSearch(outcome, jsonOutputOptions(options)));
    });
}

function registerDataList(data: Command, ctx: DataRegistration): void {
  const list = data
    .command('list')
    .description('List every library Function or library Class with its signature, or Quickstart examples by folder')
    // Optional to commander, so a missing list fails naming every list.
    .argument('[list]', 'what to list: functions, classes or examples')
    .argument('[folder]', 'Quickstart folder, as Web names it, for examples; without one, every folder name');
  addHelpExamples(list, [
    'marquee data list functions',
    'marquee data list classes',
    'marquee data list examples',
    'marquee data list examples "FX - Spot"',
    "marquee data list functions --json name,group --jq '.[] | select(.group == \"statistics\") | .name'",
  ]);
  addJsonOutputOptions(list, dataListJsonFields())
    .action(async (catalog: string | undefined, folder: string | undefined, options: JsonOutputOptions) => {
      const outcome = await ctx.getData().list({
        ...(catalog === undefined ? {} : { catalog }),
        ...(folder === undefined ? {} : { folder }),
      });
      writeRowsAndErrors(ctx, await presentDataList(outcome, jsonOutputOptions(options)));
    });
}

function registerDataView(data: Command, ctx: DataRegistration): void {
  const view = data
    .command('view')
    .description("Show one target in full: an Entity's or Dataset's Measures, or a Class's or Function's signature")
    .argument('<target>', 'a search row\'s Class(args) cell, an Entity id such as SPX, or a Class or Function name');
  addHelpExamples(view, [
    'marquee data view "AAPL UW"',
    'marquee data view "Dataset(FXSPOT_STANDARD)"',
    'marquee data view FXOption',
    'marquee data view zscores',
  ]);
  addJsonOutputOptions(view, dataViewJsonFields())
    .action(async (target: string, options: JsonOutputOptions) => {
      const outcome = await ctx.getData().view({ target });
      writeRowsAndErrors(ctx, await presentDataView(outcome, jsonOutputOptions(options)));
    });
}
