import type { Command } from 'commander';
import {
  jsonFieldsError,
  UsageError,
  writeLine,
  type JsonOutputOptions,
  type Writer,
} from '../presentation/index.js';

export type { JsonOutputOptions };

const JSON_FIELDS = new WeakMap<Command, readonly string[]>();

/** The `--json` fields a command registered, for help's `JSON FIELDS`. */
export function commandJsonFields(command: Command): readonly string[] | undefined {
  return JSON_FIELDS.get(command);
}

/**
 * gh's `--json <fields>` and `--jq`. A usage error (bare `--json`, an unknown
 * field, `--jq` without `--json`) goes to stderr with exit 1 before the action
 * runs, so the action sees only valid fields.
 */
export function addJsonOutputOptions(command: Command, fields: readonly string[]): Command {
  JSON_FIELDS.set(command, fields);
  return command
    .option('--json [fields]', 'output JSON with the specified fields')
    .option('--jq <expression>', 'filter JSON output using a jq expression')
    .hook('preAction', (_command, actionCommand) => {
      const error = jsonFieldsError(actionCommand.opts<JsonOutputOptions>(), fields);
      if (error !== undefined) actionCommand.error(error, { code: 'marquee.usage', exitCode: 1 });
    });
}

/** The `--json`/`--jq` values a command received, without absent keys. */
export function jsonOutputOptions(options: JsonOutputOptions): JsonOutputOptions {
  return {
    ...(options.json === undefined ? {} : { json: options.json }),
    ...(options.jq === undefined ? {} : { jq: options.jq }),
  };
}

/**
 * Rows to stdout and failure lines to stderr in the same run, as when part of a batch
 * fails (ADR 0084): the exit code is set by the failures alone. A failure that rejects
 * the input then throws, so the command is classed `usage` (ADR 0085 decision 4).
 */
export function writeRowsAndErrors(
  sink: Readonly<{ write: Writer; writeError: Writer }>,
  presentation: Readonly<{ stdout: string; stderr: string; exitCode?: number; usage?: true }>,
): void {
  if (presentation.stdout !== '') sink.write(presentation.stdout);
  if (presentation.stderr !== '') sink.writeError(presentation.stderr);
  if (presentation.exitCode !== undefined) process.exitCode = presentation.exitCode;
  if (presentation.usage) throw new UsageError(presentation.stderr);
}

/**
 * Text with an exit code is a failure: it goes to stderr. A failure that rejects the
 * input then throws, so the command is classed `usage` (ADR 0085 decision 4).
 */
export function writePresentation(
  sink: Readonly<{ write: Writer; writeError: Writer }>,
  text: string,
  exitCode: number | undefined,
  usage?: true,
): void {
  if (exitCode === undefined) {
    if (text !== '') writeLine(sink.write, text);
    return;
  }
  process.exitCode = exitCode;
  writeLine(sink.writeError, text);
  if (usage) throw new UsageError(text);
}
