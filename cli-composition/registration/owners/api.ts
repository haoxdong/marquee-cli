import { readFile } from 'node:fs/promises';
import { InvalidArgumentError, type Command } from 'commander';
import { rawEndpoint } from '../../../api/raw/index.js';
import { UsageError } from '../../../presentation/index.js';
import { MarqueeError, type Endpoint, type HttpRequestInit } from '../../../transport/index.js';
import { cliExitCode } from '../../top-level-error.js';
import type { ApiRegistration } from '../registrations.js';

type ApiField = readonly [string, string];

type ApiOptions = Readonly<{
  method?: string;
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

async function readInputBody(input: string): Promise<string> {
  const text = await readFileOrStdin(input);
  try {
    JSON.parse(text);
    return text;
  } catch (error) {
    throw new UsageError(`--input ${input} is not valid JSON`, { cause: error });
  }
}

async function typedFieldValue(value: string, fieldsInQuery: boolean): Promise<unknown> {
  if (value.startsWith('@')) return readFileOrStdin(value.slice(1));
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return fieldsInQuery ? '' : null;
  if (/^-?\d+$/.test(value)) {
    const integer = Number(value);
    if (Number.isSafeInteger(integer)) return integer;
    if (fieldsInQuery) return value;
    throw new UsageError('integer field exceeds the safe JSON integer range; use --raw-field to send a string');
  }
  return value;
}

async function apiRequest(
  path: string,
  options: ApiOptions,
): Promise<[Endpoint, HttpRequestInit]> {
  if (options.input === '-' && options.field.some(([, value]) => value === '@-')) {
    throw new UsageError('stdin can only feed one of --input or --field; write the other to a file (e.g. -F query=@query.txt)');
  }
  const keys: string[] = [];
  for (const [key] of [...options.rawField, ...options.field]) {
    if (keys.includes(key)) throw new UsageError(`unexpected override existing field under "${key}"`);
    keys.push(key);
  }
  const hasFields = options.rawField.length > 0 || options.field.length > 0;
  const method = options.method ?? (hasFields || options.input !== undefined ? 'POST' : 'GET');
  const queryOnly = /^(GET|HEAD)$/i.test(method);
  if (queryOnly && options.input !== undefined) {
    throw new UsageError(`${method} requests cannot have a body; remove --input`);
  }
  const fieldsInQuery = queryOnly || options.input !== undefined;
  const typedFields = await Promise.all(options.field.map(
    async ([key, value]) => [key, await typedFieldValue(value, fieldsInQuery)] as const,
  ));
  const fields = Object.fromEntries([...options.rawField, ...typedFields]);
  const payload = options.input !== undefined
    ? { rawBody: await readInputBody(options.input) }
    : hasFields && !fieldsInQuery ? { body: fields } : {};
  return [rawEndpoint(method, path), {
    responseType: 'text',
    isErrorBodyPreserved: true,
    ...(hasFields && fieldsInQuery ? { query: fields } : {}),
    ...payload,
  }];
}

async function runApi(ctx: ApiRegistration, endpoint: string, options: ApiOptions): Promise<void> {
  const path = `/${endpoint.replace(/^\/+/, '')}`;
  const request = await apiRequest(path, options).catch((error: unknown) => {
    // Unlike other thrown errors, a usage error is not printed at the top level.
    if (error instanceof UsageError) ctx.writeError(`Error: ${error.message}\n`);
    throw error;
  });
  let response: unknown;
  try {
    response = await ctx.request(...request);
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
      .option('-X, --method <method>', 'The HTTP method for the request (default GET; POST when fields or --input are provided)')
      .option('-F, --field <key=value>', 'Add a typed parameter in key=value format', collectField, [])
      .option('-f, --raw-field <key=value>', 'Add a string parameter in key=value format', collectField, [])
      .option('--input <file>', 'The file to use as body for the HTTP request (use "-" to read from standard input)')
      .action((endpoint: string, options: ApiOptions) => runApi(ctx, endpoint, options));
  },
});
