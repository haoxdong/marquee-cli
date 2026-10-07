import { describe, expect, it } from 'vitest';

import {
  cardPayloadHeaders,
  payloadHeaders,
  runnerPostHeaders,
} from '../headers.js';

describe('Widget payload headers', () => {
  it('uses the PlotTool Pro module application header by default', () => {
    expect(payloadHeaders()).toEqual({ 'X-Dash-AppId': 'MQPLOT' });
  });

  it('lets caller headers override the module baseline', () => {
    expect(payloadHeaders({
      'X-Dash-AppId': 'MarketView',
      'X-Application': 'mqda-mv',
      'X-Flatten-Status': 'true',
    })).toEqual({
      'X-Dash-AppId': 'MarketView',
      'X-Application': 'mqda-mv',
      'X-Flatten-Status': 'true',
    });
    expect(cardPayloadHeaders('MW1', {
      'X-Support-Reference': 'caller-owned',
    })).toEqual({
      'X-Dash-AppId': 'MQPLOT',
      'X-Support-Reference': 'caller-owned',
    });
  });

  it('scopes the support reference to card-owned calls', () => {
    const caller = {
      'X-Dash-AppId': 'MarketView',
      'X-Application': 'mqda-mv',
      'X-Flatten-Status': 'true',
    };

    expect(cardPayloadHeaders('MW1', caller)).toEqual({
      ...caller,
      'X-Support-Reference': 'MW1',
    });
    expect(payloadHeaders()).not.toHaveProperty('X-Support-Reference');
  });

  it('colon-joins the chart id on runner POST only', () => {
    expect(runnerPostHeaders('MW1', 'CH1', {
      'X-Dash-AppId': 'MarketView',
    })).toEqual({
      'X-Dash-AppId': 'MarketView',
      'X-Support-Reference': 'MW1:CH1',
    });
    expect(cardPayloadHeaders('MW1')).toEqual({
      'X-Dash-AppId': 'MQPLOT',
      'X-Support-Reference': 'MW1',
    });
  });
});
