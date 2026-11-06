import type {
  PlotToolCurvePoint,
  PlotToolEvaluationError,
  PlotToolProvenance,
  PlotToolSeriesPoint,
  PlotToolSeriesStatistics,
} from '../plottool/index.js';
import type { Result } from '../lib/result.js';
import type { DependencyFailure, Transport } from '../transport/index.js';

/**
 * Values a parameter accepts; with `conditions`, only while each named parameter or asset
 * property (`assetClass`, `type`, `assetId`) holds one of its listed values.
 */
export type CatalogAllowedValues = Readonly<{
  conditions?: Readonly<Record<string, readonly string[]>>;
  values: readonly string[];
  default?: string;
}>;

/** One parameter of a function, method or measure, as the library describes it. */
export type CatalogParameter = Readonly<{
  name: string;
  /** Takes any number of arguments, such as `and(*series)`. */
  isVariadic: boolean;
  default?: string;
  allowedValues: readonly CatalogAllowedValues[];
  description?: string;
}>;

/** A function or constructor; a constructor's methods are what its object answers. */
export type CatalogFunction = Readonly<{
  name: string;
  parameters: readonly CatalogParameter[];
  methods: readonly CatalogFunction[];
  /** The description's first sentence, when the library gives one. */
  summary?: string;
}>;

/** A function or constructor of the library, with what search shows of it. */
export type LibraryFunction = CatalogFunction & Readonly<{
  /** The library lists Functions and Classes apart, whatever their group. */
  kind: 'function' | 'class';
  /** The description's first sentence. */
  summary: string;
  /** Such as `statistics` or `constructors`. */
  group: string;
}>;

/** PlotTool Pro's function library: its functions and constructors by name. */
export type FunctionLibrary = Readonly<{
  functions: readonly LibraryFunction[];
}>;

/** A measure one asset carries, from its availability. */
export type AssetMeasure = CatalogFunction & Readonly<{
  /** The asset classes and types the measure applies to, when it says. */
  assetClasses?: readonly string[];
  assetTypes?: readonly string[];
  /** Who supplies the datasets behind it, once each. */
  vendors: readonly string[];
  /** Such as `End Of Day` or `Real Time`. */
  frequency?: string;
}>;

/** A catalog that could not be read: not fetched, malformed, or its cache file unreadable or unwritable. */
export type DataCatalogFailure =
  | Readonly<{ kind: 'catalog-unavailable'; reason?: 'access-denied'; failure: DependencyFailure }>
  | Readonly<{ kind: 'malformed-catalog'; location: string; problem: string }>
  | DataCatalogCacheFailure;

/** A catalog's cache file that cannot be read back, or written once the catalog is fetched. */
export type DataCatalogCacheFailure =
  | Readonly<{ kind: 'catalog-cache-unreadable'; path: string; problem: string }>
  | Readonly<{ kind: 'catalog-cache-unwritable'; path: string; problem: string }>;

/** A `--start-date`/`--end-date` value as PlotTool Pro stores it, before resolving against today. */
export type DataDate =
  | Readonly<{ kind: 'date'; date: string }>
  | Readonly<{ kind: 'max' }>
  | Readonly<{ kind: 'prior-year-end' }>
  | Readonly<{ kind: 'back' | 'ahead'; amount: number; unit: 'd' | 'w' | 'm' | 'y' }>;

export type DataInterval = '1D' | '1W' | '1M';

export type DataEvalInput = Readonly<{
  expressions: readonly string[];
  /** Defaults to `-1y`. */
  startDate?: DataDate;
  /** Defaults to `0d`. */
  endDate?: DataDate;
  /** Defaults to `1D`. */
  interval?: DataInterval;
  /** Where to write the saved chart's PNG. */
  picture?: string;
}>;

export type DataEvalResult =
  | Readonly<{
      kind: 'series';
      expression: string;
      /** At least one; a series with no points is an `error`. */
      points: readonly PlotToolSeriesPoint[];
      /** None where the runner gives none, as for a model method's series. */
      statistics?: PlotToolSeriesStatistics;
    }>
  | Readonly<{ kind: 'curve'; expression: string; points: readonly PlotToolCurvePoint[] }>
  | Readonly<{ kind: 'value'; expression: string; value: string }>
  | Readonly<{ kind: 'object'; expression: string; value: string }>
  | Readonly<{
      kind: 'error';
      expression: string;
      message: string;
      status?: number;
      /** What the catalogs say about the failure, one line each. */
      hints?: readonly string[];
    }>;

/** An Expression the function library shows cannot run, caught before the runner call. */
export type DataExpressionProblem = Readonly<{
  expression: string;
  message: string;
  /** The nearest functions, or the signature the call breaks, one line each. */
  hints: readonly string[];
}>;

/** Why no Expression in the batch has a result. */
export type DataEvalError =
  | PlotToolEvaluationError
  | Readonly<{ kind: 'invalid-expressions'; problems: readonly DataExpressionProblem[] }>
  | DataCatalogFailure
  | DataExplanationFailure;

/** A catalog a rejection's explanation reads that failed, named by what it was read for. */
export type DataExplanationFailure = Readonly<{
  kind: 'explanation-failed';
  /** Such as `PlotTool Pro measure lookup for EXMP UW`. */
  subject: string;
  failure: Exclude<DataCatalogFailure, DataCatalogCacheFailure>;
}>;

/** The resolved window: absolute `YYYY-MM-DD` dates and the `--interval` value. */
export type DataEvalWindow = Readonly<{
  startDate: string;
  endDate: string;
  interval: DataInterval;
}>;

/** Which chart request failed: the save or the picture. */
export type DataChartSubject = 'save' | 'picture';

/** Why the run's chart was not saved, or its picture not written. */
export type DataChartFailure =
  | Readonly<{ kind: 'chart-request-failed'; subject: DataChartSubject; reason?: 'access-denied'; failure: DependencyFailure }>
  | Readonly<{ kind: 'malformed-chart'; subject: DataChartSubject; location: string; problem: string }>
  | Readonly<{ kind: 'picture-unwritable'; path: string; problem: string }>;

/** The PlotTool Pro chart a run saves its Expressions as: its Web link and, on request, its PNG's file. */
export type DataSavedChart = Readonly<{
  link: string;
  /** Present with `picture` in the input. */
  picture?: Result<string, DataChartFailure>;
}>;

export type DataEvaluation = Readonly<{
  window: DataEvalWindow;
  results: readonly DataEvalResult[];
  provenance: PlotToolProvenance;
  /** How many Expressions Marquee failed upstream (5xx), of how many, and the command that runs them again. */
  upstreamFailure?: Readonly<{ failed: number; total: number; command: string }>;
  chart: Result<DataSavedChart, DataChartFailure>;
}>;

export type DataEvalOutcome =
  | Readonly<{ ok: true; value: DataEvaluation }>
  /** The batch of these Expressions failed as a whole, over this window. */
  | Readonly<{ ok: false; error: DataEvalError; window: DataEvalWindow; expressions: readonly string[] }>;

export type DataConfig = Readonly<{
  request: Transport['request'];
  /** The clock the default window counts back from; defaults to `MARQUEE_NOW`, then now. */
  now?: () => Date;
  /** Where catalogs are cached for a day; defaults to `MARQUEE_CACHE_DIR`, then `~/.marquee/cache`. */
  cacheDirectory?: string;
  /** How long a search of every Class waits for each Class; defaults to 10 s (ADR 0084). */
  everyClassDeadlineMs?: number;
}>;

export interface Data {
  /**
   * Evaluates Expressions in one runner call, one result per Expression, and saves them as a
   * PlotTool Pro chart alongside it.
   */
  eval(input: DataEvalInput): Promise<DataEvalOutcome>;
  /**
   * Searches every Class at once, or one with `class`: one row per entry with the `Class(args)`
   * and `Measure(args)` an Expression pastes (ADR 0084).
   */
  search(input: DataSearchInput): Promise<DataSearchOutcome>;
  /** Every entry of a catalog that lists in full, one row each. */
  list(input: DataListInput): Promise<DataListOutcome>;
  /**
   * One target in full: an Entity's or Dataset's availability, or a library Class's or
   * Function's signature and allowed values (ADR 0084 §3).
   */
  view(input: DataViewInput): Promise<DataViewOutcome>;
}

/** The Classes `data search` finds by query (ADR 0084). */
export type DataSearchClass =
  | 'Asset'
  | 'Country'
  | 'RiskModel'
  | 'Subdivision'
  | 'Kpi'
  | 'Portfolio'
  | 'FRED'
  | 'HAVER'
  | 'MarketCoordinate'
  | 'TSDB'
  | 'Dataset';

export type DataSearchInput = Readonly<{
  query: string;
  /** Absent, every Class is searched at once. */
  class?: DataSearchClass;
  /** As typed after `--limit`, valid with `class` only; absent, 10 rows. */
  limit?: string;
}>;

/** One search row: what pastes before the dot, and the Class's fixed Measures after it. */
export type DataClassRow = Readonly<{
  class: DataSearchClass;
  /**
   * `FRED(UNRATE)`, `Dataset(<id>)`, an asset's bare Bloomberg ID, else its Marquee id, a
   * country's or risk model's bare id, or `Subdivision("US-UM")`; pastes into an Expression and
   * into `view`.
   */
  classArgs: string;
  /** The Class's fixed Measures with the arguments that paste, such as `value()`; none for an entity Class or Dataset. */
  measures: readonly string[];
  name: string;
  type: string;
  /** An asset named by its Marquee id, which text screens leave out (only `--json` lists it). */
  withoutBbid?: true;
}>;

/** A Class's rows before its fixed Measures are filled in from the function library. */
export type DataClassMatch = Omit<DataClassRow, 'measures'>;

type DataClassResults = Readonly<{
  query: string;
  class: DataSearchClass;
  rows: readonly DataClassRow[];
  /** Every match the Class's search reports; absent when it does not say. */
  total?: number;
  /** The search returned or counted more rows than these. */
  hasMore: boolean;
}>;

/** Why a Class's search, or the whole search, failed. */
export type ClassRefused = Extract<DataClassSearchError, Readonly<{ kind: 'class-refused' }>>;

export type DataClassSearchError =
  | Readonly<{ kind: 'empty-query' }>
  | Readonly<{ kind: 'invalid-limit'; class: DataSearchClass; maximum: number }>
  | Readonly<{ kind: 'limit-without-class'; rowsPerClass: number }>
  /** Marquee answered the Class's search with this status and message, such as a 400 for a query it does not take. */
  | Readonly<{ kind: 'class-refused'; class: DataSearchClass; status: number; message: string }>
  | Readonly<{ kind: 'search-failed'; class: DataSearchClass; failure: DependencyFailure }>
  | Readonly<{ kind: 'malformed-results'; class: DataSearchClass; location: string; problem: string }>
  /** A search of every Class stopped waiting for this one (ADR 0084). */
  | Readonly<{ kind: 'class-too-slow'; class: DataSearchClass; query: string; deadlineMs: number }>
  /** The function library, which holds each Class's fixed Measures, could not be read. */
  | Readonly<{ kind: 'library-failed'; failure: DataCatalogFailure }>
  /** The function library has no Measures for a Class its search found. */
  | Readonly<{ kind: 'class-not-in-library'; class: DataSearchClass }>;

/** One Class's rows, or why that Class failed. */
export type DataClassSearch =
  | Readonly<{ ok: true; value: DataClassResults }>
  | Readonly<{ ok: false; error: DataClassSearchError }>;

/** Every Class searched at once: each Class's rows or its failure, in Class order (ADR 0084). */
export type DataSearchEveryClass = Readonly<{
  query: string;
  searches: readonly DataClassSearch[];
}>;

export type DataSearchOutcome =
  | DataClassSearch
  | Readonly<{ ok: true; everyClass: DataSearchEveryClass }>;

/** The catalogs `data list` prints in full (ADR 0084 decision 4). */
export type DataListCatalog = 'functions' | 'classes' | 'examples';

export type DataListInput = Readonly<{
  /** Required; anything but a `DataListCatalog` fails, naming them. */
  catalog?: string;
  /** A Quickstart folder named as Web names it, for `examples` only. */
  folder?: string;
}>;

/** A library Function or Class as `data list` prints it. */
export type DataLibraryRow = Readonly<{
  name: string;
  /** `name(a, b)`, as `signatureHead` writes it. */
  signature: string;
  /** Such as `statistics` or `constructors`. */
  group: string;
  /** The library description's first sentence. */
  description: string;
}>;

/** A worked example in a Quickstart folder: the chart's title and its Expressions, one per line. */
export type QuickstartFolderExample = Readonly<{
  title: string;
  expressions: readonly string[];
}>;

/** A Quickstart folder, such as `FX - Spot`, under the collection holding it, such as `Quickstart - FX`. */
type QuickstartFolder = Readonly<{
  collection: string;
  folder: string;
  examples: readonly QuickstartFolderExample[];
}>;

/** A folder a collection lists but Marquee could not load, answered with a status and no message (two Equity folders → 404, live 2026-10-23). */
export type QuickstartFailedFolder = Readonly<{
  collection: string;
  folderId: string;
  status: number;
}>;

/** Web's Quickstart tree: each folder once, grouped by collection in Web's order, and each that failed. */
export type QuickstartFolders = Readonly<{
  folders: readonly QuickstartFolder[];
  failedFolders: readonly QuickstartFailedFolder[];
}>;

/** A Quickstart folder's name, as the folder index prints it. */
type DataQuickstartFolderRow = Readonly<{ collection: string; folder: string }>;

/** One Quickstart example, as `data list examples <folder>` prints it. */
type DataQuickstartExampleRow = DataQuickstartFolderRow & QuickstartFolderExample;

/** Every folder's name, and each folder that failed. */
export type DataQuickstartIndex = Readonly<{
  folders: readonly DataQuickstartFolderRow[];
  failedFolders: readonly QuickstartFailedFolder[];
}>;

type DataListResults =
  | Readonly<{ catalog: Exclude<DataListCatalog, 'examples'>; rows: readonly DataLibraryRow[] }>
  | (Readonly<{ catalog: 'examples'; folder?: undefined }> & DataQuickstartIndex)
  | Readonly<{ catalog: 'examples'; folder: DataQuickstartFolderRow; rows: readonly DataQuickstartExampleRow[] }>;

export type DataListError =
  | Readonly<{ kind: 'catalog-required'; catalogs: readonly DataListCatalog[] }>
  | Readonly<{ kind: 'catalog-unknown'; catalog: string; catalogs: readonly DataListCatalog[] }>
  | Readonly<{ kind: 'folder-not-taken'; catalog: Exclude<DataListCatalog, 'examples'> }>
  /** No folder has that name; the index of current names comes with it. */
  | (Readonly<{ kind: 'folder-unknown'; folder: string }> & DataQuickstartIndex)
  | (DataCatalogFailure & Readonly<{ catalog: DataListCatalog }>);

export type DataListOutcome =
  | Readonly<{ ok: true; value: DataListResults }>
  | Readonly<{ ok: false; error: DataListError }>;

export type DataPresentation = Readonly<{
  /** Summary rows for stdout. */
  stdout: string;
  /** One line per failure for stderr. */
  stderr: string;
  exitCode?: number;
  /** The failure rejects the command's input (ADR 0085 decision 4). */
  usage?: true;
}>;

export type DataViewInput = Readonly<{
  /**
   * A search row's `Class(args)` cell, a bare id an Expression resolves to an Entity, or a
   * library Class or Function name.
   */
  target: string;
}>;

/**
 * An Entity as `view` shows it: the bare id it resolved from, never a Marquee id; an asset's
 * type and asset class, or another Entity's Class (`Country`, `RiskModel`).
 */
type DataEntity = Readonly<{ identifier: string; name: string; type: string; assetClass?: string }>;

/** What `view` showed a target to be. */
export type DataViewEntry =
  | Readonly<{
      kind: 'entity';
      entity: DataEntity;
      /** The Measures that apply to it, an asset's allowed values narrowed to it. */
      measures: readonly AssetMeasure[];
    }>
  | Readonly<{ kind: 'dataset'; datasetId: string; measures: readonly AssetMeasure[] }>
  | Readonly<{
      kind: 'library';
      entry: LibraryFunction;
      /** The `Class(args)` cell as given, which each Measure's signature is written on. */
      cell?: string;
    }>;

/** Which read failed: an Entity's availability, a Dataset's, or the Function library. */
export type DataViewSubject = 'entity' | 'dataset' | 'library';

export type DataViewError =
  | Readonly<{ kind: 'empty-target' }>
  /**
   * Nothing has the target; `nearestNames` are the library Classes and Functions closest to it,
   * `nearestEntities` the first Entities Web's bare-word search finds for a bare id, Class by Class.
   */
  | Readonly<{
      kind: 'not-found';
      target: string;
      /** `class` for a `Class(args)` cell, `any` for a bare id. */
      looked: 'class' | 'any';
      nearestNames: readonly string[];
      nearestEntities: readonly string[];
      /** Classes whose search Marquee refused, so they may hold the target. */
      refusals: readonly ClassRefused[];
    }>
  | Readonly<{ kind: 'dataset-not-found'; datasetId: string }>
  /** An id several Entities share; `entities` are those the lookup returned, each by an id that resolves to it alone. */
  | Readonly<{
      kind: 'ambiguous-entity';
      target: string;
      total: number;
      entities: readonly Readonly<{ id: string; name: string; type: string }>[];
    }>
  | Readonly<{ kind: 'view-failed'; subject: DataViewSubject; reason?: 'access-denied'; failure: DependencyFailure }>
  | Readonly<{ kind: 'malformed-results'; subject: DataViewSubject; location: string; problem: string }>
  | DataCatalogCacheFailure;

export type DataViewOutcome =
  | Readonly<{ ok: true; value: DataViewEntry }>
  | Readonly<{ ok: false; error: DataViewError }>;
