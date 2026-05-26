---
name: analyze-vault-usage
description: Use when the user asks for a usage review of their neuro-vault work over a period (e.g. "/analyze-vault-usage 7d", "review my last week of vault usage"). Runs the bundled nv-analytics CLI to compute deterministic aggregates over Claudian conversation records, critiques patterns, writes an actionable note to Inbox/neuro-vault-usage/YYYY-Www.md in the vault, and a visual HTML companion to /tmp.
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

Capture the stdout into a local variable. The output is an `AnalyticsReport` JSON
with three parallel buckets (vault / projects / total) and a per-project breakdown:

```ts
type AnalyticsReport = {
  period: { startMs: number; endMs: number; label: string };
  buckets: {
    vault: BucketStats; // sessions started from inside the vault directory
    projects: BucketStats; // sessions from external repos that called the vault MCP
    total: BucketStats; // re-aggregated over the union
  };
  perProject: {
    project: string;
    decodedPath: string;
    sessionsTotal: number;
    sessionsVault: number;
    topTools: { key: string; count: number }[];
    uniqueTools: string[];
  }[];
  unusedTools: string[];
  samples: (SampledSession & { bucket: 'vault' | 'projects'; project: string | null })[];
  warnings: string[];
};
type BucketStats = {
  sessionsTotal: number;
  sessionsVault: number;
  totalToolCalls: number;
  avgToolCallsPerSession: number;
  topTools: { key: string; count: number }[];
  topSequences: { sequence: string[]; count: number; sessionIds: string[] }[];
  largestResultTools: { key: string; avgSizeBytes: number }[];
  stalePathErrors: {
    sessionId: string;
    searchToolCallTs: number;
    readToolCallTs: number;
    failedPath: string | null;
  }[];
  currentNoteAnchors: { key: string; count: number }[];
  cacheHitDistribution: { p50: number; p90: number; mean: number };
  subagentBudget: { mean: number; p95: number; max: number };
  deadEndCount: number;
};
```

The CLI scans every directory under `~/.claude/projects/` by default; the
`buckets.vault` block is built from Claudian session metadata, while
`buckets.projects` is built from JSONL alone (no `currentNote`, no
context-window snapshot — see `docs/architecture/claudian-records.md`).

If the CLI fails (non-zero exit), surface its stderr to the user verbatim and stop.

## Step 2 — Critique the report

Use the prompt template in `${CLAUDE_PLUGIN_ROOT}/skills/analyze-vault-usage/prompt.md`. Substitute the JSON output into the `<<REPORT_JSON>>` placeholder, then think through the report and produce the note body.

## Step 3 — Write the note

Compute the destination path based on the actual window length (`period.endMs - period.startMs`):

- If the window is **>= 7 days** → `Inbox/neuro-vault-usage/<YYYY-Www>.md`, where `YYYY-Www` is the ISO week of `period.endMs`.
- If the window is **< 7 days** → `Inbox/neuro-vault-usage/<YYYY-MM-DD-of-period.startMs>_to_<YYYY-MM-DD-of-period.endMs>.md`.

The note title `# Usage analytics <label>` mirrors the chosen filename label (`2026-W17` or `2026-04-25_to_2026-04-26`).

If the file already exists, overwrite it and tell the user one line: "Overwriting existing report for <label>."

Write the file via whichever Obsidian skill the user has available (e.g. `obsidian:obsidian-cli`). Frontmatter required:

```yaml
---
type: review
created: <YYYY-MM-DD of period.endMs>
period_start: <YYYY-MM-DD of period.startMs>
period_end: <YYYY-MM-DD of period.endMs>
sessions_vault: <buckets.vault.sessionsTotal>
sessions_projects: <buckets.projects.sessionsTotal>
sessions_total: <buckets.total.sessionsTotal>
tags: [analytics, neuro-vault]
archived: false
---
```

`ephemeral` is intentionally **not** in `tags` — these notes are kept for cross-period diff. The explicit `archived: false` field is reserved for future lifecycle tooling.

## Step 4 — Write the HTML companion report

After the MD note is in the vault, re-render the same analysis as a single-file HTML report in `/tmp`. The HTML is ephemeral and lives outside the vault by design.

Use the prompt template in `${CLAUDE_PLUGIN_ROOT}/skills/analyze-vault-usage/html-prompt.md`. Substitute the same JSON output from Step 1 into the `<<REPORT_JSON>>` placeholder. The HTML prompt assumes the MD body from Step 3 is in your working memory — reuse the TL;DR, patterns, and suggestions prose verbatim where the HTML template asks for them.

Compute the cache-busting suffix once via the Bash tool:

```sh
node -e 'process.stdout.write(Date.now().toString(36).slice(-4))'
```

Capture stdout as `<suffix>` (4 base36 chars). Then write the rendered HTML via the `Write` tool to:

```
/tmp/nv-analytics-<label>-<suffix>.html
```

where `<label>` is the same label used for the MD filename in Step 3 (`2026-W17` or `2026-04-25_to_2026-04-26`).

After the write succeeds, print exactly one line to chat:

```
HTML report: /tmp/nv-analytics-<label>-<suffix>.html
```

If the write fails, surface the error to the user verbatim. The MD note has already been written — the failure is non-fatal for the overall skill.

If `buckets.total.sessionsTotal === 0`, still write the HTML. The `html-prompt.md` empty-period rules cover the layout.

## Empty period

If `buckets.total.sessionsTotal === 0`, still write the note. TL;DR: "Sessions touching the vault: 0. No patterns observed." This is a valid and intentional result.

## Notes

- The LLM-critique prompt lives in `prompt.md` so iterating on it does not require rebuilding the CLI.
- The CLI does no LLM calls and no HTTP. All inference happens here in the same Claude Code session that invoked the skill.
