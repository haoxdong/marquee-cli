import type { ConfigId, WidgetId } from '../../widget/index.js';
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
  createProgram,
  mkdtempSync,
  rmSync,
  writeFileSync,
  tmpdir,
  join,
  createArtifactRegistry,
  createMockTransport,
  mockStdin,
} from './cli-test-harness.js';
import { MarqueeError } from '../../transport/index.js';

afterEach(() => {
  process.exitCode = undefined;
  vi.unstubAllEnvs();
});

describe('browser open', () => {
  it('passes successful open stdout through without wrapper text', async () => {
    let output = '';
    const browserOutput = '  opened without a trailing newline';
    const transport = createMockTransport({ '*': browserOutput });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'open', 'https://example.com'], { from: 'user' });

    expect(output).toBe(browserOutput);
  });

  it('fails an open that lands on the sign-in page as unauthenticated', async () => {
    let output = '';
    const transport = createMockTransport({
      'get url': 'https://idfs.gs.com/signin?flowId=noftp\n',
      '*': '✓ GoldmanSachs - Login\n',
    });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'open', 'MD1'], { from: 'user' });

    expect(output).toBe('Not authenticated. Run: marquee auth login\n');
    expect(process.exitCode).toBe(4);
  });

  it('fails an open that lands on the sign-in page even when the cookie jar has cookies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'marquee-browser-auth-'));
    const cookieJarPath = join(dir, 'cookies.json');
    writeFileSync(cookieJarPath, JSON.stringify({
      cookies: [{
        name: 'MarqueeLogin',
        value: 'server-expired',
        domain: 'marquee.gs.com',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 3600,
      }],
      updatedAt: Date.now(),
    }));
    const transport = createMockTransport({
      'get url': 'https://idfs.gs.com/signin?flowId=noftp\n',
      '*': '✓ GoldmanSachs - Login\n',
    });
    let output = '';
    const { program } = createProgram((chunk) => { output += chunk; }, transport, undefined, { cookieJarPath });

    try {
      await program.parseAsync(['browser', 'open', 'MD1'], { from: 'user' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    expect(output).toBe('Not authenticated. Run: marquee auth login\n');
    expect(process.exitCode).toBe(4);
  });

  it('passes a signed-in Marquee open through after checking the tab URL', async () => {
    let output = '';
    const transport = createMockTransport({
      'get url': 'https://marquee.gs.com/s/marketview/dashboards/MD1\n',
      '*': '✓ Marquee\n',
    });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'open', 'MD1'], { from: 'user' });

    expect(output).toBe('✓ Marquee\n');
    expect(process.exitCode).toBeUndefined();
    expect(transport.run).toHaveBeenCalledWith('wait', ['--fn', expect.stringContaining('input[name="username"]')]);
    expect(transport.run).toHaveBeenCalledWith('get', ['url']);
  });

  it('does not check the tab URL after opening a non-Marquee URL', async () => {
    const transport = createMockTransport({ 'get url': 'https://idfs.gs.com/signin\n' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'open', 'https://example.com'], { from: 'user' });

    expect(transport.run).not.toHaveBeenCalledWith('get', ['url']);
    expect(process.exitCode).toBeUndefined();
  });

  it('opens URL via agent-browser open in the current tab', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'open', 'https://example.com'], { from: 'user' });

    expect(transport.run).not.toHaveBeenCalledWith('tab', ['new']);
    expect(transport.run).toHaveBeenCalledWith('open', ['https://example.com']);
  });

  it('fails loudly when opening the current browser fails', async () => {
    let output = '';
    const transport = createMockTransport({ '*': '' });
    transport.run.mockImplementation(async () => {
      throw new Error('browser not running');
    });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'open'], { from: 'user' });

    expect(output).toContain('open failed: browser not running');
    expect(process.exitCode).toBe(1);
  });

  it('uses a dedicated browser transport when provided', async () => {
    const apiTransport = createMockTransport({ '*': '' });
    const browserTransport = createMockTransport({ '*': '' });
    const { program } = createProgram(
      () => {},
      apiTransport,
      undefined,
      { browserTransport },
    );

    await program.parseAsync(['browser', 'open', 'MW123'], { from: 'user' });

    expect(browserTransport.run).not.toHaveBeenCalledWith('tab', ['new']);
    expect(browserTransport.run).toHaveBeenCalledWith(
      'open',
      ['https://marquee.gs.com/s/marketview/widget/MW123'],
    );
    expect(apiTransport.run).not.toHaveBeenCalled();
  });

  it('resolves Marquee IDs to URLs', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'open', 'MW123'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith(
      'open',
      ['https://marquee.gs.com/s/marketview/widget/MW123'],
    );
  });

  it('sets cookies individually before opening Marquee URLs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'marquee-browser-auth-'));
    const cookieJarPath = join(dir, 'cookies.json');
    writeFileSync(cookieJarPath, JSON.stringify({
      cookies: [
        {
          name: 'MarqueeLogin',
          value: 'login-cookie',
          domain: 'marquee.gs.com',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
      updatedAt: Date.now(),
    }));

    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(
      () => {}, transport,
      undefined,
      { cookieJarPath },
    );

    try {
      await program.parseAsync(['browser', 'open', 'MW123'], { from: 'user' });

      // Must set cookies individually (not state load, which navigates away)
      expect(transport.run).toHaveBeenCalledWith(
        'cookies',
        expect.arrayContaining(['set', 'MarqueeLogin', 'login-cookie']),
        { headed: false },
      );
      // Must NOT call state load
      const calls = (transport.run as ReturnType<typeof vi.fn>).mock.calls;
      const stateLoads = calls.filter((c: unknown[]) => c[0] === 'state');
      expect(stateLoads).toHaveLength(0);

      expect(transport.run).toHaveBeenCalledWith(
        'open',
        ['https://marquee.gs.com/s/marketview/widget/MW123'],


      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('syncs cookies for the Marquee URL after an agent-browser flag value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'marquee-browser-auth-'));
    const cookieJarPath = join(dir, 'cookies.json');
    writeFileSync(cookieJarPath, JSON.stringify({
      cookies: [
        {
          name: 'MarqueeLogin',
          value: 'login-cookie',
          domain: 'marquee.gs.com',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
      updatedAt: Date.now(),
    }));

    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(
      () => {}, transport,
      undefined,
      { cookieJarPath },
    );

    try {
      await program.parseAsync(
        ['browser', 'open', '--max-output', '100', 'https://marquee.gs.com/s/marketview/widget/MW123'],
        { from: 'user' },
      );

      expect(transport.run).toHaveBeenCalledWith(
        'cookies',
        expect.arrayContaining(['set', 'MarqueeLogin', 'login-cookie']),
        { headed: false },
      );
      expect(transport.run).toHaveBeenCalledWith(
        'open',
        ['--max-output', '100', 'https://marquee.gs.com/s/marketview/widget/MW123'],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('forwards open verbatim when no operand names a Marquee page', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'open', '--max-output', '100', 'https://example.com'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('open', ['--max-output', '100', 'https://example.com']);
  });

  it('fails before opening when browser cookie sync fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'marquee-browser-auth-'));
    const cookieJarPath = join(dir, 'cookies.json');
    writeFileSync(cookieJarPath, JSON.stringify({
      cookies: [
        {
          name: 'MarqueeLogin',
          value: 'login-cookie',
          domain: 'marquee.gs.com',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
      updatedAt: Date.now(),
    }));

    let output = '';
    const transport = createMockTransport({ '*': '' });
    transport.run.mockImplementation(async (command: string) => {
      if (command === 'cookies') {
        throw new Error('cookie daemon denied write');
      }
      return '';
    });
    const { program } = createProgram(
      (chunk) => { output += chunk; }, transport,
      undefined,
      { cookieJarPath },
    );

    try {
      await program.parseAsync(['browser', 'open', 'MW123'], { from: 'user' });

      expect(output).toContain('open failed: cookie daemon denied write');
      expect(process.exitCode).toBe(1);
      expect(transport.run).not.toHaveBeenCalledWith(
        'open',
        ['https://marquee.gs.com/s/marketview/widget/MW123'],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('opens URLs derived from stored Widget identity', async () => {
    const refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    registry.setRefs('w1', {
      w1: {
        type: 'widget',
        widgetId: 'MW123' as WidgetId,
        configurationId: 'WC1' as ConfigId,
        selectedContext: null,
      },
    });

    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport, refsDir);

    try {
      await program.parseAsync(['browser', 'open', '@w1'], { from: 'user' });

      expect(transport.run).toHaveBeenCalledWith(
        'open',
        ['https://marquee.gs.com/s/marketview/widget/MW123?config=WC1'],


      );
    } finally {
      rmSync(refsDir, { recursive: true, force: true });
    }
  });

  it('opens stored article refs from content search rows', async () => {
    const refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    registry.setRefs('s1', {
      's1.c1': {
        type: 'document',
        documentId: 'doc-1',
        realm: 'research',
      },
    });
    registry.setPayload('s1', {
      browserTargets: {
        's1.c1': 'https://marquee.gs.com/content/research/en/reports/doc-1.html',
      },
    });

    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport, refsDir);

    try {
      await program.parseAsync(['browser', 'open', '@s1.c1'], { from: 'user' });

      expect(transport.run).toHaveBeenCalledWith(
        'open',
        ['https://marquee.gs.com/content/research/en/reports/doc-1.html'],
      );
    } finally {
      rmSync(refsDir, { recursive: true, force: true });
    }
  });

  it('opens stored widget refs', async () => {
    const refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    registry.setRefs('w1', {
      w1: {
        type: 'widget',
        widgetId: 'MW123' as WidgetId,
        configurationId: 'WC1' as ConfigId,
        selectedContext: null,
      },
    });

    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport, refsDir);

    try {
      await program.parseAsync(['browser', 'open', '@w1'], { from: 'user' });

      expect(transport.run).toHaveBeenCalledWith(
        'open',
        ['https://marquee.gs.com/s/marketview/widget/MW123?config=WC1'],


      );
    } finally {
      rmSync(refsDir, { recursive: true, force: true });
    }
  });

  it('prints current ref recovery hints when a stored browser target is unknown', async () => {
    const refsDir = mkdtempSync(join(tmpdir(), 'marquee-refs-'));
    const registry = createArtifactRegistry(refsDir, process.ppid);
    registry.setRefs('s1', {
      s1: { type: 'search', searchKind: 'market-data' },
      's1.w1': { type: 'widget', widgetId: 'MW1' as WidgetId, configurationId: 'WC1' as ConfigId, selectedContext: null },
    });

    let output = '';
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram((chunk) => { output += chunk; }, transport, refsDir);

    try {
      await program.parseAsync(['browser', 'open', '@s2.d1'], { from: 'user' });

      expect(output.trim()).toBe([
        'Error: ref @s2.d1 not found',
        'Hint: current refs include @s1, @s1.w1.',
        'Run the previous command again or use one of the refs printed above.',
      ].join('\n'));
      expect(transport.run).not.toHaveBeenCalled();
    } finally {
      rmSync(refsDir, { recursive: true, force: true });
    }
  });
});

describe('browser close', () => {
  it('passes successful close stdout through byte-for-byte', async () => {
    let output = '';
    const browserOutput = '  closed without a trailing newline';
    const transport = createMockTransport({ '*': browserOutput });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'close'], { from: 'user' });

    expect(transport.close).toHaveBeenCalledOnce();
    expect(transport.run).not.toHaveBeenCalled();
    expect(output).toBe(browserOutput);
  });
});

describe('browser interaction commands', () => {
  it('passes successful interaction stdout through byte-for-byte', async () => {
    let output = '';
    const browserOutput = '  clicked without a trailing newline';
    const transport = createMockTransport({ '*': browserOutput });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'click', '@e1'], { from: 'user' });

    expect(output).toBe(browserOutput);
  });

  it('exits 1 with the transport message when a command times out', async () => {
    let output = '';
    const transport = createMockTransport();
    transport.run.mockRejectedValue(new MarqueeError('timeout', 'Command timed out.'));
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'click', '@e1'], { from: 'user' });

    expect(output).toBe('Command timed out.\n');
    expect(process.exitCode).toBe(1);
  });

  it('labels a non-transport failure with the command and exits 1', async () => {
    let output = '';
    const transport = createMockTransport();
    transport.run.mockRejectedValue(new Error('boom'));
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'click', '@e1'], { from: 'user' });

    expect(output).toBe('click failed: boom\n');
    expect(process.exitCode).toBe(1);
  });
});

describe('browser observation commands', () => {
  it('passes successful snapshot stdout through without wrapper probes', async () => {
    let output = '';
    const browserOutput = '  snapshot without a trailing newline';
    const transport = createMockTransport({ '*': browserOutput });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'snapshot'], { from: 'user' });

    expect(output).toBe(browserOutput);
    expect(transport.run).toHaveBeenCalledTimes(1);
    expect(transport.run).toHaveBeenCalledWith('snapshot', ['-i']);
  });

  it('snapshot defaults to -i flag', async () => {
    const transport = createMockTransport({ '*': '@e1 [button] "Submit"' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'snapshot'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('snapshot', ['-i']);
  });

  it('snapshot --all omits -i flag', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'snapshot', '--all'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('snapshot', []);
  });

  it('snapshot --cursor adds -C flag', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'snapshot', '--cursor'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('snapshot', ['-i', '-C']);
  });

  it('snapshot --scope adds -s flag', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'snapshot', '--scope', '#main'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('snapshot', ['-i', '-s', '#main']);
  });

  it('browser eval runs raw JS without data wrapper', async () => {
    const transport = createMockTransport({ '*': 'result' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'eval', 'document.title'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('eval', ['document.title']);
  });

  it('browser eval --stdin forwards the rest of its argv verbatim', async () => {
    const restoreStdin = mockStdin('document.title\n');
    const transport = createMockTransport({ '*': 'result' });
    const { program } = createProgram(() => {}, transport);

    try {
      await program.parseAsync(['browser', 'eval', 'ignored', '--stdin'], { from: 'user' });
    } finally {
      restoreStdin();
    }

    expect(transport.run).toHaveBeenCalledWith('eval', ['--stdin', 'ignored'], { stdin: 'document.title\n' });
  });

  it('browser eval accepts --stdin without code argument', async () => {
    const restoreStdin = mockStdin('document.title\n');
    const transport = createMockTransport({ '*': 'result' });
    const { program } = createProgram(() => {}, transport);

    try {
      await program.parseAsync(['browser', 'eval', '--stdin'], { from: 'user' });
    } finally {
      restoreStdin();
    }

    expect(transport.run).toHaveBeenCalledWith('eval', ['--stdin'], { stdin: 'document.title\n' });
  });

  it('browser eval forwards stdin input to transport', async () => {
    const restoreStdin = mockStdin('1 + 2\n');
    const transport = createMockTransport({ '*': 'result' });
    const { program } = createProgram(() => {}, transport);

    try {
      await program.parseAsync(['browser', 'eval', '--stdin'], { from: 'user' });
    } finally {
      restoreStdin();
    }

    expect(transport.run).toHaveBeenCalledWith('eval', ['--stdin'], { stdin: '1 + 2\n' });
  });

  it('browser eval --stdin labels a non-transport failure as eval', async () => {
    const restoreStdin = mockStdin('1 + 2\n');
    const transport = createMockTransport();
    transport.run.mockRejectedValue(new Error('boom'));
    let output = '';
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    try {
      await program.parseAsync(['browser', 'eval', '--stdin'], { from: 'user' });
    } finally {
      restoreStdin();
    }

    expect(output).toBe('eval failed: boom\n');
    expect(process.exitCode).toBe(1);
  });

  it('browser eval --stdin rejects interactive TTY input instead of waiting forever', async () => {
    const transport = createMockTransport({ '*': 'result' });
    let output = '';
    const { program } = createProgram((chunk) => { output += chunk; }, transport);
    const originalIsTty = process.stdin.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    const on = vi.spyOn(process.stdin, 'on').mockImplementation(() => {
      throw new Error('stdin read attempted');
    });

    try {
      await program.parseAsync(['browser', 'eval', '--stdin'], { from: 'user' });
    } finally {
      on.mockRestore();
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTty, configurable: true });
    }

    expect(output.trim()).toBe('Error: --stdin requires piped input');
    expect(process.exitCode).toBe(1);
    expect(transport.run).not.toHaveBeenCalled();
  });

});

describe('browser is', () => {
  it('reports an unavailable state when the browser probe fails', async () => {
    let output = '';
    const transport = createMockTransport({ '*': '' });
    transport.run.mockImplementation(async () => {
      throw new Error('browser not running');
    });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'is', 'visible', '@e1'], { from: 'user' });

    expect(output.trim()).toBe('browser is visible: unavailable: is visible failed: browser not running');
    expect(process.exitCode).toBeUndefined();
  });
});

describe('browser tab', () => {
  it('tab with no operation calls transport as-is', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'tab'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('tab', []);
  });

  it('tab new calls transport', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'tab', 'new'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('tab', ['new']);
  });

  it('tab new accepts a URL like agent-browser', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'tab', 'new', 'https://example.com'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('tab', ['new', 'https://example.com']);
  });

  it('tab new passes label options through like agent-browser', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'tab', 'new', '--label', 'docs', 'https://example.com'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('tab', ['new', '--label', 'docs', 'https://example.com']);
  });

  it('tab new syncs cookies before opening a Marquee URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'marquee-tab-auth-'));
    const cookieJarPath = join(dir, 'cookies.json');
    writeFileSync(cookieJarPath, JSON.stringify({
      cookies: [
        {
          name: 'MarqueeLogin',
          value: 'login-cookie',
          domain: 'marquee.gs.com',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
      updatedAt: Date.now(),
    }));

    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(
      () => {}, transport,
      undefined,
      { cookieJarPath },
    );

    try {
      await program.parseAsync(['browser', 'tab', 'new', 'https://marquee.gs.com/s/marketview/widget/MW123?config=WC1'], { from: 'user' });

      expect(transport.run).toHaveBeenCalledWith(
        'cookies',
        expect.arrayContaining(['set', 'MarqueeLogin', 'login-cookie']),
        { headed: false },
      );
      expect(transport.run).toHaveBeenCalledWith(
        'tab',
        ['new', 'https://marquee.gs.com/s/marketview/widget/MW123?config=WC1'],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('tab new fails before opening when browser cookie sync fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'marquee-tab-auth-fail-'));
    const cookieJarPath = join(dir, 'cookies.json');
    writeFileSync(cookieJarPath, JSON.stringify({
      cookies: [
        {
          name: 'MarqueeLogin',
          value: 'login-cookie',
          domain: 'marquee.gs.com',
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
      updatedAt: Date.now(),
    }));

    const write = vi.fn();
    const transport = createMockTransport({ '*': '' });
    transport.run.mockImplementation(async (command: string) => {
      if (command === 'cookies') {
        throw new Error('cookie daemon denied write');
      }
      return '';
    });
    const { program } = createProgram(
      write, transport,
      undefined,
      { cookieJarPath },
    );

    try {
      await program.parseAsync(['browser', 'tab', 'new', 'https://marquee.gs.com/s/marketview/widget/MW123?config=WC1'], { from: 'user' });

      expect(write).toHaveBeenCalledWith(expect.stringContaining('tab failed: cookie daemon denied write'));
      expect(process.exitCode).toBe(1);
      expect(transport.run).not.toHaveBeenCalledWith(
        'tab',
        ['new', 'https://marquee.gs.com/s/marketview/widget/MW123?config=WC1'],
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fails a tab new that lands on the sign-in page once it settles as unauthenticated', async () => {
    let output = '';
    let tabUrl = 'about:blank';
    const transport = createMockTransport();
    transport.run.mockImplementation(async (command: string, args: string[] = []) => {
      if (command === 'wait') tabUrl = 'https://idfs.gs.com/signin?flowId=vozrZ';
      if (`${command} ${args[0]}` === 'get url') return `${tabUrl}\n`;
      return 'https://marquee.gs.com/s/\n';
    });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'tab', 'new', 'https://marquee.gs.com/s/'], { from: 'user' });

    expect(output).toBe('Not authenticated. Run: marquee auth login\n');
    expect(process.exitCode).toBe(4);
  });

  it.each([
    ['open', 'https://marquee.gs.com/s/'],
    ['tab', 'new', 'https://marquee.gs.com/s/'],
  ])('reads the tab URL only after an idfsSSO resume settles back on Marquee: %j', async (...argv) => {
    let tabUrl = 'https://idfs.gs.com/signin?flowId=resume';
    const transport = createMockTransport();
    transport.run.mockImplementation(async (command: string, args: string[] = []) => {
      if (command === 'wait') tabUrl = 'https://marquee.gs.com/s/';
      if (`${command} ${args[0]}` === 'get url') return `${tabUrl}\n`;
      return 'ok\n';
    });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', ...argv], { from: 'user' });

    expect(process.exitCode).toBeUndefined();
  });

  it.each([
    [['--json']],
    [['--max-output', '100']],
  ])('fails a tab new after global flags %j that lands on the sign-in page', async (flags) => {
    let output = '';
    const transport = createMockTransport({
      'get url': 'https://idfs.gs.com/signin?flowId=vozrZ\n',
      '*': '{"success":true}\n',
    });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'tab', ...flags, 'new', 'https://marquee.gs.com/s/'], { from: 'user' });

    expect(output).toBe('Not authenticated. Run: marquee auth login\n');
    expect(process.exitCode).toBe(4);
  });

  it('passes a signed-in tab new through after checking the tab URL', async () => {
    let output = '';
    const transport = createMockTransport({
      'get url': 'https://marquee.gs.com/s/\n',
      '*': 'https://marquee.gs.com/s/\n',
    });
    const { program } = createProgram((chunk) => { output += chunk; }, transport);

    await program.parseAsync(['browser', 'tab', 'new', 'https://marquee.gs.com/s/'], { from: 'user' });

    expect(output).toBe('https://marquee.gs.com/s/\n');
    expect(process.exitCode).toBeUndefined();
    expect(transport.run).toHaveBeenCalledWith('wait', ['--fn', expect.stringContaining('input[name="username"]')]);
    expect(transport.run).toHaveBeenCalledWith('get', ['url']);
  });

  it.each([
    [['tab', 'new', 'https://example.com']],
    [['tab', 'close', 'https://marquee.gs.com/s/']],
    [['keyboard', 'type', 'new', 'https://marquee.gs.com/s/']],
  ])('does not check the tab URL after browser %j', async (argv) => {
    const transport = createMockTransport({ 'get url': 'https://idfs.gs.com/signin\n' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', ...argv], { from: 'user' });

    expect(transport.run).not.toHaveBeenCalledWith('get', ['url']);
    expect(process.exitCode).toBeUndefined();
  });

  it('tab close accepts a tab ref like agent-browser', async () => {
    const transport = createMockTransport({ '*': '' });
    const { program } = createProgram(() => {}, transport);

    await program.parseAsync(['browser', 'tab', 'close', 't29'], { from: 'user' });

    expect(transport.run).toHaveBeenCalledWith('tab', ['close', 't29']);
  });
});

