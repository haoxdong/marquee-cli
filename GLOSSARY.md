# Marquee CLI Context

The Marquee CLI retrieves Marquee artifacts (MarketView Widgets and Dashboards, and Content) for agents and people. Its relationships to Marquee and to the agent platform are in [GLOSSARY-MAP.md](../GLOSSARY-MAP.md).

## Language

### CLI

**Command Group**:
A stable top-level public noun in the CLI grammar: `marketview`, `content`, `auth`, or `browser`. It organizes public verbs and nested nouns but does not establish a domain identity.
_Avoid_: CLI Surface, Surface (unqualified), category, namespace, asset surface

**Verb**:
The single action word that ends every CLI command, after a path of one or two nouns and before any arguments. The closed product vocabulary is `search`, `view`, `edit`, and `create`, with `explain`, `list`, `delete`, `describe`, and `apply` reserved for future capabilities; the `auth` and delegated `browser` Command Groups keep their own verbs.
_Avoid_: subcommand (ambiguous between nouns and verbs)

**CLI Interaction Session**:
A host-supplied identity that scopes one set of Artifacts: an agent conversation shares it across its main agent, subagents, and all their commands, and a human terminal shares it across its commands. A new identity starts empty, and an inactive one may expire without an explicit close.
_Avoid_: cwd session, process session, repository session, explicit-close lifecycle

**Artifact**:
A CLI result instance with a typed identity, scoped to one CLI Interaction Session and reusable by later commands through a Ref. The families are MarketView Search, Content Search, Widget, Dashboard, Entity Feed, Section, and Document; cached payloads, links, parameters, facets, and rendered data are Artifact state, not Artifacts. A nested Artifact keeps its own identity under one parent: a search finds Widgets, Dashboard Surfaces, and Documents without owning them or granting edit rights, while a Dashboard's Widget member also carries its Dashboard and Dashboard Child.
_Avoid_: provider object, arbitrary cache record, response envelope, Widget Snippet

**Ref**:
The stored name of an Artifact instance, such as `@w1`, `@d1`, `@s1`, or `@c1`. A dot means membership (`@s1.w1` is Widget 1 of search 1), never property access.
_Avoid_: attribute refs, property refs, `.data`/`.link` child refs, `@cm`/`@cr` prefixes

**Browser Session**:
One isolated agent-browser browser, with its own tabs and page state, named by the caller in agent-browser's own terms. Unnamed commands share one Browser Session per CLI Interaction Session; parallel subagents that browse name their own, while still sharing that CLI Interaction Session's Artifacts. An idle Browser Session ends on its own.
_Avoid_: session (bare), Marquee session, lease, pool slot

### MarketView

**Product Surface**:
A user-facing access point in Marquee Web, such as a saved dashboard, entity feed, or content page. It describes where users meet domain behavior, not a module or a CLI noun.
_Avoid_: Surface (unqualified), Command Group

**Widget**:
A saved, shareable MarketView definition identified by an `MW...` ID. It owns its metadata, category, parameter schema, supported contexts, and render target.
_Avoid_: Unconfigured Widget, WidgetPicture, PlotTool Pro, DataViz

**Widget Definition**:
The whole value of one Widget, including the definition state needed to render it: the blank form that a Widget Config fills. It is distinct from rendered data and from the CLI's presentation of the Widget.
_Avoid_: Widget Data, Widget payload, Widget output

**Widget Config**:
A saved set of Widget parameter and date choices identified by a `WC...` ID and owned by one Widget. Rendering does not need one when the other render values are known.
_Avoid_: context, widget context

**Configured Widget**:
A Widget paired with a Widget Config. It is one optional saved form of a Widget, not the identity every Widget Artifact must have.
_Avoid_: Widget Artifact, Widget Config, Dashboard child

**Widget Artifact**:
A Widget identity stored by the CLI: Widget ID plus optional Widget Config ID and Selected Context. It names a Widget for a later command and is not a snapshot of rendered values.
_Avoid_: Configured Widget (when the Config ID is absent), Widget cache, render snapshot

**Widget Render**:
Rendering a Widget from exactly four values: Widget Definition, Widget Parameter Overrides, Selected Context, and Widget Dates. It neither needs nor creates a Widget Config.
_Avoid_: Widget Resolve, Widget Hydration, Widget Loader

**Widget Dates**:
A Widget's optional date-range state: start date, end date, interval, and an optional Relative Date rule. It is absent when the Widget has no date range.
_Avoid_: Relative Date alone, Widget Parameter, date fallback

**Relative Date**:
A lookback rule, such as `1M`, `YTD`, or `5Y`, that sets a Widget's date range relative to today instead of by fixed start and end dates. It belongs to Widget Dates, not to Widget Parameters.
_Avoid_: date range, lookback window, relative parameter

**Widget Parameter**:
A named, typed input declared by a Widget, whose current, entity-specific, or default value a Widget Config may bind.
_Avoid_: Control, Entity, Relative Date, parameter (unqualified)

**Widget Parameter Override**:
One ordered field-and-value change applied on top of a Widget's base parameters, where later overrides win. A Relative Date is not one.
_Avoid_: Widget Parameter Assignment, binding, parameter state

**Control**:
An extra selectable input exposed by a Control Widget, such as a cross, asset, country, portfolio, or enum, whose selected value is passed to its PlotTool Pro Chart.
_Avoid_: Relative Date, Widget Parameter, Entity

**Control Widget**:
A Widget that exposes Control inputs and delegates data execution to PlotTool Pro. The name is the CLI's own: Marquee Web gives it no separate name and classifies Widgets only as Plot or DataViz.
_Avoid_: PlotTool Pro, standalone dashboard filter, any interactive Widget

**Plot Widget**:
A Widget category whose expressions PlotTool Pro evaluates and plots. It may expose PlotTool Pro interaction such as Relative Date but has no Controls.
_Avoid_: PlotTool Pro, Control Widget, DataViz Widget

**PlotTool Pro**:
Marquee's charting engine that owns Charts, evaluates expressions, and plots the resulting series for Plot Widgets and Control Widgets.
_Avoid_: Plot, Widget, Control Widget, DataViz

**Chart**:
A saved PlotTool Pro definition identified by a `CH...` ID, declaring expressions, controls, and time and display settings.
_Avoid_: PlotTool Pro, Widget, DataViz, standalone Chart module

**DataViz**:
The rendering engine that turns structured component inputs into a visualization or table.
_Avoid_: Render, PlotTool Pro, Widget

**DataViz Widget**:
A Widget category rendered by DataViz.
_Avoid_: DataViz, Plot Widget, Control Widget

**PTP Widget**:
The common product name for a PlotTool Pro-backed Widget: a Plot Widget or a Control Widget.
_Avoid_: DataViz Widget, Code-Based Widget

**Code-Based Widget**:
The common product name for a DataViz Widget.
_Avoid_: PTP Widget, Plot Widget, Control Widget

**Entity**:
A typed Marquee subject with a stable identity — an asset, country (including aggregates and regions such as G10 or Global), or portfolio — used across Marquee rather than owned by MarketView. An Entity may scope a Widget, Widget Config, Dashboard, or Entity Feed.
_Avoid_: thematic basket, generic object, Entity Feed, Control Group

**Active Entity**:
The single Entity a Widget is scoped to. Each surface supplies it: an Entity Feed's entity, a Dashboard child's context, the Widget's own default, or the detail page's Selected Context. Other Entities among its parameter values are inputs: a Widget comparing Apple to SPX and scoped to Apple has Apple as its Active Entity.
_Avoid_: context (bare), Context Entity, active context entity, Control Group

**Control Group**:
A named group of Entity members identified by a `CG...` ID. It is not an Entity and no CLI command addresses it directly.
_Avoid_: Constituent Group, CG group, Entity, constituent (that names a member, not the group)

**Selected Context**:
The optional Entity identifier through which a Widget detail page supplies the Widget's Active Entity. A Control Group ID given in its place selects the group feeding a Control, not a Selected Context.
_Avoid_: context object, arbitrary context, thematic basket, Control Group ID

**Dashboard Surface**:
The Product Surface shared by a Dashboard and an Entity Feed. Its public names append "Dashboard" to the backing classification: Personal, Custom, or Thematic for a Dashboard, and asset, country, or portfolio for an Entity Feed.
_Avoid_: broader-sense dashboard, board surface

**Dashboard**:
A saved, curated MarketView collection with a Personal, Custom, or Thematic type, ordered Dashboard Children, and optional Sections. Its changes are permission-gated.
_Avoid_: Dashboard Surface, Entity Feed

**Entity Feed**:
A computed, read-only MarketView collection of the Widgets matching one asset, country, or portfolio. It has no stored children or Sections; per-user pins change its order but not its membership.
_Avoid_: Dashboard, persisted feed

**Dashboard Children**:
The ordered stored members of a Dashboard. Each is a Widget or Text child with its own ID and rank, and may carry its own configuration.
_Avoid_: Dashboard Placements, Widget list

**Section**:
An optional ordered grouping within a Dashboard that references Dashboard Children by ID.
_Avoid_: folder, nested Dashboard, Entity Feed section

**Widget Entry**:
A Widget item repeated in a Dashboard Surface or search result, shown as a Widget Snippet. It has no domain identity of its own.
_Avoid_: Dashboard Child, Widget, Widget Snippet

**Widget Snippet**:
The row every widget listing prints: its ref, its resolved title, and an ordered subset of its Widget Parameters as `name=value`. It has no options, link, or rendered data.
_Avoid_: Widget Summary, Widget Preview, Widget Schema

### Content

**Document**:
An authored piece of prose with a body and metadata, independent of its source.
_Avoid_: Article, Report, Content

**Document Identifier**:
The document UUID, the single address of a Document for both search and retrieval. A Ref, a Marquee URL containing the UUID, and the bare UUID all reduce to it; a Document's origin is a property of the Document, not part of its address.
_Avoid_: origin-keyed identifiers (GIR Research UUID vs Markets slug vs Content Stream ID), universal content ID, generic string ID

**Content** (plural **Contents**):
The stable public CLI and output term for Documents found and retrieved through the `content` Command Group. It does not replace Document as the domain identity, and bare "content(s)" means this result unit, not the `content` Command Group or the GIR `contents` API, which `content search` does not use.
_Avoid_: Document (as a user-facing CLI noun), Article

**Content Snippet**:
The short body-text extract shown under a Document in Content search results. Bare "snippet" must not be used for it or for a Widget Snippet.
_Avoid_: snippet (bare), highlight, excerpt, article snippet
