import { formatJsonFields, type JsonOutputOptions, type JsonRecord } from '../../presentation/index.js';
import { renderText, type TextBlock } from '../../presentation/text.js';
import { dataCommand } from '../command-lines.js';
import type {
  DataListCatalog,
  DataListError,
  DataListOutcome,
  DataPresentation,
  DataQuickstartIndex,
  QuickstartFailedFolder,
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

/**
 * `marquee data list --json` fields: a library Function or Class has a name, signature, group
 * and description; a Quickstart folder a collection and folder, and each of its examples a
 * title and Expressions besides.
 */
export const DATA_LIST_JSON_FIELDS = [
  'collection',
  'description',
  'expressions',
  'folder',
  'group',
  'name',
  'signature',
  'title',
] as const;

const TITLES = { functions: 'Functions', classes: 'Classes' } as const;

const SUBJECTS: Readonly<Record<DataListCatalog, string>> = {
  functions: 'PlotTool Pro\'s function library',
  classes: 'PlotTool Pro\'s function library',
  examples: 'PlotTool Pro\'s Quickstart collections',
};

/** Every row of the catalog as text on stdout (ADR 0070); `--json` projects the rows. */
export async function presentDataList(
  outcome: DataListOutcome,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  if (!outcome.ok) {
    if (outcome.error.kind !== 'folder-unknown') return failed(listFailure(outcome.error));
    const { message, exitCode } = failure(`no Quickstart folder is named ${JSON.stringify(outcome.error.folder)}`);
    const index = await presentIndex(outcome.error, options);
    return { ...index, stderr: `${index.stderr}Error: ${message}\n`, exitCode: index.exitCode ?? exitCode };
  }
  const results = outcome.value;
  if (results.catalog !== 'examples') {
    return present(results.rows, options, [{
      type: 'table',
      title: TITLES[results.catalog],
      noun: results.catalog,
      headers: ['signature', 'group', 'description'],
      rows: results.rows.map(({ signature, group, description }) => [signature, group, description]),
    }]);
  }
  if (results.folder === undefined) return presentIndex(results, options);
  const { collection, folder } = results.folder;
  return present(results.rows, options, [
    { type: 'field', key: 'collection', value: collection },
    { type: 'field', key: 'folder', value: folder },
    ...results.rows.map(({ title, expressions }): TextBlock => ({ type: 'body', title, text: expressions.join('\n') })),
  ]);
}

// Every folder's name grouped by collection.
async function presentIndex(
  { folders, failedFolders }: DataQuickstartIndex,
  options: JsonOutputOptions,
): Promise<DataPresentation> {
  const [first] = folders;
  const presentation = await present(folders, options, [
    {
      type: 'table',
      title: 'Quickstart folders',
      noun: 'folders',
      headers: ['collection', 'folder'],
      rows: withFailedFolders(folders.map(({ collection, folder }) => [collection, folder]), failedFolders),
    },
    {
      type: 'hints',
      hints: first === undefined
        ? []
        : [{ action: 'list a folder\'s examples', command: dataCommand('list', 'examples', first.folder) }],
    },
  ]);
  const failures = failedFolders.map(failedFolder);
  const [firstFailure] = failures;
  if (firstFailure === undefined) return presentation;
  return {
    ...presentation,
    stderr: presentation.stderr + failures.map(({ message }) => `Error: ${message}\n`).join(''),
    exitCode: presentation.exitCode ?? firstFailure.exitCode,
  };
}

async function present(
  rows: readonly JsonRecord[],
  options: JsonOutputOptions,
  blocks: readonly TextBlock[],
): Promise<DataPresentation> {
  if (options.json === undefined) return { stdout: renderText(blocks), stderr: '' };
  const formatted = await formatJsonFields(rows, options);
  return formatted.ok ? { stdout: formatted.output, stderr: '' } : failed(failure(formatted.error));
}

// Each failed folder keeps its place among its collection's folders, marked with its status.
function withFailedFolders(rows: readonly (readonly [string, string])[], failedFolders: readonly QuickstartFailedFolder[]): readonly (readonly [string, string])[] {
  return failedFolders.reduce<readonly (readonly [string, string])[]>((placed, { collection, folderId, status }) => {
    const after = placed.reduce((last, [each], index) => (each === collection ? index + 1 : last), 0);
    const at = after === 0 ? placed.length : after;
    return [...placed.slice(0, at), [collection, `${folderId} (failed: code: ${status})`], ...placed.slice(at)];
  }, rows);
}

// Marquee answers such a folder with its status alone, so the line ends there.
function failedFolder({ collection, folderId, status }: QuickstartFailedFolder): Failure {
  return failure(`Quickstart folder ${folderId} in ${collection}: code: ${status}`);
}

function listFailure(error: Exclude<DataListError, Readonly<{ kind: 'folder-unknown' }>>): Failure {
  switch (error.kind) {
    case 'catalog-required':
      return usageFailure(`a list is required: ${error.catalogs.join(', ')}`);
    case 'catalog-unknown':
      return usageFailure(`unknown list ${JSON.stringify(error.catalog)}; choose one of: ${error.catalogs.join(', ')}`);
    case 'folder-not-taken':
      return usageFailure(`data list ${error.catalog} takes no folder; only examples does`);
    case 'catalog-unavailable':
      return requestFailure(SUBJECTS[error.catalog], error.failure, error.reason);
    case 'malformed-catalog':
      return malformedResults(SUBJECTS[error.catalog], error.location, error.problem);
    case 'catalog-cache-unreadable':
    case 'catalog-cache-unwritable':
      return cacheFailure(error);
  }
}
