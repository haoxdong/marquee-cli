# Install Marquee CLI

The CLI package is public on npm. The plugin marketplace and source repository (`haoxdong/marquee-cli`) are public read-only distribution mirrors. Using the CLI requires a Marquee entitlement.

## Install from npm

```bash
npm install --global @haoxdong/marquee-cli
marquee --help
```

The package postinstall step installs the shared `skills/marquee/SKILL.md` into Claude Code, and into each other supported agent whose config directory exists. It does not replace an existing user-owned `marquee` skill.

## Install the plugin

In Claude Code, add the marketplace and install the plugin:

```text
/plugin marketplace add haoxdong/marquee-cli
/plugin install marquee@marquee-private
```

The equivalent terminal commands are:

```bash
claude plugin marketplace add haoxdong/marquee-cli
claude plugin install marquee@marquee-private
```

The Claude and Codex plugin manifests both load the same `skills/marquee/SKILL.md`. The plugin supplies the workflow; install the npm package as described above on any machine that also needs the `marquee` executable.

The marketplace keeps the name `marquee-private` for compatibility with existing installations. The name does not restrict access. See [CONTRIBUTING.md](CONTRIBUTING.md) for the mirror policy.
