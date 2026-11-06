import { formatJsonFields, type JsonOutputOptions, type JsonRecord } from '../../presentation/index.js';
import { renderText, type TextBlock, type TextCell } from '../../presentation/text.js';
import { dataCommand } from '../command-lines.js';
import { allowedValueSets, parameterLines, signatureHead } from '../signatures.js';
import type {
  AssetMeasure,
  CatalogFunction,
  CatalogParameter,
  DataPresentation,
  DataViewEntry,
  DataViewError,
  DataViewOutcome,
  DataViewSubject,
} from '../types.js';
import {
  cacheFailure,
  failed,
  failure,
  malformedResults,
  requestFailure,
  usageFailure,
  type Failure,
} from './failures.js';

/** `marquee data view --json` fields; each kind of target fills its own. */
export const DATA_VIEW_JSON_FIELDS = [
  'assetClass',
  'description',
  'group',
  'id',
  'kind',
  'measures',
  'name',
  'parameters',
  'signature',
  'type',
] as const;

// What a failed read is called: `Entity view returned malformed results`.
const SUBJECTS: Readonly<Record<DataViewSubject, string>> = {
  entity: 'Entity view',
  dataset: 'Dataset view',
  library: 'Function library',
};

/** The target as a few fields and tables (ADR 0070); `--json` returns one record. */
export async function presentDataView(
  outcome: DataViewOutcome,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  if (!outcome.ok) return failed(viewFailure(outcome.error));
  if (options.json !== undefined) {
    const formatted = await formatJsonFields(jsonRecord(outcome.value), options);
    return formatted.ok
      ? { stdout: formatted.output, stderr: '' }
      : failed(failure(formatted.error));
  }
  return { stdout: renderText(textBlocks(outcome.value)), stderr: '' };
}

function textBlocks(view: DataViewEntry): readonly TextBlock[] {
  switch (view.kind) {
    case 'library': {
      const { entry, cell } = view;
      return [
        ...fields({ id: entry.name, group: entry.group, signature: signatureHead(entry), description: entry.summary }),
        parametersTable(entry.parameters),
        ...(entry.methods.length === 0 ? [] : [classMeasuresTable(entry.methods, measurePrefix(cell))]),
      ];
    }
    case 'entity': {
      const { entity: { identifier, name, type, assetClass }, measures } = view;
      return [
        ...fields({ id: identifier, name, type, ...(assetClass === undefined ? {} : { assetClass }) }),
        ...entityMeasureBlocks(measures, identifier),
      ];
    }
    case 'dataset':
      return [...fields({ id: view.datasetId }), availabilityTable(view.measures, datasetPrefix(view.datasetId))];
  }
}

function measurePrefix(cell: string | undefined): string {
  return cell === undefined ? '' : `${cell}.`;
}

function datasetPrefix(datasetId: string): string {
  return `Dataset(${datasetId}).`;
}

// Text labels in Marquee Web's sentence case (ADR 0070), by the JSON field each one shows.
const LABELS = {
  id: 'ID',
  name: 'Name',
  group: 'Group',
  type: 'Type',
  assetClass: 'Asset class',
  signature: 'Signature',
  description: 'Description',
} as const;

function fields(values: Readonly<Partial<Record<keyof typeof LABELS, TextCell>>>): TextBlock[] {
  return Object.entries(values).map(([field, value]) => ({
    type: 'field',
    key: LABELS[field as keyof typeof LABELS],
    value,
  }));
}

function parametersTable(parameters: readonly CatalogParameter[]): TextBlock {
  return {
    type: 'table',
    title: 'Parameters',
    noun: 'parameters',
    headers: ['parameter', 'default', 'allowed', 'description'],
    rows: parameters.map((parameter) => [
      `${parameter.isVariadic ? '*' : ''}${parameter.name}`,
      parameter.default,
      allowedCell(allowedValueSets(parameter)),
      parameter.description,
    ]),
  };
}

// A library Class's fixed Measures.
function classMeasuresTable(methods: readonly CatalogFunction[], prefix: string): TextBlock {
  return {
    type: 'table',
    title: 'Measures',
    noun: 'measures',
    headers: ['measure', 'signature', 'allowed', 'description'],
    rows: methods.map((method) => [
      method.name,
      signatureHead(method, prefix),
      allowedCell(method.parameters.flatMap(parameterLines)),
      method.summary,
    ]),
  };
}

/**
 * An Entity's Measures: each distinct signature once, paste-ready, under who supplies it
 * and how often, which is what tells a Measure's duplicates apart (`spot` End Of Day and Real Time).
 * A stock has hundreds, so descriptions and allowed values stay in `--json`, and the smallest
 * groups print first, FactSet's hundreds of fundamentals last.
 */
function entityMeasureBlocks(measures: readonly AssetMeasure[], identifier: string): readonly TextBlock[] {
  if (measures.length === 0) return [{ type: 'table', title: 'Measures', noun: 'measures', headers: [], rows: [] }];
  const sources = new Map<string, { vendors: Set<string>; frequencies: Set<string> }>();
  for (const measure of measures) {
    const signature = signatureHead(measure, `${identifier}.`);
    const source = sources.get(signature) ?? { vendors: new Set(), frequencies: new Set() };
    for (const vendor of measure.vendors) source.vendors.add(vendor);
    if (measure.frequency !== undefined) source.frequencies.add(measure.frequency);
    sources.set(signature, source);
  }
  const groups = new Map<string, string[]>();
  for (const [signature, { vendors, frequencies }] of sources) {
    const title = measureGroupTitle([...vendors].sort(), [...frequencies].sort());
    const group = groups.get(title);
    if (group === undefined) groups.set(title, [signature]);
    else group.push(signature);
  }
  return [
    ...[...groups]
      .sort(([leftTitle, left], [rightTitle, right]) => left.length - right.length || (leftTitle < rightTitle ? -1 : 1))
      .map(([title, signatures]): TextBlock => ({ type: 'body', title, text: signatures.join('\n') })),
    {
      type: 'hints',
      hints: [{
        action: 'see a Measure\'s description and allowed values',
        command: dataCommand('view', identifier, '--json', 'measures', '--jq', '.measures[] | select(.name == "<measure>")'),
      }],
    },
  ];
}

// `Measures by LSEG (End Of Day, Real Time)`; either part left out when availability gives none.
function measureGroupTitle(vendors: readonly string[], frequencies: readonly string[]): string {
  return [
    'Measures',
    ...(vendors.length === 0 ? [] : [`by ${vendors.join(', ')}`]),
    ...(frequencies.length === 0 ? [] : [`(${frequencies.join(', ')})`]),
  ].join(' ');
}

// A Dataset's Measures, from its availability.
function availabilityTable(measures: readonly AssetMeasure[], prefix: string): TextBlock {
  return {
    type: 'table',
    title: 'Measures',
    noun: 'measures',
    headers: ['measure', 'signature', 'vendor', 'frequency', 'allowed', 'description'],
    rows: measures.map((measure) => [
      measure.name,
      signatureHead(measure, prefix),
      measure.vendors,
      measure.frequency,
      allowedCell(measure.parameters.flatMap(parameterLines)),
      measure.summary,
    ]),
  };
}

// Allowed values can hold commas, so sets join with `; `.
function allowedCell(sets: readonly string[]): TextCell {
  return { items: sets, separator: '; ' };
}

function jsonRecord(view: DataViewEntry): JsonRecord {
  switch (view.kind) {
    case 'library': {
      const { entry, cell } = view;
      return {
        kind: entry.kind,
        id: entry.name,
        group: entry.group,
        signature: signatureHead(entry),
        description: entry.summary,
        parameters: entry.parameters.map(jsonParameter),
        measures: entry.methods.map((method) => ({
          name: method.name,
          signature: signatureHead(method, measurePrefix(cell)),
          description: method.summary ?? null,
          parameters: method.parameters.map(jsonParameter),
        })),
      };
    }
    case 'entity': {
      const { entity: { identifier, name, type, assetClass }, measures } = view;
      return {
        kind: 'entity',
        id: identifier,
        name,
        type,
        assetClass: assetClass ?? null,
        measures: measures.map((measure) => jsonAvailabilityMeasure(measure, `${identifier}.`)),
      };
    }
    case 'dataset':
      return {
        kind: 'dataset',
        id: view.datasetId,
        measures: view.measures.map((measure) => jsonAvailabilityMeasure(measure, datasetPrefix(view.datasetId))),
      };
  }
}

function jsonAvailabilityMeasure(measure: AssetMeasure, prefix: string): JsonRecord {
  return {
    name: measure.name,
    signature: signatureHead(measure, prefix),
    vendors: measure.vendors,
    frequency: measure.frequency ?? null,
    description: measure.summary ?? null,
    parameters: measure.parameters.map(jsonParameter),
  };
}

function jsonParameter(parameter: CatalogParameter): JsonRecord {
  return {
    name: parameter.name,
    isVariadic: parameter.isVariadic,
    default: parameter.default ?? null,
    allowed: parameter.allowedValues,
    description: parameter.description ?? null,
  };
}

function viewFailure(error: DataViewError): Failure {
  switch (error.kind) {
    case 'empty-target':
      return usageFailure('data view target must not be empty');
    case 'not-found':
      return failure(notFound(error));
    case 'dataset-not-found':
      return failure(`no Dataset ${JSON.stringify(error.datasetId)}; search for it: ${
        dataCommand('search', error.datasetId, '--class', 'Dataset')
      }`);
    case 'ambiguous-entity':
      return failure([
        `${JSON.stringify(error.target)} names ${error.total} Entities; view one by its id: ${dataCommand('view')} <id>`,
        `  Entities named ${JSON.stringify(error.target)}:`,
        ...error.entities.map(({ id, name, type }) => `    ${id}\t${name}\t${type}`),
      ].join('\n'));
    case 'malformed-results':
      return malformedResults(SUBJECTS[error.subject], error.location, error.problem);
    case 'catalog-cache-unreadable':
    case 'catalog-cache-unwritable':
      return cacheFailure(error);
    case 'view-failed':
      return requestFailure(SUBJECTS[error.subject], error.failure, error.reason);
  }
}

// A Class Marquee refused may hold the target, so its error follows; a Kpi 401 needs an
// interactive Marquee sign-in, which a re-minted session lacks.
function notFound({ target, looked, nearestNames, nearestEntities, refusals }: Extract<DataViewError, { kind: 'not-found' }>): string {
  const kpiSignIn = refusals.some((each) => each.class === 'Kpi' && each.status === 401);
  return [
    `no ${looked === 'class' ? 'Class' : 'Entity, Class or Function'} ${JSON.stringify(target)}${refusals.length > 0 ? ' among the Classes that answered' : ''}`,
    ...refusals.map((each) => `Error: ${each.class}: code: ${each.status} - ${each.message}`),
    ...nearestLines('Classes and Functions', nearestNames),
    ...nearestLines('Entities', nearestEntities),
    ...(kpiSignIn ? ['Kpi\'s search needs an interactive Marquee sign-in'] : []),
  ].join('\n');
}

function nearestLines(noun: string, names: readonly string[]): readonly string[] {
  return names.length === 0 ? [] : [`  Nearest ${noun}:`, ...names.map((name) => `    ${name}`)];
}
