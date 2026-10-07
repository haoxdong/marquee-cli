import { describe, expect, it } from 'vitest';
import { assertExpectedContentType } from '../http-plumbing.js';

describe('assertExpectedContentType', () => {
  it('accepts the expected media type in any case, ignoring its parameters', () => {
    expect(() => assertExpectedContentType('application/pdf', 'Application/PDF; charset=binary', 200, '/v1/doc'))
      .not.toThrow();
  });

  it('fails loud on a different media type', () => {
    expect(() => assertExpectedContentType('application/pdf', 'text/html; charset=utf-8', 200, '/v1/doc'))
      .toThrow('Unexpected content type text/html; charset=utf-8 for /v1/doc; expected application/pdf');
  });
});
