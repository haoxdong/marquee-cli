import type { Argument, Command, Help, Option } from 'commander';
import { commandJsonFields } from './output-mode.js';

const HELP_WIDTH = 80;
const EXAMPLES = new WeakMap<Command, readonly string[]>();
const ENVIRONMENT: readonly (readonly [string, string])[] = [
  ['MARQUEE_DEBUG', 'Set to 1 to log each Marquee request on stderr, or api to add headers and bodies'],
];

/** Command lines shown under help's `EXAMPLES`, without the `$ ` prompt. */
export function addHelpExamples(command: Command, examples: readonly string[]): Command {
  EXAMPLES.set(command, examples);
  return command;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`${title}\n${lines.join('\n')}`];
}

function table(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([term]) => term.length));
  return rows.map(([term, description]) => (
    description === '' ? `  ${term}` : `  ${term.padEnd(width)}   ${description}`
  ));
}

/** The Primer's value syntax: `<value>`, `[<value>]`, `{<a> | <b>}`, `<value>...`. */
function argumentTerm(argument: Argument): string {
  const names = argument.name().split('|').map((name) => `<${name}>`);
  const value = names.length === 1 ? names[0] : names.join(' | ');
  const repeat = argument.variadic ? '...' : '';
  if (!argument.required) return `[${value}${repeat}]`;
  return names.length === 1 ? `${value}${repeat}` : `{${value}}${repeat}`;
}

function optionTerm(option: Option, indentLongOnly: boolean): string {
  const flags = option.argChoices
    ? option.flags.replace(/<[^>]*>/, `{${option.argChoices.join(' | ')}}`)
    : option.flags;
  return option.short || !indentLongOnly ? flags : `    ${flags}`;
}

function optionDescription(option: Option): string {
  const { defaultValue } = option;
  const shownDefault = typeof defaultValue === 'string' || typeof defaultValue === 'number'
    ? ` (default ${JSON.stringify(defaultValue)})`
    : '';
  return capitalize(`${option.description}${shownDefault}`);
}

function optionRows(options: readonly Option[]): string[] {
  const indentLongOnly = options.some((option) => option.short);
  const sorted = [...options].sort((a, b) => (a.long ?? '').localeCompare(b.long ?? ''));
  return table(sorted.map((option) => [optionTerm(option, indentLongOnly), optionDescription(option)]));
}

function wrapList(items: readonly string[]): string[] {
  const lines: string[] = [];
  let line = '';
  for (const [index, item] of items.entries()) {
    const entry = index === items.length - 1 ? item : `${item},`;
    if (line !== '' && `  ${line} ${entry}`.length > HELP_WIDTH) {
      lines.push(`  ${line}`);
      line = entry;
    } else {
      line = line === '' ? entry : `${line} ${entry}`;
    }
  }
  return line === '' ? lines : [...lines, `  ${line}`];
}

function commandPath(command: Command): string {
  const names: string[] = [];
  for (let current: Command | null = command; current; current = current.parent) {
    names.unshift(current.name());
  }
  return names.join(' ');
}

/** gh's help page (ADR 0070 Help), shared by every command. */
function formatGhHelp(command: Command, helper: Help): string {
  const subcommands = helper.visibleCommands(command);
  const options = helper.visibleOptions(command);
  const ownFlags = command.parent
    ? options.filter((option) => option.long !== '--help')
    : options;
  const inheritedFlags = command.parent
    ? options.filter((option) => option.long === '--help')
    : [];
  const usage = [
    commandPath(command),
    ...(subcommands.length > 0 ? ['<command>'] : command.registeredArguments.map(argumentTerm)),
    '[flags]',
  ].join(' ');
  const describedArguments = command.registeredArguments.filter((argument) => argument.description);
  const jsonFields = commandJsonFields(command);
  const examples = EXAMPLES.get(command) ?? [];

  return `${[
    ...(command.description() ? [command.description()] : []),
    ...section('USAGE', [`  ${usage}`]),
    ...section('COMMANDS', table(subcommands.map((subcommand) => [
      `${subcommand.name()}:`,
      capitalize(subcommand.description()),
    ]))),
    ...section('ARGUMENTS', table(describedArguments.map((argument) => [
      argumentTerm(argument),
      capitalize(argument.description),
    ]))),
    ...section('FLAGS', ownFlags.length > 0 ? optionRows(ownFlags) : []),
    ...section('INHERITED FLAGS', inheritedFlags.length > 0 ? optionRows(inheritedFlags) : []),
    ...section('JSON FIELDS', wrapList([...(jsonFields ?? [])].sort())),
    ...section('EXAMPLES', examples.map((example) => `  $ ${example}`)),
    ...section('ENVIRONMENT', command.parent ? [] : table(ENVIRONMENT)),
    ...section('LEARN MORE', [
      '  Use `marquee <command> <subcommand> --help` for more information about a command.',
    ]),
  ].join('\n\n')}\n`;
}

/** Install gh's help page on `program`; commands created afterwards inherit it. */
export function configureGhHelp(program: Command): void {
  program.helpOption('-h, --help', 'Show help for command');
  program.configureHelp({ formatHelp: formatGhHelp });
}
