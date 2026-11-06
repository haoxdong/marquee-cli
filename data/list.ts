import type { Transport } from '../transport/index.js';
import { fetchQuickstartFolders } from './adapters/catalogs.js';
import { cachedCatalog, cachedFunctionLibrary } from './catalog-cache.js';
import { signatureHead } from './signatures.js';
import type {
  DataLibraryRow,
  DataListCatalog,
  DataListInput,
  DataListOutcome,
  DataQuickstartIndex,
  LibraryFunction,
  QuickstartFolders,
} from './types.js';

type ListDependencies = Readonly<{ request: Transport['request']; cacheDirectory: string }>;

const CATALOGS: readonly DataListCatalog[] = ['functions', 'classes', 'examples'];

/**
 * Every library Function or Class, from the Function library, or Web's Quickstart examples by
 * folder, from the Quickstart collections; each cached for a day (ADR 0084).
 */
export async function listData(
  { request, cacheDirectory }: ListDependencies,
  now: Date,
  { catalog, folder }: DataListInput,
): Promise<DataListOutcome> {
  if (catalog === undefined) return { ok: false, error: { kind: 'catalog-required', catalogs: CATALOGS } };
  if (!isCatalog(catalog)) return { ok: false, error: { kind: 'catalog-unknown', catalog, catalogs: CATALOGS } };
  if (catalog === 'examples') {
    const quickstart = await cachedCatalog(
      { directory: cacheDirectory, now: () => now },
      'quickstart-folders',
      () => fetchQuickstartFolders(request),
      ({ failedFolders }) => failedFolders.length === 0,
    );
    if (!quickstart.ok) return { ok: false, error: { ...quickstart.error, catalog } };
    return listExamples(quickstart.value, folder);
  }
  if (folder !== undefined) return { ok: false, error: { kind: 'folder-not-taken', catalog } };
  const library = await cachedFunctionLibrary(request, cacheDirectory, now);
  if (!library.ok) return { ok: false, error: { ...library.error, catalog } };
  const kind = catalog === 'functions' ? 'function' : 'class';
  return {
    ok: true,
    value: { catalog, rows: library.value.functions.filter((entry) => entry.kind === kind).map(row) },
  };
}

// The folder named exactly as Web names it; without one, or with an unknown one, every name.
function listExamples({ folders, failedFolders }: QuickstartFolders, folder: string | undefined): DataListOutcome {
  const index: DataQuickstartIndex = {
    folders: folders.map((entry) => ({ collection: entry.collection, folder: entry.folder })),
    failedFolders,
  };
  if (folder === undefined) return { ok: true, value: { catalog: 'examples', ...index } };
  const found = folders.find((entry) => entry.folder === folder);
  if (found === undefined) return { ok: false, error: { kind: 'folder-unknown', folder, ...index } };
  const named = { collection: found.collection, folder: found.folder };
  return {
    ok: true,
    value: { catalog: 'examples', folder: named, rows: found.examples.map((example) => ({ ...named, ...example })) },
  };
}

function isCatalog(catalog: string): catalog is DataListCatalog {
  return (CATALOGS as readonly string[]).includes(catalog);
}

function row(entry: LibraryFunction): DataLibraryRow {
  return { name: entry.name, signature: signatureHead(entry), group: entry.group, description: entry.summary };
}
