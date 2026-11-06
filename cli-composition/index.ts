import type { Command } from 'commander';

import type { Writer } from '../presentation/index.js';

import { createProgramImplementation } from './registration/program.js';
import type { ProgramDependencies } from './types.js';
export type {
  AgentBrowserTransport,
  BrowserRegistration,
  ProgramDependencies,
} from './types.js';

export function createProgram(
  write: Writer = (chunk) => process.stdout.write(chunk),
  dependencies: ProgramDependencies = {},
): {
  program: Command;
} {
  return createProgramImplementation(write, dependencies);
}
