import {
  createMockTransport,
  createProgram,
  describe,
  expect,
  it,
} from './cli-test-harness.js';
import type { Command } from 'commander';

function commandAt(root: Command, path: string[]): Command {
  return path.reduce((parent, name) => {
    const command = parent.commands.find((candidate) => candidate.name() === name);
    if (!command) throw new Error(`command not found: ${path.join(' ')}`);
    return command;
  }, root);
}

function configureOutput(
  command: Command,
  writeOut: (chunk: string) => void,
  writeErr: (chunk: string) => void = writeOut,
): void {
  command.configureOutput({ writeOut, writeErr });
  command.commands.forEach((child) => configureOutput(child, writeOut, writeErr));
}

const nonBrowserCommandLevels = [
  { label: 'marquee', path: [] },
  { label: 'marquee marketview', path: ['marketview'] },
  { label: 'marquee marketview search', path: ['marketview', 'search'] },
  { label: 'marquee marketview widget', path: ['marketview', 'widget'] },
  { label: 'marquee marketview widget view', path: ['marketview', 'widget', 'view'] },
  { label: 'marquee marketview dashboard', path: ['marketview', 'dashboard'] },
  { label: 'marquee marketview dashboard view', path: ['marketview', 'dashboard', 'view'] },
  { label: 'marquee marketview dashboard edit', path: ['marketview', 'dashboard', 'edit'] },
  { label: 'marquee marketview dashboard create', path: ['marketview', 'dashboard', 'create'] },
  { label: 'marquee content', path: ['content'] },
  { label: 'marquee content search', path: ['content', 'search'] },
  { label: 'marquee content view', path: ['content', 'view'] },
  { label: 'marquee auth', path: ['auth'] },
  { label: 'marquee auth status', path: ['auth', 'status'] },
  { label: 'marquee auth login', path: ['auth', 'login'] },
  { label: 'marquee auth logout', path: ['auth', 'logout'] },
] as const;

const bareHelpCommandLevels = [
  { label: 'marquee', path: [] },
  { label: 'marquee marketview', path: ['marketview'] },
  { label: 'marquee content', path: ['content'] },
  { label: 'marquee auth', path: ['auth'] },
] as const;

describe('help registration', () => {
  it('does not advertise a generated root help command', () => {
    const { program } = createProgram(() => {}, createMockTransport());

    expect(program.helpInformation()).not.toContain('help [command]');
  });

  it.each([
    { label: 'marquee marketview', path: ['marketview'] },
    { label: 'marquee marketview widget', path: ['marketview', 'widget'] },
    { label: 'marquee marketview dashboard', path: ['marketview', 'dashboard'] },
    { label: 'marquee content', path: ['content'] },
    { label: 'marquee auth', path: ['auth'] },
  ])('$label does not advertise a generated help command', ({ path }) => {
    const { program } = createProgram(() => {}, createMockTransport());

    expect(commandAt(program, path).helpInformation()).not.toContain('help [command]');
  });

  it('lists MARQUEE_DEBUG under ENVIRONMENT in root help only', () => {
    const { program } = createProgram(() => {}, createMockTransport());

    expect(program.helpInformation()).toContain(
      '\n\nENVIRONMENT\n  MARQUEE_DEBUG   Set to 1 to log each Marquee request on stderr, or api to add headers and bodies\n\n',
    );
    expect(commandAt(program, ['auth']).helpInformation()).not.toContain('ENVIRONMENT');
  });

  it('leaves the delegated browser help command unchanged', () => {
    const { program } = createProgram(() => {}, createMockTransport());

    expect(commandAt(program, ['browser']).helpInformation()).toMatch(/^ {2}help: /m);
  });

  it('browser help lists its Marquee-owned commands and forwards every other one', () => {
    const { program } = createProgram(() => {}, createMockTransport());
    const browser = commandAt(program, ['browser']);

    expect(browser.helpInformation()).toContain([
      'Interact with Marquee pages in a browser',
      '',
      'USAGE',
      '  marquee browser <command> [flags]',
      '',
      'COMMANDS',
      '  open:       Open in browser',
      '  close:      Shut down browser session',
      '  snapshot:   Show interactive element refs',
      '  eval:       Evaluate raw JS in browser',
      '  is:         Check element state',
      '  help:       Display help for command',
      '',
      'ARGUMENTS',
      '  [<command>...]   Any other agent-browser command, forwarded verbatim with its flags',
      '',
      'FLAGS',
      '  --session <name>   Browser Session to run in (default: AGENT_BROWSER_SESSION, then marquee-<hash> of the agent host session, else marquee)',
    ].join('\n'));
    expect(commandAt(browser, ['is']).helpInformation()).toContain([
      'ARGUMENTS',
      '  <state>   Visible, enabled, or checked',
      '  <ref>     Element ref or selector',
    ].join('\n'));
  });

  it('a leaf command shows its help despite an extra operand', async () => {
    const { program } = createProgram(() => {}, createMockTransport());
    configureOutput(program, () => {});

    await expect(
      program.parseAsync(['auth', 'status', 'extra', '--help'], { from: 'user' }),
    ).rejects.toMatchObject({ code: 'commander.helpDisplayed', exitCode: 0 });
  });

  it('a mistyped subcommand without --help gets its nearest match suggested', async () => {
    const { program } = createProgram(() => {}, createMockTransport());
    let output = '';
    configureOutput(program, (chunk) => { output += chunk; });

    await expect(
      program.parseAsync(['auth', 'statsu'], { from: 'user' }),
    ).rejects.toMatchObject({ code: 'commander.unknownCommand' });
    expect(output).toContain('(Did you mean status?)');
  });

  it.each(bareHelpCommandLevels)('$label without arguments prints the same help to stdout', async ({ path }) => {
    const bare = createProgram(() => {}, createMockTransport()).program;
    let bareStdout = '';
    let bareStderr = '';
    configureOutput(
      bare,
      (chunk) => { bareStdout += chunk; },
      (chunk) => { bareStderr += chunk; },
    );

    await bare.parseAsync(path, { from: 'user' });

    const explicit = createProgram(() => {}, createMockTransport()).program;
    let explicitStdout = '';
    configureOutput(explicit, (chunk) => { explicitStdout += chunk; });
    await expect(
      explicit.parseAsync([...path, '--help'], { from: 'user' }),
    ).rejects.toMatchObject({
      code: 'commander.helpDisplayed',
      exitCode: 0,
    });

    expect(bareStdout).toBe(explicitStdout);
    expect(bareStderr).toBe('');
  });

  it.each([
    { label: 'marquee help', path: ['help'] },
    { label: 'marquee help marketview', path: ['help', 'marketview'] },
    { label: 'marquee marketview help', path: ['marketview', 'help'] },
    { label: 'marquee marketview widget help', path: ['marketview', 'widget', 'help'] },
    { label: 'marquee marketview dashboard help', path: ['marketview', 'dashboard', 'help'] },
    { label: 'marquee content help', path: ['content', 'help'] },
    { label: 'marquee auth help', path: ['auth', 'help'] },
  ])('$label is not a registered command', async ({ path }) => {
    const { program } = createProgram(() => {}, createMockTransport());
    configureOutput(program, () => {});

    await expect(program.parseAsync(path, { from: 'user' })).rejects.toMatchObject({
      code: 'commander.unknownCommand',
    });
  });

  it.each(nonBrowserCommandLevels.flatMap(({ label, path }) => [
    { label, path, flag: '-h' },
    { label, path, flag: '--help' },
  ]))('$label $flag prints help and exits successfully', async ({ path, flag }) => {
    const { program } = createProgram(() => {}, createMockTransport());
    let output = '';
    configureOutput(program, (chunk) => { output += chunk; });

    await expect(
      program.parseAsync([...path, flag], { from: 'user' }),
    ).rejects.toMatchObject({
      code: 'commander.helpDisplayed',
      exitCode: 0,
    });
    expect(output).toMatch(/^USAGE\n {2}\S.*\n\n/m);
    expect(output).toMatch(/\n\nLEARN MORE\n {2}\S/);
  });

  it.each(commandsWithJson())('$label help lists the same JSON FIELDS as bare --json', async ({ path, args }) => {
    const help = commandAt(createProgram(() => {}, createMockTransport()).program, path).helpInformation();
    const helpFields = /\nJSON FIELDS\n((?: {2}.*\n)+)/.exec(help)?.[1]
      ?.split(/,\s*/).map((field) => field.trim()).filter(Boolean);

    const { program } = createProgram(() => {}, createMockTransport());
    let stderr = '';
    configureOutput(program, () => {}, (chunk) => { stderr += chunk; });
    await expect(program.parseAsync([...path, ...args, '--json'], { from: 'user' })).rejects.toThrow();
    const bareJsonFields = stderr.split('\n').filter((line) => line.startsWith('  ')).map((line) => line.trim());

    expect(bareJsonFields.length).toBeGreaterThan(0);
    expect(helpFields).toEqual(bareJsonFields);
  });
});

function commandsWithJson(): { label: string; path: string[]; args: string[] }[] {
  const { program } = createProgram(() => {}, createMockTransport());
  const found: { label: string; path: string[]; args: string[] }[] = [];
  const visit = (command: Command, path: string[]): void => {
    if (command.options.some((option) => option.flags === '--json [fields]')) {
      found.push({
        label: ['marquee', ...path].join(' '),
        path,
        args: command.registeredArguments.filter((arg) => arg.required).map(() => 'x'),
      });
    }
    command.commands.forEach((child) => visit(child, [...path, child.name()]));
  };
  visit(program, []);
  return found;
}
