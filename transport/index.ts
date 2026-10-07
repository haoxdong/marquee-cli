import { ProxyHttpTransport } from './proxy.js';
import { HttpTransport } from './direct.js';
import { requestTarget } from './endpoint.js';
import { isRedirectResult } from './http-plumbing.js';
import {
  cookiesForDomain,
  hasValidAuth,
  load,
} from './cookies.js';
import {
  createProviderRequester,
} from './provider-requester.js';
import { createDebugFetch, debugLevel } from './debug.js';
import {
  createRecordingFetch,
  resolveRecordingRecordDir,
  type RecordingFetchOptions,
} from './recording.js';
import type {
  Endpoint,
  HttpRequestInit,
  Transport,
  TransportConfig,
  CookieJar,
} from './types.js';
export type {
  HttpRequestInit,
  Cookie,
  DependencyFailure,
  Endpoint,
  Transport,
  TransportConfig,
} from './types.js';
export { MarqueeError } from './errors.js';

export function createTransport(config: TransportConfig): Transport {
  let executor: Readonly<{ request(path: string, init?: HttpRequestInit): Promise<unknown> }>;
  let directExecutor: HttpTransport | undefined;
  let jar: CookieJar | undefined;
  const level = debugLevel(process.env.MARQUEE_DEBUG);
  const withDebug = (fetchFn: typeof fetch | undefined) => (
    level ? createDebugFetch(fetchFn, level) : fetchFn
  );
  if (config.execution === 'proxy') {
    executor = new ProxyHttpTransport({ ...config, fetchFn: withDebug(config.fetchFn) });
  } else {
    const authentication = config.authentication;
    jar = authentication.jar ?? load(authentication.cookieJarPath);
    const { recording, replaying } = recordingFetchOptions(config);
    directExecutor = new HttpTransport({
      jar,
      jarPath: authentication.cookieJarPath,
      fetchFn: withDebug(recording
        ? createRecordingFetch(recording) ?? recording.realFetch
        : config.fetchFn),
      saveFn: (
        authentication.persistCookies === false
        || replaying
      ) ? () => {} : undefined,
      baseUrl: config.baseUrl,
    });
    executor = directExecutor;
  }
  const execute = (target: Endpoint, init?: HttpRequestInit) => (
    executor.request(...requestTarget(target, init))
  );
  const requireAuthentication = () => {
    directExecutor?.requireAuthentication();
  };
  const request = (
    config.execution === 'direct'
    && config.authentication.required === true
  )
    ? (target: Endpoint, init?: HttpRequestInit) => {
        try {
          requireAuthentication();
        } catch (error) {
          return Promise.reject(error);
        }
        return execute(target, init);
      }
    : execute;
  const transport: Transport = {
    request,
    requireAuthentication,
    provider(options) {
      return createProviderRequester({
        owner: options.owner,
        evidence: options.evidence,
        getTransport: () => ({ request }),
      });
    },
    browserAuthenticationCookies() {
      if (!jar) return undefined;
      if (!hasValidAuth(jar, 'marquee.gs.com')) return undefined;
      return Object.freeze(
        cookiesForDomain(jar, 'marquee.gs.com')
          .map((cookie) => Object.freeze({ ...cookie })),
      );
    },
    isRedirect: isRedirectResult,
  };
  return Object.freeze(transport);
}

function recordingFetchOptions(config: Extract<TransportConfig, { execution: 'direct' }>): {
  recording?: RecordingFetchOptions;
  replaying: boolean;
} {
  if (!config.recording) return { replaying: false };
  const environment = config.recording.environment ?? process.env;
  const replaying = Boolean(environment.MARQUEE_HTTP_REPLAY);
  // A replay fetch serves Recordings in place of the wrapper's replay half (ADR 0073).
  const replayFetch = replaying ? config.recording.replayFetch : undefined;
  return {
    replaying,
    recording: {
      replayDir: replayFetch ? undefined : environment.MARQUEE_HTTP_REPLAY,
      recordDir: resolveRecordingRecordDir(
        environment,
        config.recording.processId ?? process.pid,
      ),
      recordNaming: config.recording.naming,
      manifestPath: config.recording.manifestPath,
      realFetch: replayFetch ?? config.fetchFn,
    },
  };
}
