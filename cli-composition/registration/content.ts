import type { Command } from 'commander';
import type { ContentRegistration } from './registrations.js';
import {
  contentFacetDefinitions,
  contentSearchJsonFields,
  contentViewJsonFields,
  presentContentGet,
  presentContentSearch,
  type ContentFacetSelection,
} from '../../content/index.js';
import {
  addJsonOutputOptions,
  writePresentation,
  type JsonOutputOptions,
} from '../output-mode.js';
import { addHelpExamples } from '../help.js';

const CONTENT_FACETS = contentFacetDefinitions();

type ContentFacetOption = (typeof CONTENT_FACETS)[number]['field'];

type ContentSearchOptions = JsonOutputOptions & Partial<Record<ContentFacetOption, string[]>> & {
  /** Commander's default sets it on every run. */
  limit: string;
  published?: string;
  sort?: string;
};

type ContentDocumentOptions = JsonOutputOptions;

function collectString(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function contentFacetSelections(options: ContentSearchOptions): ContentFacetSelection[] {
  const selections: ContentFacetSelection[] = [];
  for (const facet of CONTENT_FACETS) {
    for (const value of options[facet.field] ?? []) {
      selections.push({ field: facet.field, value });
    }
  }
  return selections;
}

async function renderContentDocument(
  ctx: ContentRegistration,
  inputValue: string,
  options: ContentDocumentOptions = {},
): Promise<void> {
  const outcome = await ctx.getContent().get({ target: inputValue });
  const presentation = await presentContentGet(outcome, options);
  writePresentation(ctx, presentation.output, presentation.exitCode);
}

export function registerContentCommands(program: Command, ctx: ContentRegistration): void {
  const content = program
    .command('content')
    .description('Search and view Marquee content')
    .helpCommand(false);

  const search = content
    .command('search')
    .description('Search Marquee content')
    .argument('[query...]')
    .option('-L, --limit <limit>', 'maximum results (max 50)', '10')
    .option('--published <range>', 'publication date range (">=YYYY-MM-DD", "<=YYYY-MM-DD" or YYYY-MM-DD..YYYY-MM-DD)')
    .option('--sort <sort>', 'sort by time or relevance');
  for (const facet of CONTENT_FACETS) {
    search.option(`--${facet.field} <value>`, facet.description, collectString, []);
  }
  addHelpExamples(search, [
    'marquee content search "US CPI" --limit 1',
    'marquee content search "US CPI" --published ">=2026-01-01" --sort time',
  ]);
  addJsonOutputOptions(search, contentSearchJsonFields())
    .action(async (queryParts: string[] | undefined, options: ContentSearchOptions) => {
      const query = (queryParts ?? []).join(' ');
      const outcome = await ctx.getContent().search({
        query,
        limit: options.limit,
        ...(options.published === undefined ? {} : { published: options.published }),
        ...(options.sort === undefined ? {} : { sort: options.sort }),
        facets: contentFacetSelections(options),
      });
      const presentation = await presentContentSearch(outcome, options);
      if (presentation.channel === 'stderr') {
        ctx.writeError(presentation.output);
      } else {
        writePresentation(ctx, presentation.output, presentation.exitCode);
      }
    });

  const getContent = content
    .command('view')
    .description('View a content document')
    .argument('<ref|url|uuid>', 'content result ref, URL, or UUID');
  addHelpExamples(getContent, ['marquee content view @s1.c1']);
  addJsonOutputOptions(getContent, contentViewJsonFields())
    .action(async (inputValue: string, options: ContentDocumentOptions) => {
      await renderContentDocument(ctx, inputValue, options);
    });

}
