import type { Transport } from '../transport/index.js';
import { createDocumentModuleFromPort } from './module.js';
import { createDocumentProductionPort } from './production-port.js';
import type { DocumentModule } from './types.js';
export type {
  DocumentId,
  DocumentLocator,
  Document,
  DocumentError,
  DocumentModule,
} from './types.js';

export function createDocumentModule(
  transport: Pick<Transport, 'request'> & {
    recordAdapterFailure?(operation: 'decode', value: unknown): void;
  },
): DocumentModule {
  return createDocumentModuleFromPort(
    createDocumentProductionPort(transport),
  );
}
