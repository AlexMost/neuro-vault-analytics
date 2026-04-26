// src/aggregate.ts
import {
  KNOWN_NEURO_VAULT_TOOLS,
  type AggregateBucket,
  type Aggregates,
  type SequenceBucket,
  type SessionSummary,
  type SizeBucket,
  type StalePathHit,
} from './types.js';

const SEARCH = 'mcp__neuro-vault-mcp__search_notes';
const READ_NOTE = 'mcp__neuro-vault-mcp__read_note';

function topByCount(map: Map<string, number>, n: number): AggregateBucket[] {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
  return sorted[idx]!;
}

function sequencesIn(summary: SessionSummary, n: 2 | 3): string[][] {
  const names = summary.toolCalls.map((c) => c.name);
  const out: string[][] = [];
  for (let i = 0; i + n <= names.length; i++) {
    out.push(names.slice(i, i + n));
  }
  return out;
}

export function aggregate(sessions: SessionSummary[]): Aggregates {
  const toolCounts = new Map<string, number>();
  const resultSizeAcc = new Map<string, { sum: number; n: number }>();
  const seqCounts = new Map<
    string,
    { sequence: string[]; count: number; sessionIds: Set<string> }
  >();
  const noteCounts = new Map<string, number>();
  const stalePathErrors: StalePathHit[] = [];
  const cacheHits: number[] = [];
  const subagentBudgets: number[] = [];
  let deadEndCount = 0;

  for (const s of sessions) {
    if (s.outcome === 'dead_end') deadEndCount++;
    cacheHits.push(s.cacheHitRatio);
    subagentBudgets.push(...s.subagent.toolCallsPerAgent);
    if (s.currentNote) noteCounts.set(s.currentNote, (noteCounts.get(s.currentNote) ?? 0) + 1);

    for (const call of s.toolCalls) {
      toolCounts.set(call.name, (toolCounts.get(call.name) ?? 0) + 1);
      if (call.resultSize !== null) {
        const acc = resultSizeAcc.get(call.name) ?? { sum: 0, n: 0 };
        acc.sum += call.resultSize;
        acc.n += 1;
        resultSizeAcc.set(call.name, acc);
      }
    }

    for (const n of [2, 3] as const) {
      for (const seq of sequencesIn(s, n)) {
        const key = seq.join('>');
        const bucket = seqCounts.get(key) ?? { sequence: seq, count: 0, sessionIds: new Set() };
        bucket.count++;
        bucket.sessionIds.add(s.id);
        seqCounts.set(key, bucket);
      }
    }

    for (let i = 0; i + 1 < s.toolCalls.length; i++) {
      const a = s.toolCalls[i]!;
      const b = s.toolCalls[i + 1]!;
      if (a.name === SEARCH && b.name === READ_NOTE && b.status === 'error') {
        stalePathErrors.push({
          sessionId: s.id,
          searchToolCallTs: a.ts,
          readToolCallTs: b.ts,
          failedPath: null,
        });
      }
    }
  }

  const sortedCacheHits = [...cacheHits].sort((a, b) => a - b);
  const sortedBudgets = [...subagentBudgets].sort((a, b) => a - b);

  const largestResultTools: SizeBucket[] = [...resultSizeAcc.entries()]
    .map(([key, { sum, n }]) => ({ key, avgSizeBytes: Math.round(sum / n) }))
    .sort((a, b) => b.avgSizeBytes - a.avgSizeBytes)
    .slice(0, 10);

  const topSequences: SequenceBucket[] = [...seqCounts.values()]
    .sort((a, b) => b.count - a.count || a.sequence.join('>').localeCompare(b.sequence.join('>')))
    .slice(0, 10)
    .map(({ sequence, count, sessionIds }) => ({ sequence, count, sessionIds: [...sessionIds] }));

  return {
    topTools: topByCount(toolCounts, 10),
    unusedTools: KNOWN_NEURO_VAULT_TOOLS.filter((t) => !toolCounts.has(t)),
    topSequences,
    largestResultTools,
    stalePathErrors,
    currentNoteAnchors: topByCount(noteCounts, 20),
    cacheHitDistribution: {
      p50: percentile(sortedCacheHits, 50),
      p90: percentile(sortedCacheHits, 90), // NOTE: plan had a bug here using sortedBudgets — fixed to sortedCacheHits
      mean: cacheHits.length ? cacheHits.reduce((a, b) => a + b, 0) / cacheHits.length : 0,
    },
    subagentBudget: {
      mean: subagentBudgets.length
        ? subagentBudgets.reduce((a, b) => a + b, 0) / subagentBudgets.length
        : 0,
      p95: percentile(sortedBudgets, 95),
      max: subagentBudgets.length ? Math.max(...subagentBudgets) : 0,
    },
    deadEndCount,
  };
}
