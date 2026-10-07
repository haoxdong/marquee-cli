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
