import type { ConfigId, WidgetId } from '../../../widget/index.js';
import { describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../../artifact-registry/index.js';
import { prepareWidgetRef } from '../ref-load.js';

const ref: Extract<ArtifactRef, { type: 'widget' }> = {
  type: 'widget',
  widgetId: 'MW_ONE' as WidgetId,
  configurationId: 'WC_ONE' as ConfigId,
  selectedContext: 'MA_ONE',
};

describe('prepared Widget Ref', () => {
  it('carries only Config and Selected Context identity from the Widget Ref', async () => {
    await expect(prepareWidgetRef(ref)).resolves.toEqual({
      widgetId: 'MW_ONE',
      configId: 'WC_ONE',
      contextIdentity: 'MA_ONE',
    });
  });

  it('lets an explicit Config override Ref-carried Config identity', async () => {
    await expect(prepareWidgetRef(ref, 'WC_OTHER' as ConfigId)).resolves.toEqual({
      widgetId: 'MW_ONE',
      configId: 'WC_OTHER',
      contextIdentity: 'MA_ONE',
    });
  });

  it('keeps a configuration-less Widget Ref configuration-less', async () => {
    await expect(prepareWidgetRef({
      type: 'widget',
      widgetId: 'MW_DEFAULT' as WidgetId,
    })).resolves.toEqual({
      widgetId: 'MW_DEFAULT',
    });
  });
});
