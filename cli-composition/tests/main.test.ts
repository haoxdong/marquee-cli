import { expect, it, vi } from 'vitest';

vi.mock('../signal-exit.js', () => ({ installSignalExitCodes: vi.fn() }));
vi.mock('../index.js', () => ({
  createProgram: () => ({
    program: { parseAsync: async () => {} },
    settlePendingDiagnostics: async () => {},
  }),
}));

it('installs the signal exit codes on the CLI process', async () => {
  const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  try {
    const { installSignalExitCodes } = await import('../signal-exit.js');

    await import('../main.js');

    expect(installSignalExitCodes).toHaveBeenCalledWith(process);
    expect(exit).toHaveBeenCalledWith(0);
  } finally {
    exit.mockRestore();
  }
});
