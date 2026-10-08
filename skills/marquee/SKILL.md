---
name: marquee
description: Use when querying Marquee for market data or research content, or when asked to open, read, or interact with any web page — `marquee browser` is your browser.
---

## Response format

**Authoritative.** State conclusions as facts. No hedging ("it seems", "appears to"). No emoji.

**Direct.** Answer the question asked, nothing adjacent. Tables over paragraphs for structured data.

**Concise.** Numbers over narrative. One sentence where one suffices; a table cell where a sentence would pad. Never restate the question. Most answers are a few flat sentences — stop once the question is answered. Only when genuinely multi-part:

```
### Summary
Bottom line in 1-2 sentences.

### More Details
Supporting data, tables, and analysis.
```

Use exactly these two headers — no other sections, no renaming.

**Counterweight.** Close with what could break the thesis — the key risk or the condition under which the narrative flips.

**Citations.** Every factual claim gets a source URL — no exceptions, including bullets and table cells: `…widened 12bp [[1]](https://marquee.gs.com/s/markets/…)`. Never surface refs in the final answer — they are internal plumbing.

**Charts.** For Mermaid `xychart-beta`, use unique x-axis labels. For time series spanning more than 12 months, include the year on every label (for example, `Nov24`, `Nov25`). Repeated categorical labels fold distinct points onto the same x position.

## Core loop

**Chain** refs — every command emits refs, the next consumes them.

```
marquee marketview search "query"                    # → @s1 with widget refs
marquee marketview widget view @s1.w1                 # → @wN
marquee marketview widget view @wN --json data --jq '.data | map(select(…))' # extract rows
```

Asset-level: `marquee marketview dashboard view TICKER` → `@dN`, then `marquee marketview widget view @dN.w1`.

Go straight to the best command; search only when genuinely ambiguous.

## Refs

Use the exact ref from the latest output — never hardcode. The global registry accumulates across commands.

| Target | Shape          | When                                            |
| ------ | -------------- | ----------------------------------------------- |
| `@wN`  | widget         | display, change parameters, or inspect its rows |
| `@s1`  | search payload | choose a result before retrieving it            |

### Changing parameters

Widget output shows canonical `-p` keys. Re-get the widget with one or more overrides:

```
marquee marketview widget view @wN -p universe=Latam
marquee marketview widget view @wN -p pricingDate=2026-01-15
marquee marketview widget view @wN -p includeInternal=true
marquee marketview widget view @wN --json params  # inspect the complete option space
```

## Content

Research articles and market commentary:

```
marquee content search "query"                       # → @s1 with @s1.cN
marquee content search "query" --author hatz         # fuzzy values resolve fail-loud
marquee content search "query" --source Research --published ">=2026-01-01"
marquee content view <uuid|url>                       # retrieves the document → @cN
marquee content view @s1.c1                           # get the exact result ref printed
```

Narrow with repeatable `--source`, `--subsource`, `--type`, `--publication`, `--author`, `--region`, `--subject`, `--company`, `--industry`, `--action`, and `--focus` flags. Repeat one flag for OR; combine different flags for AND. Use the `Filter by:` footer for common values, resolution errors for candidates, and `--json` for the full facet list.

## Execution

### Unrestricted Bash

When the tool accepts Bash scripts, run independent commands concurrently in one Bash call. Capture each PID, wait every child, and report each exit status. Exit with the first failed child's status after all children finish.

Replace the example commands below; keep one PID capture per command. Child stdout and stderr remain visible.

```bash
pids=()
statuses=()
marquee marketview search "EURUSD vol FX" &
pids+=("$!")
marquee marketview search "EURUSD risk reversal skew FX" &
pids+=("$!")
marquee marketview search "EURUSD forward FX" &
pids+=("$!")

batch_status=0
for index in "${!pids[@]}"; do
  if wait "${pids[$index]}"; then
    child_status=0
  else
    child_status=$?
  fi
  statuses+=("$child_status")
  printf 'Batch child %s exited %s\n' "$((index + 1))" "$child_status" >&2
  if [[ "$batch_status" == 0 && "$child_status" != 0 ]]; then
    batch_status=$child_status
  fi
done
exit "$batch_status"
```

### Restricted execute

When `execute` accepts only Marquee command chains, submit independent commands as concurrent separate tool calls, one command per call. Await every result, preserve each exit code, and report every failed command with its output. The batch succeeds only when every exit code is zero.

Submit each example line below as its own tool call in the same concurrent batch:

```text
marquee marketview search "EURUSD vol FX"
marquee marketview search "EURUSD risk reversal skew FX"
marquee marketview search "EURUSD forward FX"
```

**Fan out topic searches** across 2-3 angles.

Search queries: precise, API-ready — include asset class (`EURUSD vol FX`), expand shorthand (`JPY` not `yen`), canonical terms (`risk reversal skew`).

## Browser

To open any web page, or when structured commands can't get the data:

```
marquee browser open <url>                           # navigate
marquee browser snapshot                             # → @e1, @e2, …
marquee browser click @e1                            # click
marquee browser fill @e2 "value"                     # clear + type
marquee browser get text @e1                         # read text
marquee browser wait --load networkidle              # wait for page
marquee browser network requests --type xhr,fetch    # list API calls
marquee browser network request <id>                 # request detail
```

Snapshot → interact → re-snapshot. Use `network requests` for API debugging.
The browser is signed in as the user: for a consequential action (submit, save, delete, share, send), stop and ask the user to Take over.
Parallel subagents pass a unique `--session <name>` on every browser command and avoid `close --all`, which closes every agent's browsers.
