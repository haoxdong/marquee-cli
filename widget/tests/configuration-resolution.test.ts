import { describe, expect, it, vi } from 'vitest';
import { resolveWidgetConfiguration } from '../configuration-resolution.js';
import type { WidgetPersistenceAnchorPort } from '../persistence-anchor.js';

function portWith(
  result: Awaited<ReturnType<WidgetPersistenceAnchorPort['resolve']>>,
): WidgetPersistenceAnchorPort {
  return { resolve: vi.fn(async () => result) };
}

describe('Widget configuration resolution', () => {
  it('returns persistence anchors through the Widget result', async () => {
    await expect(resolveWidgetConfiguration(
      portWith({ ok: true, value: { parameters: [], relativeDate: '1Y' } }),
      'WC_OK',
      vi.fn(),
    )).resolves.toEqual({
      ok: true,
      value: { parameters: [], relativeDate: '1Y' },
    });
  });

  it.each([
    [
      { kind: 'not-found' as const, message: 'missing' },
      { kind: 'configuration-not-found', identity: { widgetId: '', configurationId: 'WC_BAD' } },
    ],
    [
      { kind: 'access-denied' as const, message: 'denied' },
      { kind: 'widget-access-denied', identity: { widgetId: '' } },
    ],
    [
      {
        kind: 'dependency' as const,
        failure: { kind: 'authentication-required' as const, realm: 'marquee' as const },
        message: 'login',
      },
      {
        kind: 'widget-load-failure',
        identity: { widgetId: '' },
        failure: { kind: 'authentication-required', realm: 'marquee' },
      },
    ],
  ])('closes persistence failure %j', async (error, expected) => {
    await expect(resolveWidgetConfiguration(
      portWith({ ok: false, error }),
      'WC_BAD',
      vi.fn(),
    )).resolves.toEqual({ ok: false, error: expected });
  });

  it('maps thrown adapter failures through the injected boundary', async () => {
    const thrown = new Error('upstream');
    const mapped = {
      kind: 'widget-load-failure' as const,
      identity: { widgetId: '' },
      failure: { kind: 'unavailable' as const },
    };
    const port: WidgetPersistenceAnchorPort = {
      resolve: vi.fn(async () => {
        throw thrown;
      }),
    };
    const mapThrown = vi.fn(() => mapped);

    await expect(resolveWidgetConfiguration(port, 'WC_THROW', mapThrown)).resolves.toEqual({
      ok: false,
      error: mapped,
    });
    expect(mapThrown).toHaveBeenCalledWith(thrown);
  });
});
