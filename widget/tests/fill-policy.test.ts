import { describe, expect, it } from 'vitest';
import { annotateFillPolicy } from '../fill-policy.js';
import type { MutableWidgetParameter } from '../parameters.js';

function param(field: string): MutableWidgetParameter {
  return {
    field,
    type: 'Date',
    values: [],
    rawValues: [],
    options: [],
    default: '2026-09-01',
    rawDefault: '2026-09-01',
  };
}

describe('QuickPoll surveyDate fill policy', () => {
  it('blocks a surveyDate field spelled with separators on a QuickPoll widget', () => {
    const widget = { tags: ['Quick Poll'] };

    expect(annotateFillPolicy([param('Survey_Date'), param('question')], widget)).toEqual([
      { ...param('Survey_Date'), fillBlocked: { reason: 'quickpoll-survey-date' } },
      param('question'),
    ]);
  });

  it.each([
    [{ tags: 'QuickPoll' }, 'tags is not an array'],
    [{ metadata: { tags: 'QuickPoll' } }, 'metadata.tags is not an array'],
    [{ metadata: { dataSources: 'QuickPoll' } }, 'metadata.dataSources is not an array'],
    [{ dataAttribution: 'QuickPoll' }, 'dataAttribution is not an array'],
  ])('fails loud on the unrecorded marker shape %j', (widget, detail) => {
    expect(() => annotateFillPolicy([param('surveyDate')], widget)).toThrow(expect.objectContaining({
      error: { source: 'widget', problem: 'unsupported-payload-shape', detail },
    }));
  });
});
