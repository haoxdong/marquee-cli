import { readFile } from 'node:fs/promises';
import { InvalidArgumentError, Option, type Command } from 'commander';
import { rawEndpoint } from '../../../api/raw/index.js';
import { MarqueeError, type Endpoint, type HttpRequestInit } from '../../../transport/index.js';
import { cliExitCode } from '../../top-level-error.js';
import type { ApiRegistration } from '../registrations.js';

type ApiMethod = 'GET' | 'POST';
type ApiField = readonly [string, string];

type ApiOptions = Readonly<{
  method?: ApiMethod;
  rawField: readonly ApiField[];
  field: readonly ApiField[];
  input?: string;
}>;

function collectField(
  value: string,
  previous: readonly ApiField[],
): readonly ApiField[] {
  const separator = value.indexOf('=');
  if (separator <= 0) throw new InvalidArgumentError('expected <key=value>');
  return [...previous, [value.slice(0, separator), value.slice(separator + 1)]];
}

function readStdin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    if (process.stdin.isPaused()) process.stdin.resume();
  });
}

function readFileOrStdin(path: string): Promise<string> {
  return path === '-' ? readStdin() : readFile(path, 'utf8');
}

async function readInputBody(input: string): Promise<unknown> {
  const text = await readFileOrStdin(input);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`--input ${input} is not valid JSON`, { cause: error });
  }
}

// `gh api -F` magic: true, false, null and integers become JSON values, and
// `@file` (`@-` for stdin) reads the value from a file.
async function typedFieldValue(value: string): Promise<unknown> {
  if (value.startsWith('@')) return readFileOrStdin(value.slice(1));
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

// `gh api` semantics: fields make the default method POST; they go in the query
// string for GET or when --input supplies the body, and in the JSON body otherwise.
async function apiRequest(
  path: string,
  options: ApiOptions,
): Promise<[Endpoint, HttpRequestInit]> {
  const typedFields = await Promise.all(options.field.map(
    async ([key, value]) => [key, await typedFieldValue(value)] as const,
  ));
  const fields = Object.fromEntries([...options.rawField, ...typedFields]);
  const hasFields = options.rawField.length > 0 || options.field.length > 0;
  const method = options.method ?? (hasFields || options.input !== undefined ? 'POST' : 'GET');
  const fieldsInQuery = method === 'GET' || options.input !== undefined;
  const body = options.input !== undefined
    ? await readInputBody(options.input)
    : hasFields && !fieldsInQuery ? fields : undefined;
  return [rawEndpoint(method, path), {
    responseType: 'text',
    isErrorBodyPreserved: true,
    ...(hasFields && fieldsInQuery ? { query: fields } : {}),
    ...(body === undefined ? {} : { body }),
  }];
}

async function runApi(ctx: ApiRegistration, endpoint: string, options: ApiOptions): Promise<void> {
  const path = `/${endpoint.replace(/^\/+/, '')}`;
  let response: unknown;
  try {
    response = await ctx.request(...await apiRequest(path, options));
  } catch (error) {
    // The provider's error body goes to stderr whole, not truncated as other commands' hints.
    const body = error instanceof MarqueeError ? error.details?.body : undefined;
    if (!(error instanceof MarqueeError) || body === undefined) throw error;
    ctx.writeError(`${error.message}\n${body.trimEnd()}\n`);
    process.exitCode = cliExitCode(error);
    return;
  }
  ctx.write(String(response));
}

export const apiOwnerAttachment = Object.freeze({
  register(program: Command, ctx: ApiRegistration): void {
    program
      .command('api')
      .description('Make an authenticated HTTP request to the Marquee API and print the response')
      .argument('<endpoint>', 'API path, such as /v1/marketview/dashboards/MD1')
      .addOption(new Option('-X, --method <method>', 'The HTTP method for the request (default GET; POST when fields or --input are provided)')
        .choices(['GET', 'POST']))
      .option('-F, --field <key=value>', 'Add a typed parameter in key=value format', collectField, [])
      .option('-f, --raw-field <key=value>', 'Add a string parameter in key=value format', collectField, [])
      .option('--input <file>', 'The file to use as body for the HTTP request (use "-" to read from standard input)')
      .action((endpoint: string, options: ApiOptions) => runApi(ctx, endpoint, options));
  },
});
