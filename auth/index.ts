import { createProductionAuthPort } from './adapters/production.js';
import {
  createAuth as createAuthModule,
  type AuthOperationOutcome,
} from './module.js';
import type {
  AuthResult,
  AuthLoginInput,
  Auth,
  AuthConfig,
} from './types.js';
export type {
  AuthLoginInput,
  Auth,
  AuthConfig,
} from './types.js';

export function createAuth(config: AuthConfig): Auth {
  const auth = createAuthModule(createProductionAuthPort({
    cookieJarPath: config.cookieJarPath,
    transport: config.transport,
    runtime: config.runtime,
    statePaths: config.statePaths,
  }));
  return Object.freeze({
    async login(
      input: AuthLoginInput = {},
      onProgress?: (mode: 'saved' | 'manual') => void,
    ) {
      let passwordStdin: string | undefined;
      if (input.readPasswordStdin) {
        try {
          passwordStdin = (await input.readPasswordStdin()).trim();
        } catch {
          return operationOutcome<void>({
            ok: false,
            error: {
              kind: 'login-input-failure',
              problem: 'password-stdin-required',
            },
          });
        }
        if (!passwordStdin) {
          return operationOutcome<void>({
            ok: false,
            error: { kind: 'login-input-failure', problem: 'password-empty' },
          });
        }
      }
      return auth.login(
        {
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.username !== undefined ? { username: input.username } : {}),
          ...(passwordStdin !== undefined ? { passwordStdin } : {}),
        },
        onProgress,
      );
    },
    status: () => auth.status(),
    logout: () => auth.logout(),
  });
}

function operationOutcome<T>(result: AuthResult<T>): AuthOperationOutcome<T> {
  return Object.freeze({ result, evidence: Object.freeze([]) });
}
