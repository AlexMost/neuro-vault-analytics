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
  /** Tool name as reported by the SDK (e.g. `mcp__neuro-vault-mcp__search_notes`). */
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
  /** e.g. ['mcp__neuro-vault-mcp__search_notes', 'mcp__neuro-vault-mcp__read_note']. */
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

export interface Aggregates {
  topTools: AggregateBucket[];
  unusedTools: string[];
  topSequences: SequenceBucket[];
  largestResultTools: SizeBucket[];
  stalePathErrors: StalePathHit[];
  currentNoteAnchors: AggregateBucket[];
  cacheHitDistribution: { p50: number; p90: number; mean: number };
  subagentBudget: { mean: number; p95: number; max: number };
  deadEndCount: number;
}

export interface AnalyticsReport {
  period: { startMs: number; endMs: number; label: string };
  stats: {
    sessionsTotal: number;
    sessionsVault: number;
    totalToolCalls: number;
    avgToolCallsPerSession: number;
  };
  aggregates: Aggregates;
  samples: SessionSummary[];
  warnings: string[];
}

/** Known/expected MCP tool names. Used to compute `unusedTools`. */
export const KNOWN_NEURO_VAULT_TOOLS: readonly string[] = [
  'mcp__neuro-vault-mcp__search_notes',
  'mcp__neuro-vault-mcp__read_note',
  'mcp__neuro-vault-mcp__get_tag',
  'mcp__neuro-vault-mcp__read_property',
  'mcp__neuro-vault-mcp__find_duplicates',
  'mcp__neuro-vault-mcp__get_stats',
];
