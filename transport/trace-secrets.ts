const REDACTED = '[redacted]';

const SECRET_NAME = /token|secret|password|passwd|cookie|session|credential|authorization|api[-_]?key|signature/i;
const SIGNING_PARAM = /^(x-amz-[\w-]+|x-goog-[\w-]+|signature|sig|policy|key-pair-id|se|sp|sv|sr|skoid)$/i;
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const AUTH_SCHEME = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const HEADER_LINE = /^([<>*]?\s*(?:authorization|proxy-authorization|cookie|set-cookie|[\w-]*token[\w-]*)\s*:\s*).+$/gim;
const URL_TEXT = /\bhttps?:\/\/[^\s"'<>`]+/g;
const NAMED_VALUE = new RegExp(`\\b([\\w-]*(?:${SECRET_NAME.source})[\\w-]*)("?\\s*[=:]\\s*)("[^"]*"|'[^']*'|[^\\s&;,"'}]+)`, 'gi');
const MIN_LITERAL_SECRET = 8;

/** Values of this process's own secret-named environment variables, such as `MARQUEE_AUTH_TOKEN`. */
export function environmentSecrets(env: NodeJS.ProcessEnv = process.env): string[] {
  return Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && value !== undefined && value.length >= MIN_LITERAL_SECRET)
    .map(([, value]) => value as string)
    .sort((a, b) => b.length - a.length);
}

function stripUrl(text: string): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return text;
  }
  const params = [...url.searchParams.keys()];
  const signed = params.some((name) => SIGNING_PARAM.test(name));
  const secretParams = params.filter((name) => signed || SECRET_NAME.test(name));
  if (secretParams.length === 0 && !url.username && !url.password) return text;
  if (url.username) url.username = REDACTED;
  if (url.password) url.password = REDACTED;
  for (const name of new Set(secretParams)) url.searchParams.set(name, REDACTED);
  return url.toString().replaceAll(encodeURIComponent(REDACTED), REDACTED);
}

/** Returns `text` with every secret it carries replaced by `[redacted]`. */
export function stripSecrets(text: string, literals: readonly string[] = environmentSecrets()): string {
  let stripped = text;
  for (const literal of literals) stripped = stripped.split(literal).join(REDACTED);
  return stripped
    .replace(URL_TEXT, stripUrl)
    .replace(HEADER_LINE, `$1${REDACTED}`)
    .replace(AUTH_SCHEME, `$1 ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(NAMED_VALUE, (match, name: string, separator: string, value: string) => {
      const quote = /^["']/.test(value) ? value[0] : '';
      const bare = quote ? value.slice(1, -1) : value;
      return bare === REDACTED ? match : `${name}${separator}${quote}${REDACTED}${quote}`;
    });
}

/** Command-line arguments with secrets stripped: a secret-named flag's value goes, the flag stays. */
export function stripArgumentSecrets(args: readonly string[], literals: readonly string[] = environmentSecrets()): string[] {
  return args.map((arg, index) => {
    const previous = args[index - 1];
    if (previous?.startsWith('-') && !previous.includes('=') && SECRET_NAME.test(previous)) return REDACTED;
    return stripSecrets(arg, literals);
  });
}
