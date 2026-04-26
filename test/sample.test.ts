import { describe, expect, it } from 'vitest';
import { sampleSessions } from '../src/sample.js';
import type { SessionSummary } from '../src/types.js';

function s(id: string, hour: number, calls: number): SessionSummary {
  const ts = Date.UTC(2026, 3, 26, hour);
  return {
    id,
    title: id,
    createdAt: ts,
    updatedAt: ts + 60_000,
    durationMs: 60_000,
    model: 'opus',
    contextPercentage: 0,
    cacheHitRatio: 0.5,
    currentNote: null,
    toolCalls: Array.from({ length: calls }, (_, i) => ({
      name: 'x',
      argsSummary: '',
      resultSize: 0,
      status: 'ok' as const,
      source: 'main' as const,
      ts: ts + i,
    })),
    subagent: { count: 0, toolCallsPerAgent: [], finalCallOkRate: 1 },
    outcome: 'completed',
  };
}

describe('sampleSessions', () => {
  it('returns all sessions if size <= sampleSize', () => {
    const all = [s('a', 1, 1), s('b', 2, 2)];
    expect(
      sampleSessions(all, 5)
        .map((x) => x.id)
        .sort(),
    ).toEqual(['a', 'b']);
  });

  it('returns exactly sampleSize when over the limit', () => {
    const all = Array.from({ length: 30 }, (_, i) => s(`s${i}`, i % 24, i));
    expect(sampleSessions(all, 10)).toHaveLength(10);
  });

  it('is deterministic given the same input order', () => {
    const all = Array.from({ length: 30 }, (_, i) => s(`s${i}`, i % 24, i));
    const a = sampleSessions(all, 10).map((x) => x.id);
    const b = sampleSessions(all, 10).map((x) => x.id);
    expect(a).toEqual(b);
  });

  it('covers a range of hours when stratifying', () => {
    const all = Array.from({ length: 30 }, (_, i) => s(`s${i}`, i % 24, i));
    const out = sampleSessions(all, 12);
    const hours = new Set(out.map((x) => new Date(x.createdAt).getUTCHours() % 24));
    const bucketsRepresented = new Set([...hours].map((h) => Math.floor(h / 6)));
    expect(bucketsRepresented.size).toBe(4);
  });
});
