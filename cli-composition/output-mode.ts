import type { Command } from 'commander';
import {
  jsonFieldsError,
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

/** Text with an exit code is a failure: it goes to stderr. */
export function writePresentation(
  sink: Readonly<{ write: Writer; writeError: Writer }>,
  text: string,
  exitCode: number | undefined,
): void {
  if (exitCode === undefined) {
    writeLine(sink.write, text);
    return;
  }
  process.exitCode = exitCode;
  writeLine(sink.writeError, text);
}
