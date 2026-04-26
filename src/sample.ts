import type { SessionSummary } from './types.js';

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
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.floor((p / 100) * (sorted.length - 1))]!;
  return [at(25), at(50), at(75)];
}

export function sampleSessions(sessions: SessionSummary[], sampleSize: number): SessionSummary[] {
  if (sessions.length <= sampleSize) return [...sessions];
  const quartiles = quartilesOf(sessions.map((s) => s.toolCalls.length));

  const strata = new Map<string, SessionSummary[]>();
  for (const s of sessions) {
    const key = `${hourBucket(s.createdAt)}-${callBucket(s.toolCalls.length, quartiles)}`;
    const list = strata.get(key);
    if (list) list.push(s);
    else strata.set(key, [s]);
  }

  const queues = [...strata.values()];
  const out: SessionSummary[] = [];
  while (out.length < sampleSize) {
    let advanced = false;
    for (const q of queues) {
      if (q.length === 0) continue;
      out.push(q.shift()!);
      advanced = true;
      if (out.length >= sampleSize) break;
    }
    if (!advanced) break;
  }
  return out;
}
