# Marquee data

`marquee data eval` runs PlotTool Expressions, the syntax of Marquee's PlotTool: a Class before the dot (an Entity, which is an asset, country or portfolio, by its bare id; or a constructor Class with its id), a Measure after it, and Functions around both. Write the Expression yourself and run it: a rejected one prints the nearest names or the search that finds the id, so a guess costs less than a lookup first. Answer from one eval holding every series the question needs; research is for a question that asks why.

## Write

Write one of these, wrapping it in Functions or arithmetic as the question needs:

```
<asset>.spot()                              a price or level
<root><n>.spot()                            a future's price, n = 1 for the front month, 2 for the next where listed; a commodity's whole curve is in a forward curve widget
Dataset(EQFUTURES).fair_value(<root><n>)    GS fair value of an equity index future; ES2 less ES1 for the calendar spread's
<metal>USD.spot()                           gold or silver in dollars
<crypto>.reference_rate()                   a cryptocurrency in dollars, <crypto> its ticker: BTC, ETH
<asset>.implied_volatility(<tenor>, <strike_reference>, <relative_strike>)   implied vol
<index>.implied_correlation(<tenor>, delta_call, 50)   an index's implied correlation, for dispersion; average_implied_volatility(…) its members' average vol, realized_correlation(<tenor>) the realized
<ccy>.swap_rate(<tenor>, <benchmark>, <floating_tenor>, <forward_tenor>, <clearing_house>)   a swap rate
<ccy>.swaption_vol(<expiry>, <tenor>)       a swaption vol
<ccy><ccy>.forward_point(<tenor>)           FX forward points, as a price difference
<country> <market> <years>Y GOVN.yield()    a government bond yield
<cds index>.spread()                        a CDS index spread
<ticker> <exchange>.fe_<statistic>_<period>(<item>, <args>)   a stock's FactSet consensus estimate
<ticker> <exchange>.ff_<item>_qf()          a stock's reported fundamental, quarterly (_af annual); start two years back
<ticker> <exchange>.daily_short_interest()  a stock's S3 Partners short interest, in shares; s3_short_interest_percent() as a decimal
<country>.cai(<component>)                  a GS Current Activity Indicator
<country>.fci(<component>)                  a GS Financial Conditions Index or one of its contributions
<country>.economic_forecast(<args>)         a GS economic forecast
FRED(<series>).value()                      a FRED series
FRED(DGS10).value() - FRED(DFII10).value()  the US 10y breakeven inflation rate (DGS5, DFII5 for 5y)
HAVER(<code>, <database>).value()           a Haver series
HAVER(NJKR<nn>S, CMDTY).value()             JKM LNG's nth month, 01 to 12: its curve in one eval
MarketCoordinate(<coordinate>).value()      an MDAPI market coordinate
<class>(<id>).<measure>(<args>)             any other constructor Class's Measure
<id>.<measure>(<args>)                      any other Measure, on the id bare
<function>(<expression>, <args>)            a Function around a series
<expression> - <expression>                 arithmetic between series
```

Fill each `<…>`:

```
<asset>                                <ticker> <exchange> (a stock or ETF), <index>, or <ccy><ccy> (an FX cross)
<ticker> <exchange>                    a Bloomberg ticker and exchange code, space between
<index>                                a Bloomberg index ticker, bare
<ccy>                                  a fiat ISO currency code; <ccy><ccy> two, joined
<root><n>                              a Bloomberg generic future root and the contract's place, joined
<metal>                                XAU for gold, XAG for silver
<tenor>, <expiry>                      a number and a lowercase unit: 1w, 3m, 10y
<strike_reference>                     spot, forward, delta_call, delta_put, delta_neutral or normalized
<relative_strike>                      percent of spot or forward (100 at the money), a delta (25, 50), or 0 with delta_neutral
<benchmark>                            the floating rate's name: an overnight rate such as SOFR, SONIA or EUROSTR, or an IBOR
<floating_tenor>                       1y on an overnight rate; an IBOR's own tenor, such as 3m
<forward_tenor>                        Spot, or the tenor the swap starts in
<clearing_house>                       LCH, EUREX, JSCC, CME or NONE
<country>                              an ISO country code
<market> <years>Y                      the bond market's name (Treasury for US, Gilt for GB, Bund for DE, JGB for JP) and the tenor in years; a wrong name prints the nearest right ones, and other countries' curves are in widgets
<statistic>, <period>                  mean or median; ntm, stm, lt, or af with a fiscal year offset as a number
<cds index>                            ITRXEBE for iTraxx Main, ITRXEXE Crossover, IBOXUMAE CDX IG, IBOXHYSE CDX HY: 5y, on the run
<component>                            CAI_HEADLINE for a CAI; fci for an FCI, and <driver>_contribution for its drivers: long_rates, short_rates, corporate_spread, equities, twi
<item>                                 an upper-case code, listed in the family's Quickstart folder
<series>, <code>, <database>           the vendor's own id; <coordinate> quoted
```

A wrong strike_reference, benchmark or clearing_house prints every argument's choices.

- Write Measures in snake_case and pass arguments by position; quote strings inside an Expression with double quotes, but write an id bare.
- Pass every argument a line shows: a left-out one can differ from its listed default.
- Set the window relative to today, as the question words it: `--start-date -3m`, `-ytd`, `-1y` (the default) or `-5y`, leaving `--end-date` at today. First to Last in Statistics is then the change asked about. A term structure's points lie ahead of today: `--start-date 0d --end-date 3y`.
- Several Expressions run as one batch and can assign names:

```bash
marquee data eval 'a = <expression>' 'b = <expression>' '<function>(a, b, <args>)' --start-date <start>
```

## Windows

Functions compute on daily points; `--interval` only thins what prints, so put windows inside the function.
A tenor (`1w`, `1y`) counts time; a bare number counts points, as monthly series need.
A window reads only points inside the dates, so start earlier by the window.
Rates and spreads change in absolute terms, not as returns.

## Read

Statistics gives each Expression's low, high, first, last, median, average, standard deviation, z-score and percentile over the window; First to Last is the change over it. Data lists the 30 newest points; `--interval 1w` spaces them a week apart over a longer window (`1m` fails on some series). For a chart or every point, run the eval once with `--json results > <file>` and read the file in Python: each result holds its `expression`, `statistics` and every dated point in `values` (`{date, value}`), assignments included, in order.
Today's point on a price is live; other series end at the last close.
Read units from the last value: a rate prints in percent or as a decimal, depending on its Class.
An Expression with no points, or a newest Data row months back, may name a discontinued series: try the next search result.

## Look up

A rejected Expression prints the nearest names and the right signature: fix it from those. When you don't know an id, search the plain name of what the question asks for, without `--class` (one search covers every Class), and in the same run list the nearest [Quickstart](#quickstart) folder: its recipes name ids a search misses. Look up a Measure or an argument the same way:

```
marquee data search "query" & marquee data list examples "<folder>" & wait
marquee data search "query" [--class <class>]    # every Class, 5 rows each, or one in depth
marquee data view <target>                       # a row's Class(args), an Entity id, a Class or a Function
marquee data list <list> [<folder>]              # functions, classes or examples
```

A search row's `Class(args)` and one of its Measures paste into `eval` as `Class(args).Measure()`. Entity and Dataset rows list no Measures, as each instance has its own: run the row's View command. `--limit` sets the rows of a `--class` search.

## Quickstart

`marquee data list examples "<folder>"` prints a folder's Expressions, worked recipes by topic. Folders by collection:

```text
Credit: Credit - Vol, Credit - CDS Indices, Credit - Macro views, Credit Indices
Vendor Data: Equity Barra Factor Models, Equity - S3 Partners Short Interest, Equity - Wolfe Risk Models, Haver Widgets, Factset Equity Fundamentals, FactSet Consensus Esimates
Equity: Equity - Vol RV, Equity - DM Vol, Equity - Baskets, Equity - Calendar Spreads, Equity - Factors, Equity - Financials, Equity - Forwards, Equity - Options, Equity - Portfolio Analytics, Equity - Retail Analytics, Equity - Single Stock Vol Dispersion, Equity - Variance Swap, Equity - Vol Dispersion, Equity - Vol Swaps, Equity Fundamentals, Liquidity Analytics - Equities, Equity - Backtesting, MarketView Widgets (Equity BT)
Others: US 2024 Presidential Elections, Macro, Cross Asset, Cryptocurrency, Economic Data, Elections - UK, Elections - US, Execution and Liquidity, Futures, Global Investment Research, Linear Regression, Market Coordinate (MDAPI), Risk Premia, TSDB, Weather
FX: FX Positioning, FX - Historical Option Prices, FX - Backtesting/Returns, FX - Correlation, FX - Spot, FX - Term Structure, FX - Volatility, FX Demo, Liquidity Analytics - FX, FX - Backtesting Option Strategies, Backtesting - Transaction Costs, Crypto Option Backtesting, MarketView Widgets (FX BT)
Quickstart: EU Thematics, Americas Thematic, FX, Rates - Historical Swap Pricing
Commodity: Commodities - Forwards, Commodities - Natgas, Commodities - Oil, Commodities - Power, Liquidity Analytics - Commodities
Rates: Rates - Swaps, Rates - Basis Swaps, Rates - Bonds, Rates - Cap/Floor Vol, Rates - Central Banks, Rates - Curves, Rates - Inflation, Rates - Midcurves, Rates - Swaptions, Rates - Term Structures, Rates - Xccy Bases, Liquidity Analytics - Rates, Rates - Backtesting, TP ICAP Webinar - Backtesting
Getting Started: Getting Started with PlotTool Pro
```
