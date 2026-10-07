# Marquee CLI

A CLI and skill for the Marquee ecosystem — built for agents.

## Install

```bash
npm install -g @haoxdong/marquee-cli
```

Requires Node.js 24.0.0 or newer. The `marquee` skill is set up
automatically for Claude Code and Codex.

## License

Marquee CLI is an independent, third-party tool: not affiliated with, endorsed by, or
sponsored by Goldman Sachs. Using it requires your own valid Marquee entitlement — the
CLI cannot access anything your browser session could not.

See `LICENSE.md` for terms (free to install and use; no redistribution or modification).

## Troubleshooting

In proxy-only sandboxes, a `NO_PROXY` entry such as `.gs.com` can route `marquee.gs.com` around the configured proxy and cause `ERR_NAME_NOT_RESOLVED`. Remove the matching Goldman Sachs domain from `NO_PROXY`, or keep only local browser bypasses for the command: `NO_PROXY= no_proxy= AGENT_BROWSER_PROXY_BYPASS="localhost,127.0.0.1" marquee auth login`.
