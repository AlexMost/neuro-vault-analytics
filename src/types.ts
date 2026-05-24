// src/types.ts

export interface ClaudianMeta {
  id: string;
  title: string;
  createdAt: number; // ms epoch
  updatedAt: number; // ms epoch
  /** Vault-relative path of the note open when the conversation started, if any. */
  currentNote: string | null;
  /** Joins to the SDK JSONL filename. */
  sessionId: string;
  /** Claudian also persists the SDK-side session id; in current builds it equals `sessionId`. */
  sdkSessionId?: string;
  usage: {
    model: string;
    inputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    contextWindow: number;
    contextTokens: number;
    /** Percentage of the context window in use at conversation end. */
    percentage: number;
  };
}

/** A single tool invocation extracted from the SDK JSONL. */
export interface ToolCall {
  /** Tool name as reported by the SDK (e.g. `mcp__neuro-vault__search_notes`). */
  name: string;
  /** Best-effort one-line summary of the input args, capped at ~120 chars. */
  argsSummary: string;
  /** Size of the tool_result content in bytes, or `null` if no result was found. */
  resultSize: number | null;
  /** `ok` if a tool_result was found and didn't carry `is_error`, otherwise `error`. */
  status: 'ok' | 'error';
  /** `'main'` for the top-level session log, `subagent:<agentId>` for sidecars. */
  source: 'main' | `subagent:${string}`;
  /** ms epoch timestamp the tool_use line was emitted. */
  ts: number;
}

export interface SubagentStats {
  count: number;
  /** Tool calls per subagent (one entry per dispatched subagent). */
  toolCallsPerAgent: number[];
  /** Fraction of subagents whose final tool call ended with `status === 'ok'`. Proxy for outcome, not a per-call success ratio. */
  finalCallOkRate: number;
}

export type Outcome = 'completed' | 'dead_end' | 'abandoned';

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  model: string;
  contextPercentage: number;
  cacheHitRatio: number; // cacheRead / (cacheRead + cacheCreation + input), 0 if denominator is 0
  currentNote: string | null;
  toolCalls: ToolCall[];
  subagent: SubagentStats;
  outcome: Outcome;
}

/** Top-N tool counts within a session (vs the global aggregates which are cross-session). */
export interface SampledNonMcpSummary {
  total: number;
  topTools: AggregateBucket[];
  nGrams: SequenceBucket[];
}

export interface SampledToolCallSummary {
  total: number;
  mcpCalls: ToolCall[];
  anomalies: ToolCall[];
  nonMcpSummary: SampledNonMcpSummary;
}

export interface SampledSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  durationMs: number;
  model: string;
  contextPercentage: number;
  cacheHitRatio: number;
  currentNote: string | null;
  outcome: Outcome;
  subagent: SubagentStats;
  toolCallSummary: SampledToolCallSummary;
  /** Which discovery bucket this sample came from. */
  bucket: 'vault' | 'projects';
  /** Encoded project dir name for projects-bucket samples; null for vault samples. */
  project: string | null;
}

export interface AggregateBucket {
  key: string;
  count: number;
}

/** Bucket whose value is an average byte-size, not a count. Used by `largestResultTools`. */
export interface SizeBucket {
  key: string;
  avgSizeBytes: number;
}

export interface SequenceBucket {
  /** e.g. ['mcp__neuro-vault__search_notes', 'mcp__neuro-vault__read_notes']. */
  sequence: string[];
  count: number;
  /** Session ids where this sequence occurred. */
  sessionIds: string[];
}

export interface StalePathHit {
  sessionId: string;
  searchToolCallTs: number;
  readToolCallTs: number;
  /** Path that the read attempted; null when it could not be extracted from the tool_use args. */
  failedPath: string | null;
}

/** Aggregates computed over a single pool of sessions (vault, projects, or total). */
export interface BucketStats {
  sessionsTotal: number;
  /** In the `vault` bucket: equal to sessionsTotal (already filtered by isVaultRelevant). In `projects`: equal to sessionsTotal by construction (we only include external sessions that called the vault MCP). In `total`: union of both. */
  sessionsVault: number;
  totalToolCalls: number;
  avgToolCallsPerSession: number;
  topTools: AggregateBucket[];
  topSequences: SequenceBucket[];
  largestResultTools: SizeBucket[];
  stalePathErrors: StalePathHit[];
  currentNoteAnchors: AggregateBucket[];
  cacheHitDistribution: { p50: number; p90: number; mean: number };
  subagentBudget: { mean: number; p95: number; max: number };
  deadEndCount: number;
}

export interface ProjectBreakdown {
  /** Encoded project directory name, e.g. `-Users-amostovenko-git-catalog-ui`. */
  project: string;
  /** Decoded human-readable absolute path. */
  decodedPath: string;
  sessionsTotal: number;
  /** Sessions in this project that hit at least one neuro-vault MCP tool. By construction equal to sessionsTotal here. */
  sessionsVault: number;
  /** Top 5 tools used in this project. */
  topTools: AggregateBucket[];
  /** Tools called only in this project — not in the vault and not in any other project. */
  uniqueTools: string[];
}

export interface AnalyticsReport {
  period: { startMs: number; endMs: number; label: string };
  buckets: {
    vault: BucketStats;
    projects: BucketStats;
    total: BucketStats;
  };
  /** One entry per external project with ≥1 session touching the vault MCP, sorted by sessionsVault desc. */
  perProject: ProjectBreakdown[];
  /** KNOWN_NEURO_VAULT_TOOLS not seen in any session across both buckets. */
  unusedTools: string[];
  samples: SampledSession[];
  warnings: string[];
}

/**
 * Known/expected MCP tool names — used to compute `unusedTools`. Prefix is `mcp__neuro-vault__`
 * (the corrected one from PR #5). The list is hand-curated from the neuro-vault MCP server
 * surface; if the server adds or removes a tool, update this list in the same release.
 */
export const KNOWN_NEURO_VAULT_TOOLS: readonly string[] = [
  'mcp__neuro-vault__create_note',
  'mcp__neuro-vault__edit_note',
  'mcp__neuro-vault__find_duplicates',
  'mcp__neuro-vault__get_note_links',
  'mcp__neuro-vault__get_similar_notes',
  'mcp__neuro-vault__get_stats',
  'mcp__neuro-vault__get_vault_overview',
  'mcp__neuro-vault__list_properties',
  'mcp__neuro-vault__list_tags',
  'mcp__neuro-vault__query_notes',
  'mcp__neuro-vault__read_daily',
  'mcp__neuro-vault__read_notes',
  'mcp__neuro-vault__read_property',
  'mcp__neuro-vault__remove_property',
  'mcp__neuro-vault__search_notes',
  'mcp__neuro-vault__set_property',
];
