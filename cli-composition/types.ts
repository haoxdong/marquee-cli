import type { AgentBrowserRuntime } from '../agent-browser-runtime/index.js';
import type { Content } from '../content/index.js';
import type { ControlGroupModule } from '../control-group/index.js';
import type { DashboardModule } from '../dashboard/index.js';
import type { DocumentModule } from '../document/index.js';
import type { EntityModule } from '../entity/index.js';
import type {
  EntityFeedComposition,
} from '../entity-feed/composition.js';
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
  entityFeed?: EntityFeedComposition;
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
