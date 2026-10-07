import {
  type ArtifactRef,
} from '../../artifact-registry/index.js';
import type { ConfigId, WidgetId } from '../../widget/index.js';

export interface PreparedWidgetRef {
  widgetId: WidgetId;
  configId?: ConfigId;
  contextIdentity?: string;
}

export async function prepareWidgetRef(
  ref: Extract<ArtifactRef, { type: 'widget' }>,
  explicitConfigId?: ConfigId,
): Promise<PreparedWidgetRef> {
  const configId = explicitConfigId ?? ref.configurationId;
  return {
    widgetId: ref.widgetId,
    ...(configId ? { configId } : {}),
    ...(ref.selectedContext ? { contextIdentity: ref.selectedContext } : {}),
  };
}
