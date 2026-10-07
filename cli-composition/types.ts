import type { AgentBrowserRuntime } from '../agent-browser-runtime/index.js';
import type { Content } from '../content/index.js';
import type { ControlGroupModule } from '../control-group/index.js';
import type { DashboardModule } from '../dashboard/index.js';
import type { DocumentModule } from '../document/index.js';
import type { EntityModule } from '../entity/index.js';
import type {
  EntityFeedEntry,
  EntityFeedError,
  EntityFeedModule,
} from '../entity-feed/index.js';
import type { MarketView } from '../marketview/index.js';
import type { Writer } from '../presentation/index.js';
import type { WidgetModule } from '../widget/index.js';
import type { TransportOpts } from '../cli/browser-transport.js';

export interface AgentBrowserTransport {
  run(command: string, args?: string[], opts?: TransportOpts): Promise<string>;
  saveState(path: string): Promise<void>;
  close(): Promise<string>;
}

export interface BrowserRegistration {
  readonly write: Writer;
  /** The transport for the Browser Session a command's `--session` flag names, if any. */
  readonly getBrowserTransport: (sessionFlag?: string) => AgentBrowserTransport;
  readonly resolveBrowserOpenTarget: (
    target: string,
  ) => { url?: string; error?: string };
}

export interface ProgramDependencies {
  authTransport?: AgentBrowserTransport;
  refStoreDir?: string;
  cookieJarPath?: string;
  browserStatePath?: string;
  browserTransport?: AgentBrowserTransport;
  browserRuntime?: AgentBrowserRuntime;
  controlGroup?: ControlGroupModule;
  entity?: EntityModule;
  entityFeed?: Readonly<{
    entityFeed: EntityFeedModule;
    readPage(input: Readonly<{
      entityId: string;
      limit: number;
      offset?: number;
    }>): Promise<
      | { ok: true; value: { entries: readonly EntityFeedEntry[]; total: number } }
      | { ok: false; error: EntityFeedError }
    >;
  }>;
  widget?: WidgetModule;
  marketView?: MarketView;
  document?: DocumentModule;
  content?: Content;
  dashboard?: DashboardModule;
  /** Every command error goes here as text; defaults to stderr (ADR 0070). */
  writeError?: Writer;
  /** Serves Recordings in replay mode; the Replay Lane worker passes MSW's fetch (ADR 0073). */
  replayFetch?: typeof fetch;
}
