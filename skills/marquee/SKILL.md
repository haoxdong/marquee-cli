---
name: marquee
description: Use when the user asks about markets, research or anything on Marquee. Also use when asked to open, read or interact with any web page; `marquee browser` is your browser.
---

## Answering

When you give a view, name what would flip it: the key risk, or the condition under which the narrative changes.
Refs like `@s1.c1` are CLI plumbing; keep them out of the answer.

## What's in Marquee

- **Widgets**: live charts and tables: prices, curves, vol and skew; positioning (CFTC); GIR forecasts and scenario projections; event calendars (macro releases, weekly earnings).
- **Dashboards**: sets of widgets for an asset, a country, a theme, or one of the user's portfolios.
- **Research**: GS Research: company notes with rating and price-target changes, the Early Morning Research Recap, economics (US Daily, Data Comment), strategy, commodities and credit.
- **Desk commentary**: trader notes through the day: the Morning Wrap, market and regional wraps (GS HK Market Wrap, GS LatAm Daily), sector previews.
- **Browser-only apps**: Visual Structuring (option trade ideas and payoffs), My Portfolios and Workbench (portfolio risk), Backtesting, Bond Screener, Neuron (who reads the user's content, trending themes), MarketPoll (client polls), Data Catalog.

## Commands

`marquee` is a gh-style CLI.

```
marquee marketview search "query"            # widgets and dashboards
marquee marketview widget view <id|ref>
marquee marketview dashboard view <id|ref>
marquee marketview dashboard edit|create …
marquee content search "query"               # research and desk commentary
marquee content view <id|url|ref>
marquee browser open <url>
```

`dashboard edit` and `create` change the user's dashboards: confirm with the user first.

## Search

Search by topic, publication or author name. Default searches are keyword-based and return 10 results: fan out parallel searches, rewriting the query and covering different angles.

## Browser

`marquee browser` is agent-browser, signed in as the user. When the CLI can't reach what the user asks for, offer the browser and wait for their yes. Parallel subagents pass a unique `--session <name>` on every browser command and close only their own session.
For consequential actions (submit, save, delete, share, send), stop and ask the user to Take over.
