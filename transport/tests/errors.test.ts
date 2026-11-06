import { describe, expect, it } from 'vitest';
import { MarqueeError } from '../errors.js';

describe('MarqueeError.toJSON', () => {
  it('serializes its details when it has them', () => {
    expect(new MarqueeError('http', 'Marquee returned 500', { status: 500 }).toJSON()).toStrictEqual({
      code: 'http',
      message: 'Marquee returned 500',
      details: { status: 500 },
    });
  });

  it('omits the details key when it has none', () => {
    expect(new MarqueeError('network', 'socket closed').toJSON()).toStrictEqual({
      code: 'network',
      message: 'socket closed',
    });
  });
});

describe('MarqueeError.marqueeAnswer', () => {
  it.each([
    ['its messages, joined', '{"messages":["Expected search phrase","Request: R1"]}', 'Expected search phrase; Request: R1'],
    ['its message', '{"data":["S&P 500"],"message":"query \'q\' validation failed"}', 'query \'q\' validation failed'],
    ['its errorMessages', '{"errorMessages":["User is not entitled"]}', 'User is not entitled'],
    ['its error', '{"error":"expired"}', 'expired'],
    ['the runner\'s failed results', '{"results":[{"type":"series","values":{}},{"error":true,"message":"Not Found (no entities for X)"}]}', 'Not Found (no entities for X)'],
    ['a body that is not JSON as it is', 'Bad Request (Field \'qs3\')', 'Bad Request (Field \'qs3\')'],
    ['a body without a message as it is', '{"statusCode":403}', '{"statusCode":403}'],
  ])('gives the status and %s', (_case, body, message) => {
    expect(new MarqueeError('http', 'Marquee returned 400', { status: 400, body }).marqueeAnswer()).toStrictEqual({ status: 400, message });
  });

  it('has no answer for a failure Marquee did not answer', () => {
    expect(new MarqueeError('auth_expired', 'Not authenticated', { status: 401 }).marqueeAnswer()).toBeUndefined();
    expect(new MarqueeError('network', 'socket closed').marqueeAnswer()).toBeUndefined();
  });
});
