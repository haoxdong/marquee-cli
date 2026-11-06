import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ambient = [
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'MARQUEE_AUTH_TOKEN',
  'MARQUEEBOT_SESSION',
  'MARQUEEBOT_GATEWAY_URL',
  'MARQUEE_BROWSER_STATE',
  'MARQUEE_SESSION_ID',
  'MARQUEE_OWNER_SESSION_ID',
  'MARQUEE_INTERACTION_SESSION_ID',
  'MARQUEE_SESSION_PID',
  'MARQUEE_SESSION_PID_SOURCE',
];

export function setup(): () => void {
  for (const key of ambient) delete process.env[key];
  const home = mkdtempSync(join(tmpdir(), 'marquee-cli-test-home-'));
  writeFileSync(join(home, '.gitconfig'), '[maintenance]\n\tauto = false\n');
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  return () => rmSync(home, { recursive: true, force: true });
}
