import { describe, expect, it } from 'vitest';

import { environmentSecrets, stripArgumentSecrets, stripSecrets } from '../trace-secrets.js';

const JWT = 'eyJ0eXAiOiJKV1QifQ.eyJzdWIiOiJ1c2VyLTEyMzQ1Njc4In0.c2lnbmF0dXJlLXZhbHVlLWFiYw';

describe('stripSecrets', () => {
  it.each([
    [
      'a signed URL keeps its path and loses every query value',
      'GET https://bucket.s3.amazonaws.com/chart.png?X-Amz-Credential=AKIA123&X-Amz-Signature=abc123&width=10',
      'GET https://bucket.s3.amazonaws.com/chart.png?X-Amz-Credential=[redacted]&X-Amz-Signature=[redacted]&width=[redacted]',
    ],
    [
      'a URL loses only its secret-named parameters',
      'https://marquee.gs.com/v1/data?access_token=t0ken123&dataset=EDRVOL',
      'https://marquee.gs.com/v1/data?access_token=[redacted]&dataset=EDRVOL',
    ],
    ['URL credentials', 'https://user:pass@example.com/x', 'https://[redacted]:[redacted]@example.com/x'],
    ['an Authorization header', '> authorization: Bearer abcdefgh12345', '> authorization: [redacted]'],
    ['a Cookie header', 'Cookie: MARQUEE_SESSION=s3ss10n; other=1', 'Cookie: [redacted]'],
    ['a Set-Cookie header', '< set-cookie: GSSSO=abc; HttpOnly', '< set-cookie: [redacted]'],
    ['a bearer token in prose', 'sent Bearer abcdefgh12345 upstream', 'sent Bearer [redacted] upstream'],
    ['a JWT anywhere', `token ${JWT} rejected`, 'token [redacted] rejected'],
    ['a session id field', '{"sessionId":"abc-123","name":"Rates"}', '{"sessionId":"[redacted]","name":"Rates"}'],
    ['a token assignment', 'refresh_token=xyz789&scope=read', 'refresh_token=[redacted]&scope=read'],
  ])('strips %s', (_case, input, expected) => {
    expect(stripSecrets(input, [])).toBe(expected);
  });

  it('keeps text without secrets unchanged', () => {
    const text = 'Error: Widget w-123 has HTTP 500 at https://marquee.gs.com/v1/widgets/w-123?range=1y';
    expect(stripSecrets(text, [])).toBe(text);
  });

  it("strips the values of the process's own secret-named environment variables wherever they appear", () => {
    const literals = environmentSecrets({ MARQUEE_AUTH_TOKEN: 'turn-token-1234', MARQUEE_OWNER_SESSION_ID: 'owner-5678', PATH: '/usr/bin:/bin' });
    expect(literals).toEqual(['turn-token-1234', 'owner-5678']);
    expect(stripSecrets('ran with turn-token-1234 for owner-5678 in /usr/bin:/bin', literals)).toBe(
      'ran with [redacted] for [redacted] in /usr/bin:/bin',
    );
  });
});

describe('stripArgumentSecrets', () => {
  it('keeps flags and ordinary values, and drops the value of a secret-named flag', () => {
    expect(
      stripArgumentSecrets(['widget', 'view', 'w-123', '--range', '1y', '--token', 'abc', '--api-key=k3y', '--session-id', 's1'], []),
    ).toEqual(['widget', 'view', 'w-123', '--range', '1y', '--token', '[redacted]', '--api-key=[redacted]', '--session-id', '[redacted]']);
  });
});
