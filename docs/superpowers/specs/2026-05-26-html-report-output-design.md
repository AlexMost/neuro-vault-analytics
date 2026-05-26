---
type: spec
created: 2026-05-26
project: neuro-vault-analytics
status: draft
source: Obsidian Tasks/Dual HTML report output for neuro-vault-analytics.md
tags: [analytics, dx, ux]
---

# Dual HTML report output for neuro-vault-analytics

> **Source.** Canonical record of the design first written in the Obsidian task
> `Tasks/Dual HTML report output for neuro-vault-analytics.md` (created 2026-05-26).
> This spec adds a fourth step to the existing workflow defined in
> [2026-04-26-usage-analytics-workflow-design.md](./2026-04-26-usage-analytics-workflow-design.md);
> nothing in the existing workflow is replaced.

The MD note in `Inbox/neuro-vault-usage/` remains the source of truth — it is
indexed by Dataview, lives in git-versioned vault state, and supports
cross-period diff. This spec adds a second, ephemeral output: a single-file
HTML report in `/tmp` that mirrors the MD content but uses diagrams for the
parts that read poorly as Markdown tables — mass diagram for context cost,
flowchart for sequences, side-by-side cards for the vault/projects contrast.

The trigger is the same `improve-codebase-architecture` HTML-report convention
[`HTML-REPORT.md`](https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/HTML-REPORT.md):
single-file HTML, Tailwind + Mermaid via CDN, custom CSS only where Tailwind
falls short, diagrams as the primary medium.

## Motivation

The MD report carries three sections that consistently read worse than they
should:

- **`largestResultTools` table** — a ranked list of bytes/run. The actual story
  ("which tool eats how much context, weighted by how often it runs") needs
  the reader to mentally multiply by `topTools` counts. A mass diagram makes
  it pre-attentive.
- **Per-tool vault-vs-projects asymmetry** — the most actionable signal in the report (a tool dominant in projects but absent in vault is the canonical "external workflow you should bring into the vault" indicator). In MD it currently lives behind the per-project breakdown table, which spreads the asymmetry across rows. A single union table sorted by total surfaces it directly.
- **Vault-vs-Projects contrast** — the primary reason the report exists. In MD
  it currently lives in a three-column "Numbers" table, which forces the
  reader to scan rows. Side-by-side cards put the contrast front and centre.

MD stays canonical; HTML is the visual companion.

## Scope

Single change set:

1. **New step 4 in `skills/analyze-vault-usage/SKILL.md`** — HTML generation
   after the existing MD step. Skill description updated to mention the dual
   output.
2. **New prompt** `skills/analyze-vault-usage/html-prompt.md` — instructs the
   agent to re-render the analysis it already produced as a single-file
   HTML, using a fixed template and the same `<<REPORT_JSON>>` placeholder.
3. **Output path** — `/tmp/nv-analytics-<label>-<suffix>.html`, where
   `<label>` matches the MD filename (`2026-W17` or `2026-04-25_to_2026-04-26`)
   and `<suffix>` is 4 base36 chars of `Date.now()` computed by the agent at
   write time. Always a new file per run; no overwrite, no cache collisions.
4. **User notice** — after writing, skill prints exactly one line to chat:
   `HTML report: /tmp/nv-analytics-<label>-<suffix>.html`.
5. **Trigger** — always, alongside MD. No flag.

No CLI changes; the CLI already emits every field the template needs.

## Out of scope

- Interactivity beyond native Mermaid rendering (this is not a SPA).
- Export to PDF, PNG, other formats.
- Cross-period diff/trend HTML — separate ticket.
- Persistence; the file is ephemeral by intent and `/tmp` is fine.

## Architecture

### Flow

```
┌────────────────┐    JSON    ┌──────────────┐    MD body    ┌─────────────┐
│  nv-analytics  │ ─────────▶ │  prompt.md   │ ────────────▶ │  Obsidian   │
│   (CLI, std)   │            │ (agent walk) │               │   write     │
└────────────────┘            └──────────────┘               └─────────────┘
                                      │
                                      │ same agent, same session,
                                      │ JSON + MD body still in context
                                      ▼
                              ┌──────────────────┐    HTML    ┌─────────────┐
                              │ html-prompt.md   │ ─────────▶ │   Write     │
                              │  (re-render)     │            │   /tmp/...  │
                              └──────────────────┘            └─────────────┘
```

The two prompts are parallel: both consume the same JSON, both produce a
self-contained artefact. They share zero code. The agent's working memory is
the only thing that crosses the boundary — `html-prompt.md` may instruct the
agent to reuse the prose it already wrote for TL;DR / patterns / suggestions
rather than re-deciding which patterns are noteworthy.

### Why two prompts, not one

A unified prompt that emits both MD and HTML in one shot was considered. It
saves one critique pass but couples the two formats so tightly that iterating
on either is risky. The MD prompt is already non-trivial (rule blocks,
confidence guards); doubling its length to also drive HTML structure would
make every change a regression risk on the other format. Two prompts cost a
small amount of token re-walk and keep the formats independently editable.

### Why no CLI change

The CLI already emits everything the HTML template needs:
`largestResultTools`, `topTools`, `topSequences`, `buckets.{vault,projects,total}`,
`perProject`, `samples`, `unusedTools`, `cacheHitDistribution`, `deadEndCount`.
Anything visual is the agent's responsibility (scaling bytes/counts to pixels
for the mass diagram, picking which sequences to plot). The CLI stays the
deterministic numerical floor; the agent does the rendering judgment.

### Filename collision and cache

`<suffix>` is `Date.now().toString(36).slice(-4)` — 4 base36 chars, computed
by the agent via a one-liner `node -e` in the same Bash invocation that runs
the CLI, or inline before writing. Every run produces a different filename,
so:

- The browser never serves a stale cached version of the HTML.
- Repeated runs of the same period (e.g. iterating on the prompt) leave
  several siblings in `/tmp` until macOS cleans them — that's fine, `/tmp` is
  exactly the right scratch space.
- The MD overwrite behaviour in `Inbox/neuro-vault-usage/` is unchanged; only
  the HTML is multi-versioned.

## Content shape

The HTML mirrors MD section-by-section, but visual where possible. **Diagram
+ short caption, no parallel table** — if a section earns a diagram, the
underlying numbers move to the `Raw aggregates` `<details>` block at the
bottom. The reader who needs the raw rows opens the details; the reader who
needs the story sees the diagram.

Section order:

1. **Header** — `<h1>Usage analytics <label></h1>`, period start/end dates,
   three status badges: `vault: N sessions`, `projects: N sessions`,
   `total: N sessions`. Badges use the same colour scheme as the suggestion
   tiers (emerald/amber/slate) keyed off relative activity.
2. **TL;DR** — large serif blockquote. Same 2–3 sentences the MD prompt
   produced. The single highest-leverage takeaway.
3. **Where the context goes** — **mass diagram** for `largestResultTools`
   joined with call counts from `topTools`. CSS-grid layout, each tool a
   `<div>` with `height ∝ avg KB` and `width ∝ call count`. Label inside
   each rectangle: `<tool name> · <X KB> · <N calls>`. One-line caption
   below: "Area ≈ total bytes shipped to the model by that tool over the
   period."
4. **Vault vs Projects** — `grid-cols-2`, two cards. Each card: tool top-5
   list, total sessions, top sequence, dead-end count. Cards are visually
   identical so the eye catches the asymmetry (a tool dominant in one
   column and absent in the other).
5. **Tools by bucket** — a union table of `buckets.vault.topTools` ∪ `buckets.projects.topTools`. Includes every tool from either list — generic tools like `Bash`/`Read`/`Edit`/`Write` matter because their volume and bucket asymmetry are part of the story. Columns: tool name (with `mcp__neuro-vault__` prefix stripped), vault count, projects count, total. Sorted by total descending. Two independent visual signals: (a) rows where one bucket is `0` and the other is `> 0` get a subtle tint (amber for projects-only, slate for vault-only) so cross-bucket asymmetry pops; (b) `mcp__neuro-vault__*` tools get a `vault` chip badge after the tool name plus a bolder name weight, so the eye is drawn to the report's lens without losing the full picture.
6. **Unused tools** — the JSON's top-level `unusedTools` array, rendered as a compact list. "Nothing unused this period." line if the array is empty.
7. **Cache & dead ends** — small horizontal bar for cache hit p50/p90/mean
   (Tailwind divs, no chart library), plus a badge `dead ends: N`.
8. **Patterns observed** — `### High-value patterns` and `### Dead ends`
   rendered as text. Same content as the MD section; session IDs as
   `<code>`.
9. **Suggestions** — each suggestion is a coloured card by confidence tier:
   - `HIGH` → emerald (`bg-emerald-50 border-emerald-300`)
   - `MED` → amber
   - `LOW` → slate
   - `BLOCKED` → red
   - `REQUIRES_VERIFICATION` → sky
   - Card content: a chip-badge with the full tag (`[HIGH | 16 sessions | ~48 KB/run]`),
     bold title, one-line action paragraph.
   - Grouped into three subsections (`MCP features` / `Vault structure` /
     `Prompt tuning`), same as MD.
10. **Per-project breakdown** — compact table or card grid for
    `perProject` (only if non-empty).
11. **Raw aggregates** — `<details>` collapsed by default. Inside: `<pre>`
    blocks with top tools, 2-grams, 3-grams, `largestResultTools`, cache
    distribution, subagent budget, stale-path errors, warnings. Per
    bucket (vault / projects / total) just like the MD.

### Empty-period handling

If `buckets.total.sessionsTotal === 0`:

- Header renders with all three badges showing `0`.
- TL;DR shows `"Sessions touching the vault: 0. No patterns observed."`.
- All visualisation sections (mass diagram, vault-vs-projects, tools by bucket,
  unused tools, cache & dead ends, patterns, suggestions, per-project) are
  omitted entirely.
- Raw aggregates `<details>` is still rendered (the structural fields are
  all zero/empty, but the section is consistent across reports).

### Template

The single-file HTML scaffold the html-prompt template produces:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Usage analytics <label></title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      h1, h2 { font-family: "Iowan Old Style", "Palatino Linotype", Palatino, serif; }
      .mass-tile { display: flex; align-items: flex-end; justify-content: center; }
    </style>
  </head>
  <body class="max-w-5xl mx-auto p-12 text-slate-900">
    <!-- header, sections, details -->
  </body>
</html>
```

CDN choice — `cdn.tailwindcss.com` was chosen because it is referenced in the
Pocock convention this report follows, and is reachable without authentication
from a default macOS browser opening a `file://` URL.

## Interfaces

### `skills/analyze-vault-usage/SKILL.md`

A new **Step 4** between the existing Step 3 and `Notes`. Brief shape:

```
## Step 4 — Write the HTML companion report

Using the same JSON from Step 1 and the prose body you just wrote in Step 3,
re-render the analysis as a single-file HTML using the template in
`${CLAUDE_PLUGIN_ROOT}/skills/analyze-vault-usage/html-prompt.md`.

Compute the output suffix once via:

    node -e 'process.stdout.write(Date.now().toString(36).slice(-4))'

Write the result via the Write tool to
`/tmp/nv-analytics-<label>-<suffix>.html` (label same as Step 3).

After writing, print exactly one line to chat:

    HTML report: /tmp/nv-analytics-<label>-<suffix>.html

If `buckets.total.sessionsTotal === 0`, still write the HTML using the
empty-period rules in `html-prompt.md`.
```

The `description` frontmatter on `SKILL.md` is updated to mention the dual
output: *"…writes an actionable usage-review note to
`Inbox/neuro-vault-usage/...` and a visual companion to `/tmp`."*

### `skills/analyze-vault-usage/html-prompt.md`

Parallel structure to `prompt.md`:

- **Inputs** — `<<REPORT_JSON>>` placeholder (same substitution as `prompt.md`).
- **What to produce** — single self-contained HTML document, no preamble, no
  trailing commentary. Body only, starting `<!doctype html>`.
- **Template** — the full HTML scaffold (header, sections, raw aggregates),
  with `{{…}}` slots the agent fills.
- **Section-by-section rendering rules** — one paragraph per section telling
  the agent what to put there and what to leave out:
  - Mass diagram: "Compute height for tool T as `clamp(40, round(avgBytes[T]
    / maxAvgBytes * 200), 200)` pixels; width as `clamp(60, round(count[T] /
    maxCount * 180), 180)`. Show top 8 by avg bytes."
  - Tools by bucket: union table over `buckets.vault.topTools` and
    `buckets.projects.topTools`, sorted by total, amber/slate tinting for
    asymmetric rows.
  - Unused tools: compact list from the top-level `unusedTools` array.
  - Suggestion cards: explicit colour mapping by confidence tier.
  - Empty-period: rules as above.
- **Style rules** — single-file, one CDN script as specified, no external
  fonts beyond system serif/sans, no JS.

## Error handling

- **CLI fails** — handled in Step 1, unchanged. HTML step never runs.
- **MD write fails** — handled in Step 3, unchanged. HTML step still runs;
  the visual companion is useful even if the MD path was misconfigured.
- **HTML write fails** — surface the error verbatim and stop. MD already
  landed; user can fix `/tmp` perms or rerun.
- **Mermaid render fails in browser** — out of scope of this skill. The
  agent emits valid Mermaid syntax following the template; if a future
  Mermaid version breaks, that surfaces as a console error in the user's
  browser, not a generation-time failure.

## Testing

Manual verification on a real period, since this is a single-skill change
with no library code:

- [ ] `/analyze-vault-usage 7d` leaves the MD note in
      `Inbox/neuro-vault-usage/` unchanged in content, frontmatter, and
      filename (full regression against current behaviour).
- [ ] HTML is written to `/tmp/nv-analytics-<label>-<suffix>.html`; suffix is
      4 base36 chars and differs across consecutive runs.
- [ ] HTML opens in the system default browser via `file://` with no
      console errors. Tailwind classes apply (visible layout, not unstyled).
- [ ] Tools by bucket table renders with the full tool union (generic + MCP). `mcp__neuro-vault__*` rows show a vault chip badge (emerald) after the tool name and a bolder name weight. Amber-tinted rows correspond to projects-only tools and slate-tinted rows to vault-only tools (these two signals operate independently of the vault-tool emphasis).
- [ ] Unused tools section renders when `unusedTools` is non-empty; shows "Nothing unused this period." when empty.
- [ ] Mass diagram for `largestResultTools` shows visibly proportional
      tiles — the top tool's tile is noticeably larger than the smallest
      shown tile.
- [ ] Vault-vs-projects cards render side by side at desktop width.
- [ ] Confidence badges are colour-coded: HIGH=emerald, MED=amber,
      LOW=slate, BLOCKED=red, REQUIRES_VERIFICATION=sky.
- [ ] Empty-period case: pick a window with zero activity (or fabricate via
      a far-future date); HTML still generates, no Mermaid errors in
      console, TL;DR shows the zero-sessions string.
- [ ] One end-to-end run on the current week (`/analyze-vault-usage 7d`)
      produces an HTML the human reviewer agrees is useful.

No automated tests; the skill is prose + an LLM walk, not code. The CLI's
existing test suite is untouched.

## Documentation

- `README.md` — mention the dual output in the usage section: MD lands in
  the vault, HTML in `/tmp`, both written in the same command.
- `docs/architecture/skill-protocol.md` — **new** architecture doc, one
  page, describing the four-step flow (CLI → MD critique → MD write → HTML
  re-render) and the contract between the two prompts. Lives under
  `docs/architecture/` per AGENTS.md convention.

No update to `docs/architecture/module-structure.md` — source layout is
unchanged.

## Definition of Done

- [ ] `skills/analyze-vault-usage/SKILL.md` has Step 4 and the updated
      description.
- [ ] `skills/analyze-vault-usage/html-prompt.md` is created.
- [ ] HTML template uses Tailwind CDN and a small custom CSS layer as specified.
- [ ] Content sections mirror MD plus the diagrams enumerated above.
- [ ] Skill prints the HTML path to chat as a single line after writing.
- [ ] Real-week dry run (the week current at implementation time) yields a
      working HTML with all visualisations populated.
- [ ] `README.md` mentions the dual output.
- [ ] `docs/architecture/skill-protocol.md` exists.
- [ ] `npm test`, `npm run lint`, `npx tsc --noEmit` all clean (no
      source changes expected, but this is the standard gate).

## Connections

- [`2026-04-26-usage-analytics-workflow-design.md`](./2026-04-26-usage-analytics-workflow-design.md)
  — original three-step workflow; this spec adds step 4.
- [`2026-04-26-output-and-rigor-design.md`](./2026-04-26-output-and-rigor-design.md)
  — the prompt-rigour rules (confidence tiers, guards) apply unchanged; HTML
  just colours them in.
- [`2026-05-24-cross-project-breakdown-design.md`](./2026-05-24-cross-project-breakdown-design.md)
  — the vault-vs-projects contrast this HTML highlights is the same one
  that spec introduced.
- Obsidian task: `Tasks/Dual HTML report output for neuro-vault-analytics.md`
  — source.
- Pocock convention:
  https://github.com/mattpocock/skills/blob/main/skills/engineering/improve-codebase-architecture/HTML-REPORT.md
