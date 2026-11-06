import { describe, expect, it } from 'vitest';

import { resolveTaggedLabel } from '../tags.js';

const controls = [
  {
    internalID: '123e4567-e89b-12d3-a456-426614174003',
    type: 'Asset',
    value: 'MA1',
  },
  {
    internalID: 'enum-control',
    type: 'Enum',
    value: '5Y',
  },
];

const entities = {
  assets: [{ id: 'MA1', name: 'Example Corp.', bbid: 'EXAM UW' }],
};

describe('Widget payload tag resolution', () => {
  it('matches the id half against internalID and discards display text', () => {
    expect(resolveTaggedLabel(
      'Spread for <ignored:123e4567-e89b-12d3-a456-426614174003>',
      controls,
      entities,
    )).toBe('Spread for Example Corp.');
  });

  it('preserves Web\'s first/second-colon parsing quirk', () => {
    expect(resolveTaggedLabel(
      'Spread for <ignored:123e4567-e89b-12d3-a456-426614174003:extra>',
      controls,
      entities,
    )).toBe('Spread for Unknown Value');
  });

  it('never enables value matching', () => {
    expect(resolveTaggedLabel(
      'Spread for <ignored:MA1>',
      controls,
      entities,
    )).toBe('Spread for Unknown Value');
  });

  it('uses BBID on legend/statistics surfaces with a one-way name fallback', () => {
    expect(resolveTaggedLabel(
      '<ignored:123e4567-e89b-12d3-a456-426614174003>',
      controls,
      entities,
      { surface: 'legend' },
    )).toBe('EXAM UW');
    expect(resolveTaggedLabel(
      '<ignored:123e4567-e89b-12d3-a456-426614174003>',
      controls,
      { assets: [{ id: 'MA1', name: 'Example Corp.' }] },
      { surface: 'statistics' },
    )).toBe('Example Corp.');
    expect(resolveTaggedLabel(
      '<ignored:123e4567-e89b-12d3-a456-426614174003>',
      controls,
      { assets: [{ id: 'MA1', bbid: 'EXAM UW' }] },
    )).toBe('undefined');
  });

  it('resolves Country controls from the irregular countries bucket', () => {
    expect(resolveTaggedLabel(
      '<ignored:country-control>',
      [{ internalID: 'country-control', type: 'Country', value: 'MC1' }],
      { countries: [{ id: 'MC1', name: 'Example Country' }] },
    )).toBe('Example Country');
  });

  it('does not synthesize provider buckets for unsupported control types', () => {
    expect(resolveTaggedLabel(
      '<ignored:unsupported>',
      [{ internalID: 'unsupported', type: 'Unsupported', value: '1' }],
      { unsupporteds: [{ id: '1', name: 'Unexpected Entity' }] },
    )).toBe('Unknown Value');
  });

  it('resolves Enum values locally', () => {
    expect(resolveTaggedLabel(
      'Tenor <ignored:enum-control>',
      controls,
      entities,
    )).toBe('Tenor 5Y');
  });

  it('supports both Web failure renderings without replacing surrounding text', () => {
    expect(resolveTaggedLabel(
      'Before <ignored:missing> after',
      controls,
      entities,
    )).toBe('Before Unknown Value after');
    expect(resolveTaggedLabel(
      'Before <ignored:missing> after',
      controls,
      entities,
      { surface: 'batch' },
    )).toBe('Before <ignored:missing> after');
  });

  it('leaves strings outside the exact tag grammar unchanged', () => {
    expect(resolveTaggedLabel('<:missing> <display:> plain', controls, entities))
      .toBe('<:missing> <display:> plain');
  });
});
