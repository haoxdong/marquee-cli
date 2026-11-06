import { describe, expect, it, vi } from 'vitest';

import { createProgram } from '../../cli-composition/index.js';
import { createBrowserTransport } from '../browser-transport.js';

describe('browser stdout output', () => {
  it('emits agent-browser stdout unchanged without promoting AgentCore stderr', async () => {
    const stderrWrites: string[] = [];
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    const execute = vi.fn().mockResolvedValue({
      stdout: '  opened without a trailing newline',
      stderr: [
        'agent-browser diagnostic',
        'Session: abc123-def456',
        'Live View: https://us-east-1.console.aws.amazon.com/bedrock-agentcore/browser/aws.browser.v1/session/abc123-def456#',
        '',
      ].join('\n'),
    });
    const browserTransport = createBrowserTransport({
      runtime: { execute },
    });
    let output = '';
    const { program } = createProgram(
      (chunk) => { output += chunk; },
      { browserTransport },
    );

    try {
      await program.parseAsync(['browser', 'open', 'https://example.com'], { from: 'user' });

      expect(output).toBe('  opened without a trailing newline');
      expect(stderrWrites.join('')).toBe([
        'Session: abc123-def456',
        'Live View: https://us-east-1.console.aws.amazon.com/bedrock-agentcore/browser/aws.browser.v1/session/abc123-def456#',
        '',
      ].join('\n'));
    } finally {
      stderr.mockRestore();
    }
  });
});
