import { describe, expect, it } from 'vitest';
import { projectSession, sampleSessions } from '../src/sample.js';
import type { SessionSummary, ToolCall } from '../src/types.js';

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

function call(name: string, opts: Partial<ToolCall> = {}): ToolCall {
  return {
    name,
    argsSummary: '',
    resultSize: 0,
    status: 'ok',
    source: 'main',
    ts: 0,
    ...opts,
  };
}

describe('projectSession', () => {
  it('puts MCP calls in mcpCalls verbatim and non-MCP into nonMcpSummary', () => {
    const session = s('x', 0, 0);
    session.toolCalls = [
      call('mcp__neuro-vault-mcp__search_notes'),
      call('mcp__neuro-vault-mcp__read_note'),
      call('Read'),
      call('Read'),
      call('Edit'),
    ];
    const projected = projectSession(session);
    expect(projected.toolCallSummary.total).toBe(5);
    expect(projected.toolCallSummary.mcpCalls.map((c) => c.name)).toEqual([
      'mcp__neuro-vault-mcp__search_notes',
      'mcp__neuro-vault-mcp__read_note',
    ]);
    expect(projected.toolCallSummary.nonMcpSummary.total).toBe(3);
    expect(projected.toolCallSummary.nonMcpSummary.topTools.find((t) => t.key === 'Read')!.count).toBe(2);
  });

  it('routes anomalies (status=error or resultSize > 5KB) into the anomalies bucket', () => {
    const session = s('y', 0, 0);
    session.toolCalls = [
      call('Read', { resultSize: 10_000 }),
      call('Edit', { status: 'error' }),
      call('mcp__neuro-vault-mcp__read_note', { status: 'error' }),
      call('Read'),
    ];
    const p = projectSession(session);
    expect(p.toolCallSummary.anomalies).toHaveLength(3);
    expect(p.toolCallSummary.mcpCalls).toHaveLength(1);
    expect(p.toolCallSummary.nonMcpSummary.topTools.find((t) => t.key === 'Read')!.count).toBe(1);
    expect(p.toolCallSummary.nonMcpSummary.topTools.find((t) => t.key === 'Edit')).toBeUndefined();
  });

  it('handles a zero-MCP session: mcpCalls is empty, nonMcpSummary populated', () => {
    const session = s('z', 0, 0);
    session.toolCalls = [call('Read'), call('Edit'), call('Bash')];
    const p = projectSession(session);
    expect(p.toolCallSummary.mcpCalls).toEqual([]);
    expect(p.toolCallSummary.nonMcpSummary.total).toBe(3);
    expect(p.toolCallSummary.nonMcpSummary.topTools).toHaveLength(3);
  });

  it('emits at most 3 n-grams of the non-MCP, non-anomalous stream', () => {
    const session = s('q', 0, 0);
    session.toolCalls = [
      call('Read'),
      call('Edit'),
      call('Read'),
      call('Edit'),
      call('Bash'),
      call('Read'),
      call('Edit'),
    ];
    const p = projectSession(session);
    const sequences = p.toolCallSummary.nonMcpSummary.nGrams.map((g) => g.sequence.join('>'));
    expect(p.toolCallSummary.nonMcpSummary.nGrams.length).toBeLessThanOrEqual(3);
    expect(sequences).toContain('Read>Edit');
  });
});

describe('sampleSessions (byte-budget)', () => {
  it('returns all sessions when total cost < budget', () => {
    const all = [s('a', 1, 1), s('b', 2, 2)];
    const out = sampleSessions(all, { byteBudget: 10_000_000 });
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('stops adding sessions once budget is exceeded', () => {
    const all = Array.from({ length: 50 }, (_, i) => s(`s${i}`, i % 24, 5));
    const out = sampleSessions(all, { byteBudget: 5_000 });
    const totalBytes = out.reduce(
      (sum, sample) => sum + Buffer.byteLength(JSON.stringify(sample), 'utf8'),
      0,
    );
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThan(50);
    const maxExtra = Buffer.byteLength(JSON.stringify(out[0]), 'utf8');
    expect(totalBytes).toBeLessThanOrEqual(5_000 + maxExtra);
  });

  it('always returns at least one session even if it alone exceeds budget', () => {
    const all = [s('huge', 0, 200)];
    const out = sampleSessions(all, { byteBudget: 1 });
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('huge');
  });

  it('returns SampledSession shape (toolCallSummary, no toolCalls)', () => {
    const all = [s('a', 1, 1)];
    const out = sampleSessions(all, { byteBudget: 1_000_000 });
    expect(out[0]!.toolCallSummary).toBeDefined();
    expect((out[0]! as unknown as { toolCalls?: unknown }).toolCalls).toBeUndefined();
  });

  it('covers a range of hours when stratifying', () => {
    const all = Array.from({ length: 30 }, (_, i) => s(`s${i}`, i % 24, 1));
    const out = sampleSessions(all, { byteBudget: 1_000_000 });
    const hours = new Set(out.map((x) => new Date(x.createdAt).getUTCHours() % 24));
    const bucketsRepresented = new Set([...hours].map((h) => Math.floor(h / 6)));
    expect(bucketsRepresented.size).toBe(4);
  });
});
