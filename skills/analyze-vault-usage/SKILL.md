---
name: analyze-vault-usage
description: Use when the user asks for a usage review of their neuro-vault work over a period (e.g. "/analyze-vault-usage 7d", "review my last week of vault usage"). Runs the bundled nv-analytics CLI to compute deterministic aggregates over Claudian conversation records, then critiques patterns and writes an actionable note to Inbox/neuro-vault-usage/YYYY-Www.md in the vault.
---

# /analyze-vault-usage [period]

This skill orchestrates a single usage-review pass:

1. Run the bundled CLI to compute aggregates.
2. Critique the report using the prompt in `prompt.md`.
3. Write the resulting note via the user's Obsidian skills.

## Step 1 — Run the analyzer

Invoke the CLI via the `Bash` tool (single command, no shell metacharacters):

```sh
node ${CLAUDE_PLUGIN_ROOT}/dist/cli.js --period <PERIOD> --format json
```

Where `<PERIOD>` is the argument the user supplied (default `7d` if they did not).

Capture the stdout into a local variable. The output is an `AnalyticsReport` JSON:

```ts
type AnalyticsReport = {
  period: { startMs: number; endMs: number; label: string };
  stats: {
    sessionsTotal: number;
    sessionsVault: number;
    totalToolCalls: number;
    avgToolCallsPerSession: number;
  };
  aggregates: {
    topTools: { key: string; count: number }[];
    unusedTools: string[];
    topSequences: { sequence: string[]; count: number; sessionIds: string[] }[];
    largestResultTools: { key: string; count: number }[];
    stalePathErrors: { sessionId: string; failedPath: string | null }[];
    currentNoteAnchors: { key: string; count: number }[];
    cacheHitDistribution: { p50: number; p90: number; mean: number };
    subagentBudget: { mean: number; p95: number; max: number };
    deadEndCount: number;
  };
  samples: SessionSummary[];
  warnings: string[];
};
```

If the CLI fails (non-zero exit), surface its stderr to the user verbatim and stop.

## Step 2 — Critique the report

Use the prompt template in `${CLAUDE_PLUGIN_ROOT}/skills/analyze-vault-usage/prompt.md`. Substitute the JSON output into the `<<REPORT_JSON>>` placeholder, then think through the report and produce the note body.

## Step 3 — Write the note

Compute the destination path: `Inbox/neuro-vault-usage/<YYYY>-W<WW>.md`, where `YYYY-Www` is the ISO week of `period.endMs` (the run instant). If the file already exists, overwrite it and tell the user one line: "Overwriting existing report for <YYYY-Www>."

Write the file via whichever Obsidian skill the user has available (e.g. `obsidian:obsidian-cli`). Frontmatter required:

```yaml
---
type: review
created: <YYYY-MM-DD of period.endMs>
period_start: <YYYY-MM-DD of period.startMs>
period_end: <YYYY-MM-DD of period.endMs>
sessions_total: <stats.sessionsTotal>
sessions_vault: <stats.sessionsVault>
tags: [analytics, neuro-vault, ephemeral]
---
```

The body follows the template in `prompt.md` (TL;DR, Numbers, Patterns observed, Suggestions, Raw aggregates).

## Empty period

If `stats.sessionsVault === 0`, still write the note. TL;DR: "Sessions touching the vault: 0. No patterns observed." This is a valid and intentional result.

## Notes

- The LLM-critique prompt lives in `prompt.md` so iterating on it does not require rebuilding the CLI.
- The CLI does no LLM calls and no HTTP. All inference happens here in the same Claude Code session that invoked the skill.
