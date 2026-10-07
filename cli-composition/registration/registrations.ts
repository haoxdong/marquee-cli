import type { Auth } from '../../auth/index.js';
import type { Content } from '../../content/index.js';
import type { MarketView } from '../../marketview/index.js';
import type { Writer } from '../../presentation/index.js';
import type { Endpoint, HttpRequestInit } from '../../transport/index.js';
export type MarketViewRegistration = Readonly<{
  write: Writer;
  writeError: Writer;
  getMarketView(): MarketView;
}>;

export type ContentRegistration = Readonly<{
  write: Writer;
  writeError: Writer;
  getContent(): Content;
}>;

export type AuthRegistration = Readonly<{
  write: Writer;
  writeError: Writer;
  getAuth(): Auth;
}>;

export type ApiRegistration = Readonly<{
  write: Writer;
  writeError: Writer;
  request(endpoint: Endpoint, init: HttpRequestInit): Promise<unknown>;
}>;
