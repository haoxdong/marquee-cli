import type { WidgetId, WidgetModule } from '../../widget/index.js';
import { describe, expect, it } from 'vitest';
import type { Endpoint } from '../../transport/index.js';
import {
  createWidgetEvidenceRecorder,
  type WidgetCallLog,
  type WidgetEvidenceRecorder,
} from '../presenters/widget-evidence.js';
import { createMarketViewWidget } from '../widget.js';

function recorder(): WidgetEvidenceRecorder & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    port: {
      async request() {
        throw new Error('unexpected provider request');
      },
    },
    async record<T>(intent: WidgetCallLog['intent'], load: () => Promise<T>) {
      events.push(`record ${intent}`);
      return { result: await load(), audit: { intent, calls: [] } };
    },
  };
}

const failure = { ok: false, error: { kind: 'widget-not-found', identity: { widgetId: 'MW_ONE' } } } as const;
const widgetId = 'MW_ONE' as WidgetId;

describe('MarketView Widget evidence', () => {
  it('records a Widget read with parameters as a change', async () => {
    const evidence = recorder();
    const widget: WidgetModule = { get: async () => failure, render: async () => failure };

    await expect(createMarketViewWidget(widget, evidence).get({
      widgetId,
      configurationId: null,
      parameters: [{ field: 'tenor', value: '2y' }],
      detail: 'full',
    })).resolves.toEqual({ result: failure, audit: { intent: 'change', calls: [] } });
    expect(evidence.events).toEqual(['record change']);
  });

  it('records a Widget read without parameters as a read', async () => {
    const evidence = recorder();
    const widget: WidgetModule = { get: async () => failure, render: async () => failure };

    await expect(createMarketViewWidget(widget, evidence).get({
      widgetId,
      configurationId: null,
      parameters: [],
      detail: 'full',
    })).resolves.toEqual({ result: failure, audit: { intent: 'read', calls: [] } });
    expect(evidence.events).toEqual(['record read']);
  });

  it('records a Widget render as a read', async () => {
    const evidence = recorder();
    const widget: WidgetModule = { get: async () => failure, render: async () => failure };

    await expect(createMarketViewWidget(widget, evidence).render({ id: 'MW_ONE' }, [], null, undefined, 'snippet'))
      .resolves.toEqual({ result: failure, audit: { intent: 'read', calls: [] } });
    expect(evidence.events).toEqual(['record read']);
  });

  it('propagates a Widget read that throws', async () => {
    const evidence = recorder();
    const widget: WidgetModule = {
      get: async () => {
        throw new Error('read exploded');
      },
      render: async () => failure,
    };

    await expect(createMarketViewWidget(widget, evidence).get({
      widgetId,
      configurationId: null,
      parameters: [],
      detail: 'full',
    })).rejects.toThrow('read exploded');
    expect(evidence.events).toEqual(['record read']);
  });

  it('propagates a Widget render that throws', async () => {
    const evidence = recorder();
    const widget: WidgetModule = {
      get: async () => failure,
      render: async () => {
        throw new Error('render exploded');
      },
    };

    await expect(createMarketViewWidget(widget, evidence).render({ id: 'MW_ONE' }, [], null, undefined, 'snippet'))
      .rejects.toThrow('render exploded');
    expect(evidence.events).toEqual(['record read']);
  });

  it('stops recording into a load\'s call log once the load returns', async () => {
    const evidence = createWidgetEvidenceRecorder({ request: async () => ({}) });
    const chart = { method: 'GET', path: '/v1/charts/CH_TEST' } as Endpoint;
    const widget: WidgetModule = {
      get: async () => {
        await evidence.port.request(chart);
        return failure;
      },
      render: async () => failure,
    };

    const { audit } = await createMarketViewWidget(widget, evidence).get({
      widgetId,
      configurationId: null,
      parameters: [],
      detail: 'full',
    });
    await evidence.port.request(chart);

    expect(audit.calls).toHaveLength(1);
  });
});
