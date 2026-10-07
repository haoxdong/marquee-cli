import type { Command } from 'commander';
import {
  type AuthLoginInput,
} from '../../../auth/index.js';
import {
  AUTH_STATUS_JSON_FIELDS,
  presentAuthLogin,
  presentAuthLoginProgress,
  presentAuthLogout,
  presentAuthStatusOutput,
  type AuthPresentation,
} from '../../../auth/presenter.js';
import {
  addJsonOutputOptions,
  writePresentation,
  type JsonOutputOptions,
} from '../../output-mode.js';
import type { AuthRegistration } from '../registrations.js';

function readPasswordStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return Promise.reject(new Error('--password-stdin requires piped input'));
  }
  return new Promise<string>((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
    if (process.stdin.isPaused()) process.stdin.resume();
  });
}

function writeAuthPresentation(ctx: AuthRegistration, presentation: AuthPresentation): void {
  writePresentation(ctx, presentation.output, presentation.exitCode);
}

async function writeAuthStatus(ctx: AuthRegistration, options: JsonOutputOptions): Promise<void> {
  const outcome = await ctx.getAuth().status();
  writeAuthPresentation(ctx, await presentAuthStatusOutput(outcome, options));
}

function registerAuthCommands(parent: Command, ctx: AuthRegistration): void {
  const auth = parent
    .command('auth')
    .description('Manage authentication credentials')
    .helpCommand(false);

  const status = auth.command('status').description('Check authentication status');
  addJsonOutputOptions(status, AUTH_STATUS_JSON_FIELDS)
    .action(async (options: JsonOutputOptions) => {
      await writeAuthStatus(ctx, options);
    });

  auth
    .command('login')
    .option('--url <url>', 'SSO login URL to save')
    .option('--username <user>', 'username to save')
    .option('--password-stdin', 'read password from stdin')
    .description('Sign in with the saved or given SSO credentials, or manually in the browser')
    .action(async (options: { url?: string; username?: string; passwordStdin?: boolean }) => {
      const input: AuthLoginInput = {
        ...(options.url ? { url: options.url } : {}),
        ...(options.username ? { username: options.username } : {}),
        ...(options.passwordStdin ? { readPasswordStdin } : {}),
      };
      const outcome = await ctx.getAuth().login(
        input,
        (mode) => writeAuthPresentation(ctx, presentAuthLoginProgress(mode)),
      );
      writeAuthPresentation(ctx, presentAuthLogin(outcome));
    });

  auth.command('logout').description('Remove the stored session').action(async () => {
    writeAuthPresentation(ctx, presentAuthLogout(await ctx.getAuth().logout()));
  });
}

export const authOwnerAttachment = Object.freeze({
  register(program: Command, registration: AuthRegistration): void {
    registerAuthCommands(program, registration);
  },
});
