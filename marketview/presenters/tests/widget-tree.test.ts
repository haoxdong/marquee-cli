import { describe, expect, it } from 'vitest';
import { formatWidgetAuthor, widgetArtifact } from '../widget-tree.js';

describe('widgetArtifact', () => {
  it('refers to a Widget by its id and configuration id', () => {
    expect(widgetArtifact({ title: 'Carry', widgetId: 'MW_CARRY', configurationId: 'WC_CARRY', params: [] }))
      .toEqual({ type: 'widget', widgetId: 'MW_CARRY', configurationId: 'WC_CARRY' });
  });

  it('drops a missing or malformed configuration id', () => {
    expect(widgetArtifact({ title: 'Carry', widgetId: 'MW_CARRY', params: [] }))
      .toEqual({ type: 'widget', widgetId: 'MW_CARRY' });
    expect(widgetArtifact({ title: 'Carry', widgetId: 'MW_CARRY', configurationId: 'CH1', params: [] }))
      .toEqual({ type: 'widget', widgetId: 'MW_CARRY' });
  });

  it('refers to nothing for a malformed Widget id', () => {
    expect(widgetArtifact({ title: 'Carry', widgetId: 'CH1', configurationId: 'WC_CARRY', params: [] })).toBeUndefined();
  });
});

describe('formatWidgetAuthor', () => {
  it('turns a padded "Family, Given" author into "Given Family"', () => {
    expect(formatWidgetAuthor(' Doe , Jane ')).toBe('Jane Doe');
  });

  it('leaves names outside the exact "Family, Given" form unchanged', () => {
    expect(formatWidgetAuthor('Single Name')).toBe('Single Name');
    expect(formatWidgetAuthor('Family, Given, Suffix')).toBe('Family, Given, Suffix');
  });

  it('keeps an author whose family or given name is blank', () => {
    expect(formatWidgetAuthor('Doe,  ')).toBe('Doe,  ');
    expect(formatWidgetAuthor(' , Delbert')).toBe(' , Delbert');
  });
});
