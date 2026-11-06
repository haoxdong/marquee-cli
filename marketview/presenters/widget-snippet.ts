import type { TextCell } from '../../presentation/text.js';

/** The noun and header of every Widget Snippet table (ADR 0070). */
export const WIDGET_SNIPPET_TABLE = { noun: 'widgets', headers: ['ref', 'title', 'params'] } as const;

/**
 * The Widget Snippet row every widget listing prints (ADR 0070): `ref→title→params`,
 * the title with whitespace runs collapsed and the params as `name=value`.
 */
export function widgetSnippetRow(
  ref: string,
  snippet: Readonly<{ title: string; parameterLines: readonly string[] }>,
): TextCell[] {
  return [
    `@${ref}`,
    snippet.title.replace(/\s+/g, ' ').trim(),
    snippet.parameterLines,
  ];
}
