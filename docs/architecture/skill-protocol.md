# Skill protocol — `/analyze-vault-usage`

The skill turns a deterministic JSON report from the `nv-analytics` CLI into two parallel artefacts: a Markdown note in the vault (canonical, versioned) and a single-file HTML report in `/tmp` (ephemeral, visual companion). This file documents the four-step flow and the contract between the two prompts.

## The four steps

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

1. **Run the CLI.** `node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js --period <P> --format json`. Produces an `AnalyticsReport` (see `src/types.ts`).
2. **Critique with `prompt.md`.** Agent walks the JSON, applies the confidence-tier rules and guards, produces a Markdown body.
3. **Write MD via Obsidian.** Path is `Inbox/neuro-vault-usage/<label>.md`. Overwrites on rerun. This artefact is the source of truth — Dataview indexes it, future reports diff against it.
4. **Re-render with `html-prompt.md`.** Agent emits a single-file HTML using a fixed scaffold (Tailwind via CDN). Writes to `/tmp/nv-analytics-<label>-<suffix>.html` where `<suffix>` is 4 base36 chars of `Date.now()`. Prints the path on a single line.

## Contract between the two prompts

Both prompts consume the same `<<REPORT_JSON>>` substitution. They produce different artefacts but share critique work — by design, `html-prompt.md` does **not** re-derive which patterns matter or which suggestions to make. It instructs the agent to reuse the MD prose verbatim where structure permits.

Concretely:

| Element | Source |
| ------- | ------ |
| TL;DR (2-3 sentences) | reused from MD Step 3 |
| Patterns observed body | reused from MD Step 3 |
| Suggestions copy and confidence tags | reused from MD Step 3 |
| Numbers, top tools, sequences, cache stats | re-read from JSON |
| Diagrams and tables (mass diagram, vault-vs-projects cards, tools-by-bucket, per-project) | computed from JSON per `html-prompt.md` formulas |

The reason: keeping the critique judgment in one place (MD) and using HTML only for re-presentation. Iterating on what counts as a `[HIGH]` suggestion touches `prompt.md` alone; iterating on how it renders touches `html-prompt.md` alone.

## Why no CLI change

The CLI emits every field the HTML scaffold needs: `largestResultTools`, `topTools`, `topSequences`, `buckets.{vault,projects,total}`, `perProject`, `samples`, `unusedTools`, `cacheHitDistribution`, `deadEndCount`. The visual decisions (which 8 tools to show, how to scale to pixels, which two edges deserve thicker strokes) live in the agent's prompt — the CLI stays the deterministic numerical floor.

## Filename collision and browser cache

The MD filename uses only the period label, so reruns overwrite. That's the intent for the canonical note.

The HTML filename adds a `Date.now()`-derived suffix, so each run produces a new file. Two reasons:

1. **Browser cache.** `file://` caching behaviour is browser-specific and unreliable; a fresh filename guarantees the browser shows the new content.
2. **Iteration without overwrite.** While tuning the `html-prompt.md` or the analysis, you may run the skill multiple times in a short window. The sibling files in `/tmp` accumulate harmlessly and let you compare versions. macOS's `/tmp` cleanup will reap them.

## What is *not* in this protocol

- No automated tests sit at this layer. The skill is prose + an LLM walk; the CLI has its own test suite, but the prompts are validated by manual real-week dry runs.
- No persistence beyond what the agent writes. The skill does not maintain history of HTML reports; that lives implicitly in `/tmp` until macOS reaps it.
- No backchannel between the two prompts beyond the agent's in-session memory. Future work that wanted to cross-link MD ↔ HTML would need either a shared identifier emitted by both, or a post-step that injects one.

## Related docs

- [`docs/architecture/claudian-records.md`](./claudian-records.md) — what `nv-analytics` reads.
- [`docs/architecture/module-structure.md`](./module-structure.md) — what the CLI does, file-by-file.
- [`docs/superpowers/specs/2026-04-26-usage-analytics-workflow-design.md`](../superpowers/specs/2026-04-26-usage-analytics-workflow-design.md) — the original three-step workflow design.
- [`docs/superpowers/specs/2026-05-26-html-report-output-design.md`](../superpowers/specs/2026-05-26-html-report-output-design.md) — the spec for Step 4.
