import { createEntityInMemoryModule } from '../in-memory-adapter.js';

const [dir, session, entityId, label] = process.argv.slice(2);
if (!dir || !session || !entityId || !label) {
  throw new Error('usage: cache-worker <dir> <session> <entity-id> <label>');
}

const entity = createEntityInMemoryModule({
  entities: [{
    kind: 'asset',
    entityId,
    label,
    aliases: [],
  }],
}, { cache: { dir, session } });

const result = await entity.resolve([{ kind: 'asset', value: entityId }]);
if (!result.ok) throw new Error(`Entity cache worker failed: ${result.error.kind}`);
