# Marquee CLI

A CLI and skill for the Marquee ecosystem — built for agents.

## Install

```bash
npm install -g @haoxdong/marquee-cli
```

Requires Node.js 24.0.0 or newer. The `marquee` skill is set up
automatically for Claude Code and Codex.

## Distribution

The distribution name is `@haoxdong/marquee-cli`, from the `haoxdong/marquee-cli`
repository and `marquee-cli/` package folder. The runtime binary and skill are both
`marquee`; the distribution suffix distinguishes the tool from Goldman Sachs Marquee.

Publishing uses the owner's npmjs account with 2FA and the public registry settings
in `package.json`. Run the distribution artifact hardening and leak gates before
publishing: public npm versions are immediately mirrored and have only a 72-hour
unpublish window. The postinstall script installs the bundled skill; it adds no
agent-host mutation verb to the CLI.

## Standalone cloud session

Set `MARQUEEBOT_SESSION` to your opaque MarqueeBot session to use account-scoped
Marquee reads through `https://api.marqueebot.com/marquee`. Keep this bearer secret.
`MARQUEEBOT_GATEWAY_URL` overrides that gateway for a configured deployment.
The account must have an active Goldman link and the required Marquee entitlements.
The gateway supports the Credential Service's existing read operations only.

The complete private invocation configuration (`MARQUEE_BASE_URL`,
`MARQUEEBOT_ACCOUNT_ID`, `MARQUEE_OWNER_SESSION_ID`, `MARQUEE_AUTH_TOKEN`) takes
precedence. Partial invocation configuration fails rather than falling back.
A browser session is never an invocation token. Without either configuration,
the CLI uses its existing local Goldman authentication.

Verify the required read in each assigned runtime. Configured gateway access does
not establish access for an unconfigured session or direct provider traffic.

### Browser sign-in from a state file

Set `MARQUEE_BROWSER_STATE` to a standard agent-browser state file
(`{"cookies": [...], "origins": []}`) and `marquee browser` signs its browser in to
Marquee Web with that file's cookies instead of the local Goldman sign-in. If
Marquee still sends a page to the sign-in, the command fails and names the file;
refresh the file and run it again. Plain agent-browser uses the same file:

```bash
agent-browser --state "$MARQUEE_BROWSER_STATE" open https://marquee.gs.com/s/
```

## License

Marquee CLI is an independent, third-party tool: not affiliated with, endorsed by, or
sponsored by Goldman Sachs. Using it requires your own valid Marquee entitlement — the
CLI cannot access anything your browser session could not.

See `LICENSE.md` for terms (free to install and use; no redistribution or modification).

## Troubleshooting

In proxy-only sandboxes, a `NO_PROXY` entry such as `.gs.com` can route `marquee.gs.com` around the configured proxy and cause `ERR_NAME_NOT_RESOLVED`. Remove the matching Goldman Sachs domain from `NO_PROXY`, or keep only local browser bypasses for the command: `NO_PROXY= no_proxy= AGENT_BROWSER_PROXY_BYPASS="localhost,127.0.0.1" marquee auth login`.

The bundled skill normally installs through npm's `postinstall`. If installation
used `--ignore-scripts`, or npm script approval (`allowScripts`) blocked it, approve
the package's lifecycle script and repair with:

```bash
npm rebuild -g @haoxdong/marquee-cli --foreground-scripts
```

`--foreground-scripts` exposes installation warnings, including a foreign skill
already occupying the target. Supported host targets and `MARQUEE_SKILL_TARGETS`
selection are defined in `scripts/install-skill.mjs`.

## Request debugging and tracing

`MARQUEE_DEBUG` follows GitHub CLI's `GH_DEBUG`. `MARQUEE_DEBUG=1` prints each Marquee request's method, URL, status, and duration to stderr; `MARQUEE_DEBUG=api` adds headers, bodies, and canceled requests, masks authorization, cookie, and token headers, recursively redacts credential fields and JWT-shaped values in bodies with the same rules that sanitize Recordings, so a token-exchange response never prints a usable credential, and skips response bodies over 100 KB. It is listed in help, read by people, and replaces `MARQUEE_API_LOG`, `MARQUEE_API_TIMING_LOG`, `MARQUEE_TRACE_LOG`, and `MARQUEE_FAILURE_LOG`. Tests no longer parse stderr; one golden-string test pins the format.

**Tracing** draws a command's flow as a timeline, the convention from Dapper to Bazel's trace profile. The OpenTelemetry Node SDK with its automatic fetch instrumentation traces every Marquee request under one root span per command; export is enabled by the standard `OTEL_TRACES_EXPORTER=otlp`, as in Terraform and OpenTofu, and viewed in Jaeger locally. When `TRACEPARENT` names a W3C trace context, the root span starts as its child, so a parent process, such as an agent's shell, nests each command under its own span; no trace headers are sent to Marquee. The root span also records how the command ended (ADR 0085): its arguments, exit status, error class (`usage`, `authentication-required`, `cancelled`, `rate-limited`, `unavailable`, `rejected` or `failure`), each `(failed: <reason>)` module and `Error:` line, and the CLI version. Cookies, `Authorization` headers, tokens, session ids and signed URLs are stripped from every span before export. There are no hand-written step spans and no persistent trace backend. Traces are never asserted, except by one unit test of the tracing setup, which checks the root span's name, service, parent from `TRACEPARENT` and recorded outcome, that request spans are its children, and that no secret is exported, as the one golden-string test pins the `MARQUEE_DEBUG` format; no test asserts a command's flow or internal module spans.
