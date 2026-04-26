// test/aggregate.test.ts
import { describe, expect, it } from 'vitest';
import { aggregate } from '../src/aggregate.js';
import type { SessionSummary, ToolCall } from '../src/types.js';

function call(over: Partial<ToolCall> & Pick<ToolCall, 'name' | 'ts'>): ToolCall {
  return {
    argsSummary: '',
    resultSize: 100,
    status: 'ok',
    source: 'main',
    ...over,
  };
}

function summary(
  over: Partial<SessionSummary> & Pick<SessionSummary, 'id' | 'toolCalls'>,
): SessionSummary {
  return {
    title: 't',
    createdAt: 0,
    updatedAt: 1,
    durationMs: 1,
    model: 'opus',
    contextPercentage: 0,
    cacheHitRatio: 0.5,
    currentNote: null,
    subagent: { count: 0, toolCallsPerAgent: [], finalCallOkRate: 1 },
    outcome: 'completed',
    ...over,
  };
}

describe('aggregate', () => {
  it('counts top tools and detects 2-grams', () => {
    const s = summary({
      id: 'a',
      currentNote: 'Tasks/A.md',
      toolCalls: [
        call({ name: 'mcp__neuro-vault-mcp__get_tag', ts: 1 }),
        call({ name: 'mcp__neuro-vault-mcp__read_property', ts: 2 }),
        call({ name: 'mcp__neuro-vault-mcp__read_property', ts: 3 }),
      ],
    });
    const agg = aggregate([s]);
    expect(agg.topTools[0]!.key).toBe('mcp__neuro-vault-mcp__read_property');
    expect(agg.topTools[0]!.count).toBe(2);
    const seq = agg.topSequences.find(
      (b) =>
        b.sequence.length === 2 &&
        b.sequence[0] === 'mcp__neuro-vault-mcp__get_tag' &&
        b.sequence[1] === 'mcp__neuro-vault-mcp__read_property',
    );
    expect(seq).toBeDefined();
    expect(seq!.count).toBe(1);
  });

  it('flags unused tools from the known list', () => {
    const s = summary({
      id: 'a',
      toolCalls: [call({ name: 'mcp__neuro-vault-mcp__search_notes', ts: 1 })],
    });
    const agg = aggregate([s]);
    expect(agg.unusedTools).toContain('mcp__neuro-vault-mcp__find_duplicates');
    expect(agg.unusedTools).not.toContain('mcp__neuro-vault-mcp__search_notes');
  });

  it('detects stale-path: search_notes then read_note error', () => {
    const s = summary({
      id: 'B',
      toolCalls: [
        call({ name: 'mcp__neuro-vault-mcp__search_notes', ts: 1 }),
        call({
          name: 'mcp__neuro-vault-mcp__read_note',
          status: 'error',
          ts: 2,
          argsSummary: '{"path":"Tasks/Old.md"}',
        }),
      ],
    });
    const agg = aggregate([s]);
    expect(agg.stalePathErrors).toHaveLength(1);
    expect(agg.stalePathErrors[0]!.sessionId).toBe('B');
    expect(agg.stalePathErrors[0]!.failedPath).toBe('Tasks/Old.md');
  });

  it('does not flag stale-path when read succeeds', () => {
    const s = summary({
      id: 'B',
      toolCalls: [
        call({ name: 'mcp__neuro-vault-mcp__search_notes', ts: 1 }),
        call({ name: 'mcp__neuro-vault-mcp__read_note', ts: 2 }),
      ],
    });
    expect(aggregate([s]).stalePathErrors).toHaveLength(0);
  });

  it('computes currentNote anchor distribution', () => {
    const s1 = summary({ id: 'a', currentNote: 'Tasks/A.md', toolCalls: [] });
    const s2 = summary({ id: 'b', currentNote: 'Tasks/A.md', toolCalls: [] });
    const s3 = summary({ id: 'c', currentNote: 'Tasks/B.md', toolCalls: [] });
    const agg = aggregate([s1, s2, s3]);
    expect(agg.currentNoteAnchors[0]).toEqual({ key: 'Tasks/A.md', count: 2 });
  });

  it('computes cache-hit distribution and dead-end count', () => {
    const s1 = summary({ id: 'a', toolCalls: [], cacheHitRatio: 0.1 });
    const s2 = summary({ id: 'b', toolCalls: [], cacheHitRatio: 0.5, outcome: 'dead_end' });
    const s3 = summary({ id: 'c', toolCalls: [], cacheHitRatio: 0.9 });
    const agg = aggregate([s1, s2, s3]);
    expect(agg.cacheHitDistribution.mean).toBeCloseTo(0.5, 3);
    expect(agg.deadEndCount).toBe(1);
  });

  it('computes subagent budget across sessions', () => {
    const s1 = summary({
      id: 'a',
      toolCalls: [],
      subagent: { count: 2, toolCallsPerAgent: [3, 5], finalCallOkRate: 1 },
    });
    const s2 = summary({
      id: 'b',
      toolCalls: [],
      subagent: { count: 1, toolCallsPerAgent: [10], finalCallOkRate: 1 },
    });
    const agg = aggregate([s1, s2]);
    expect(agg.subagentBudget.max).toBe(10);
    expect(agg.subagentBudget.mean).toBeCloseTo(6, 5);
  });
});
