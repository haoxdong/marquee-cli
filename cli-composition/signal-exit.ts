import { constants } from 'node:os';
import { CLI_EXIT_CODES } from '../presentation/index.js';

const SIGTERM_EXIT_CODE = 128 + constants.signals.SIGTERM;

// Exits with the cancelled code on SIGINT and the conventional 143 on SIGTERM.
export function installSignalExitCodes(target: Pick<NodeJS.Process, 'on' | 'exit'>): void {
  target.on('SIGINT', () => target.exit(CLI_EXIT_CODES.cancelled));
  target.on('SIGTERM', () => target.exit(SIGTERM_EXIT_CODE));
}
