import type { Transport } from '../transport/index.js';
import { createControlGroupCache } from './cache.js';
import { createControlGroupModuleFromAdapter } from './module.js';
import { createControlGroupProductionAdapter } from './production-adapter.js';
import type { ControlGroupModule, ControlGroupModuleOptions } from './types.js';
export type {
  ControlGroupError,
  ControlGroupResult,
  ControlGroupExpansion,
  ControlGroupModule,
  ControlGroupModuleOptions,
} from './types.js';

export function createControlGroupModule(
  transport: Pick<Transport, 'request'>,
  options: ControlGroupModuleOptions = {},
): ControlGroupModule {
  const cache = options.cache === undefined || options.cache === false
    ? undefined
    : createControlGroupCache(options.cache);
  return createControlGroupModuleFromAdapter(
    createControlGroupProductionAdapter(transport),
    cache,
  );
}
