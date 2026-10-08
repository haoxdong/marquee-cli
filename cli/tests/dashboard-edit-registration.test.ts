import type { ConfigId, WidgetId } from '../../widget/index.js';
import {
  afterEach,
  createArtifactRegistry,
  createProgram,
  describe,
  expect,
  it,
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from './cli-test-harness.js';
import type { DashboardModule } from '../../dashboard/index.js';

afterEach(() => {
  process.exitCode = undefined;
});

describe('Dashboard edit registration', () => {
  it('renders a canonical Dashboard mutation through the MarketView owner', async () => {
    process.exitCode = undefined;
    let output = '';
    const refsDirectory = mkdtempSync(join(tmpdir(), 'dashboard-edit-registration-'));
    const registry = createArtifactRegistry(refsDirectory, process.ppid);
    registry.setRefs('d1', {
      d1: { type: 'dashboard', dashboardId: 'MD_MACRO' },
      'd1.w1': {
        type: 'widget',
        widgetId: 'MW_OLD' as WidgetId,
        configurationId: 'WC_OLD' as ConfigId,
        dashboardId: 'MD_MACRO',
        childId: 'CHILD_OLD',
        selectedContext: null,
      },
    });
    const before = {
      dashboardId: 'MD_MACRO',
      name: 'Macro Desk',
      kind: 'custom',
      tags: [],
      permissions: { viewers: [], editors: ['guid:owner'], administrators: [] },
      children: [{
        kind: 'widget',
        childId: 'CHILD_OLD',
        rank: 1,
        widget: { widgetId: 'MW_OLD' as WidgetId, configurationId: 'WC_OLD' as ConfigId },
        name: 'Old widget',
        parameters: [],
      }],
      sections: [],
      link: 'https://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
    } as const;
    const after = { ...before, children: [] };
    const unexpected = async (): Promise<never> => {
      throw new Error('unexpected Dashboard operation');
    };
    const dashboard: DashboardModule = {
      get: unexpected,
      create: unexpected,
      async edit(_target, changes) {
        return {
          ok: true,
          value: {
            before,
            dashboard: after,
            results: changes.map((change) => ({
              change,
              status: 'applied' as const,
              dashboard: after,
            })),
          },
        };
      },
    };
    const { program } = createProgram(
      (chunk) => { output += chunk; }, undefined, refsDirectory,
      { dashboard },
    );

    try {
      await program.parseAsync([
        'marketview', 'dashboard', 'edit', '@d1', '--remove-widget', '@d1.w1',
      ], { from: 'user' });

      expect(output.trim()).toBe([
        'ref:\t@d1',
        'url:\thttps://marquee.gs.com/s/marketview/dashboards/MD_MACRO',
        '',
        'Applied',
        'action\ttarget\tresult',
        'remove\t@d1.w1\tapplied',
      ].join('\n'));
      expect(process.exitCode).toBeUndefined();
    } finally {
      rmSync(refsDirectory, { recursive: true, force: true });
    }
  });

  it('rejects an empty order before reading the Dashboard', async () => {
    let output = '';
    let error = '';
    const { program } = createProgram(
      (chunk) => { output += chunk; }, undefined, undefined,
      { writeError: (chunk) => { error += chunk; } },
    );

    await program.parseAsync([
      'marketview', 'dashboard', 'edit', 'MD_MACRO', '--order', ', ',
    ], { from: 'user' });

    expect(output).toBe('');
    expect(error.trim()).toBe('Error: --order requires a comma-separated list of refs');
    expect(process.exitCode).toBe(1);
  });
});
