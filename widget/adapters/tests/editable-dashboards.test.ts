import { describe, expect, it } from 'vitest';
import { editableDashboardsFromResponse } from '../editable-dashboards.js';

describe('editable Dashboard response', () => {
  it('maps Dashboard identities while preserving fields', () => {
    expect(editableDashboardsFromResponse({
      results: [{ id: 'MD_1', title: 'One', type: 'Custom' }],
    })).toEqual([{ dashboardId: 'MD_1', title: 'One', type: 'Custom' }]);
  });

  it.each([
    null,
    {},
    { results: null },
    { results: [null] },
    { results: [{ id: 1, title: 'One' }] },
    { results: [{ id: 'MD_1', title: null }] },
  ])('rejects malformed response %j', (value) => {
    expect(() => editableDashboardsFromResponse(value)).toThrow(
      /Malformed dashboard list response/,
    );
  });
});
