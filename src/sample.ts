import type {
  AggregateBucket,
  SampledSession,
  SequenceBucket,
  SessionSummary,
  ToolCall,
} from './types.js';

const MCP_PREFIX = 'mcp__neuro-vault-mcp__';
const ANOMALY_RESULT_BYTES = 5 * 1024;

function isAnomaly(c: ToolCall): boolean {
  if (c.status === 'error') return true;
  if (c.resultSize !== null && c.resultSize > ANOMALY_RESULT_BYTES) return true;
  return false;
}

function topToolsOf(calls: ToolCall[], limit: number): AggregateBucket[] {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

function topNGramsOf(calls: ToolCall[], limit: number): SequenceBucket[] {
  const names = calls.map((c) => c.name);
  const counts = new Map<string, { sequence: string[]; count: number }>();
  for (const n of [2, 3] as const) {
    for (let i = 0; i + n <= names.length; i++) {
      const seq = names.slice(i, i + n);
      const key = seq.join('>');
      const bucket = counts.get(key) ?? { sequence: seq, count: 0 };
      bucket.count++;
      counts.set(key, bucket);
    }
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.sequence.join('>').localeCompare(b.sequence.join('>')))
    .slice(0, limit)
    .map(({ sequence, count }) => ({ sequence, count, sessionIds: [] }));
}

export function projectSession(s: SessionSummary): SampledSession {
  const mcpCalls = s.toolCalls.filter((c) => c.name.startsWith(MCP_PREFIX));
  const anomalies = s.toolCalls.filter(isAnomaly);
  const nonMcpClean = s.toolCalls.filter(
    (c) => !c.name.startsWith(MCP_PREFIX) && !isAnomaly(c),
  );
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    durationMs: s.durationMs,
    model: s.model,
    contextPercentage: s.contextPercentage,
    cacheHitRatio: s.cacheHitRatio,
    currentNote: s.currentNote,
    outcome: s.outcome,
    subagent: s.subagent,
    toolCallSummary: {
      total: s.toolCalls.length,
      mcpCalls,
      anomalies,
      nonMcpSummary: {
        total: nonMcpClean.length,
        topTools: topToolsOf(nonMcpClean, 5),
        nGrams: topNGramsOf(nonMcpClean, 3),
      },
    },
  };
}

function hourBucket(ts: number): 0 | 1 | 2 | 3 {
  const h = new Date(ts).getUTCHours();
  return Math.floor(h / 6) as 0 | 1 | 2 | 3;
}

function callBucket(calls: number, quartiles: [number, number, number]): 0 | 1 | 2 | 3 {
  if (calls <= quartiles[0]) return 0;
  if (calls <= quartiles[1]) return 1;
  if (calls <= quartiles[2]) return 2;
  return 3;
}

function quartilesOf(values: number[]): [number, number, number] {
  if (values.length === 0) return [0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.floor((p / 100) * (sorted.length - 1))]!;
  return [at(25), at(50), at(75)];
}

function costOf(p: SampledSession): number {
  return Buffer.byteLength(JSON.stringify(p), 'utf8');
}

export interface SampleOpts {
  byteBudget: number;
}

export interface SampleResult {
  samples: SampledSession[];
  /** True if the byte budget was so small the first session alone exceeded it. */
  budgetUnderflow: boolean;
}

export function sampleSessionsWithMeta(
  sessions: SessionSummary[],
  opts: SampleOpts,
): SampleResult {
  if (sessions.length === 0) return { samples: [], budgetUnderflow: false };

  const quartiles = quartilesOf(sessions.map((s) => s.toolCalls.length));
  const strata = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const key = `${hourBucket(s.createdAt)}-${callBucket(s.toolCalls.length, quartiles)}`;
    const list = strata.get(key);
    if (list) list.push(s);
    else strata.set(key, [s]);
  }

  const queues = [...strata.values()];
  const out: SampledSession[] = [];
  let used = 0;
  let budgetUnderflow = false;

  while (true) {
    let advanced = false;
    for (const q of queues) {
      if (q.length === 0) continue;
      const projected = projectSession(q.shift()!);
      const cost = costOf(projected);
      if (out.length === 0) {
        out.push(projected);
        used += cost;
        if (cost > opts.byteBudget) budgetUnderflow = true;
        advanced = true;
        continue;
      }
      if (used + cost > opts.byteBudget) {
        // Skip this candidate; smaller ones in other strata may still fit.
        continue;
      }
      out.push(projected);
      used += cost;
      advanced = true;
    }
    if (!advanced) break;
  }

  return { samples: out, budgetUnderflow };
}

export function sampleSessions(
  sessions: SessionSummary[],
  opts: SampleOpts,
): SampledSession[] {
  return sampleSessionsWithMeta(sessions, opts).samples;
}
