import { appendFileSync } from 'node:fs';

let input = '';
for await (const chunk of process.stdin) input += chunk;

const payload = JSON.parse(input);
const sessionId = payload?.session_id;
const envFile = process.env.CLAUDE_ENV_FILE;

if (typeof sessionId !== 'string' || sessionId.length === 0 || /[\r\n]/.test(sessionId)) {
  throw new Error('Claude SessionStart hook requires a valid session_id');
}
if (!envFile) {
  throw new Error('Claude SessionStart hook requires CLAUDE_ENV_FILE');
}

const shellValue = `'${sessionId.replaceAll("'", `'"'"'`)}'`;
appendFileSync(envFile, `export CLAUDE_CODE_SESSION_ID=${shellValue}\n`, 'utf8');
