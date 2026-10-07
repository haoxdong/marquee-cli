import { describe, expect, it } from 'vitest';
import {
  entityResolvedWidgetOptionValues,
  restoreRelativeDateDefaults,
} from '../parameters.js';
import { InvalidWidgetResponseError } from '../semantic-failure.js';

const shapeError = (detail: string) => new InvalidWidgetResponseError({
  source: 'widget',
  problem: 'unsupported-payload-shape',
  detail,
});

describe('restoreRelativeDateDefaults', () => {
  it('fails loud when a concrete component value would require relative-date restoration', () => {
    const relativePricingDate = { rdate: { rule: '0b' }, value: '2026-07-06' };

    expect(() => restoreRelativeDateDefaults({
      renderParams: { component: { pricingDate: '2026-07-06' } },
      parameters: [
        { field: 'pricingDate', values: { default: relativePricingDate } },
      ],
    })).toThrow(shapeError('relative Date default requires restoration'));
  });

  it('fails loud before rewriting matching control values', () => {
    const relativePricingDate = { rdate: { rule: '0b' }, value: '2026-07-06' };

    expect(() => restoreRelativeDateDefaults({
      renderParams: {
        component: { pricingDate: '2026-07-06' },
        controls: [
          {
            id: 'pricingDate',
            value: '2026-07-06',
            defaultValue: '2026-07-06',
          },
        ],
      },
      parameters: [
        { field: 'pricingDate', values: { default: relativePricingDate } },
      ],
    })).toThrow(shapeError('relative Date default requires restoration'));
  });

  it('fails loud when a relative control value would require restoration', () => {
    const relativePricingDate = { rdate: { rule: '0b' }, value: '2026-07-06' };

    expect(() => restoreRelativeDateDefaults({
      renderParams: {
        component: { pricingDate: '2026-07-06' },
        controls: [{ id: 'pricingDate', value: relativePricingDate }],
      },
      parameters: [],
    })).toThrow(shapeError('relative Date default requires restoration'));
  });

  it('preserves a mismatched explicit absolute date', () => {
    const relativePricingDate = { rdate: { rule: '0b' }, value: '2026-07-06' };

    expect(restoreRelativeDateDefaults({
      renderParams: { component: { pricingDate: '2026-07-07' } },
      parameters: [
        { field: 'pricingDate', values: { default: relativePricingDate } },
      ],
    })).toEqual({
      renderParams: { component: { pricingDate: '2026-07-07' } },
      parameters: [
        { field: 'pricingDate', values: { default: relativePricingDate } },
      ],
    });
  });

  it('fails loud when an unconfigured relative default has no concrete date', () => {
    expect(() => restoreRelativeDateDefaults({
      renderParams: { component: {} },
      parameters: [
        { field: 'start', values: { default: { rdate: { rule: '-1y' } } } },
      ],
    })).toThrow(shapeError('relative Date default has no concrete value'));
  });

  it('preserves a configured current value when its relative default has no concrete date', () => {
    const relativeStartDate = { rdate: { rule: '-1y' } };

    expect(restoreRelativeDateDefaults({
      renderParams: { component: { start: '-5y' } },
      parameters: [
        { field: 'start', values: { default: relativeStartDate } },
      ],
    })).toEqual({
      renderParams: { component: { start: '-5y' } },
      parameters: [
        { field: 'start', values: { default: relativeStartDate } },
      ],
    });
  });
});

describe('entityResolvedWidgetOptionValues', () => {
  it('does not send Control Group identifiers through Portfolio resolution', () => {
    expect(entityResolvedWidgetOptionValues('Portfolio', [
      `CG${'K'.repeat(15)}`,
      'MP_PORTFOLIO',
    ])).toEqual(['MP_PORTFOLIO']);
  });

  it('includes Control Group identifiers beyond the Asset pre-resolution limit', () => {
    const leadingAssets = Array.from({ length: 50 }, (_, index) => `MA_${index}`);

    expect(entityResolvedWidgetOptionValues('Asset', [
      ...leadingAssets,
      `CG${'J'.repeat(15)}`,
      'MA_LATE',
    ])).toEqual([...leadingAssets, `CG${'J'.repeat(15)}`]);
  });

  it('resolves a large Asset option list only when it holds a Control Group', () => {
    const assets = Array.from({ length: 1501 }, (_, index) => `MA_${index}`);

    expect(entityResolvedWidgetOptionValues('Asset', assets)).toEqual([]);
    expect(entityResolvedWidgetOptionValues('Asset', [...assets, `CG${'J'.repeat(15)}`]))
      .toContain(`CG${'J'.repeat(15)}`);
  });
});
