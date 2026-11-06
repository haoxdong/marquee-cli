import { describe, expect, it } from 'vitest';

import { oneLineMessage } from '../messages.js';

describe('PlotTool Pro Expression messages', () => {
  // The maintainer, 2026-11-04: we cannot know every error Marquee sends, so a row shows it as Web does.
  it('keeps a relayed failure exactly as Marquee sends it, its lines joined into one', () => {
    expect(oneLineMessage(
      'context: abc123 GET https://asset-resolver.example:4556/v1/assets/EX%20MP\n'
        + 'status: 404, message: Not Found: <html>\n  <body>Not Found</body>\n</html> (Historical mode)',
    )).toBe(
      'context: abc123 GET https://asset-resolver.example:4556/v1/assets/EX%20MP '
        + 'status: 404, message: Not Found: <html> <body>Not Found</body> </html> (Historical mode)',
    );
  });

  it('keeps a one-line message as it is', () => {
    const message = 'Not Found (Markets endpoint: 00000000-0000-4000-8000-000000000051 DataSet not found for entity with id: MA_SYNTHETIC_EXMP_UW ,EXMP UW) (Historical mode)';

    expect(oneLineMessage(message)).toBe(message);
  });
});
