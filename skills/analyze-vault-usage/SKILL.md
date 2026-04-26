---
name: analyze-vault-usage
description: Use when the user wants a usage-review of their neuro-vault work over a given period (e.g. "/analyze-vault-usage 7d", "review my last week of vault usage"). Reads Claudian conversation records, aggregates patterns deterministically, then writes an actionable review note to Inbox/neuro-vault-usage/. Not yet implemented — see docs/superpowers/specs/2026-04-26-usage-analytics-workflow-design.md.
---

# /analyze-vault-usage

> **Scaffold only.** This skill is not yet wired up. The implementation is tracked by the spec at `docs/superpowers/specs/2026-04-26-usage-analytics-workflow-design.md` in this repo.

When implemented, this skill will:

1. Run `${CLAUDE_PLUGIN_ROOT}/dist/cli.js --period {{period}} --format json` to get an `AnalyticsReport`.
2. Critique the aggregates and samples in the report — surface high-value patterns, dead ends, and actionable suggestions across three categories: `mcp-feature`, `vault-structure`, `prompt-tuning`.
3. Write the resulting note to `Inbox/neuro-vault-usage/YYYY-Www.md` in the vault, via Obsidian skills.

Until the implementation lands, this skill is a no-op.
