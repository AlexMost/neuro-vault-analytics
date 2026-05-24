import { describe, expect, it } from 'vitest';
import { projectSession, sampleBalanced, sampleSessions } from '../src/sample.js';
import type { ExternalSession } from '../src/per-project.js';
import type { ProjectSessionOpts } from '../src/sample.js';
import type { SessionSummary, ToolCall } from '../src/types.js';

const VAULT_TAG: ProjectSessionOpts = { bucket: 'vault', project: null };

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
      call('mcp__neuro-vault__search_notes'),
      call('mcp__neuro-vault__read_notes'),
      call('Read'),
      call('Read'),
      call('Edit'),
    ];
    const projected = projectSession(session, VAULT_TAG);
    expect(projected.toolCallSummary.total).toBe(5);
    expect(projected.toolCallSummary.mcpCalls.map((c) => c.name)).toEqual([
      'mcp__neuro-vault__search_notes',
      'mcp__neuro-vault__read_notes',
    ]);
    expect(projected.toolCallSummary.nonMcpSummary.total).toBe(3);
    expect(projected.toolCallSummary.nonMcpSummary.topTools.find((t) => t.key === 'Read')!.count).toBe(2);
    expect(projected.bucket).toBe('vault');
    expect(projected.project).toBeNull();
  });

  it('routes anomalies (status=error or resultSize > 5KB) into the anomalies bucket', () => {
    const session = s('y', 0, 0);
    session.toolCalls = [
      call('Read', { resultSize: 10_000 }),
      call('Edit', { status: 'error' }),
      call('mcp__neuro-vault__read_notes', { status: 'error' }),
      call('Read'),
    ];
    const p = projectSession(session, VAULT_TAG);
    expect(p.toolCallSummary.anomalies).toHaveLength(3);
    expect(p.toolCallSummary.mcpCalls).toHaveLength(1);
    expect(p.toolCallSummary.nonMcpSummary.topTools.find((t) => t.key === 'Read')!.count).toBe(1);
    expect(p.toolCallSummary.nonMcpSummary.topTools.find((t) => t.key === 'Edit')).toBeUndefined();
  });

  it('handles a zero-MCP session: mcpCalls is empty, nonMcpSummary populated', () => {
    const session = s('z', 0, 0);
    session.toolCalls = [call('Read'), call('Edit'), call('Bash')];
    const p = projectSession(session, VAULT_TAG);
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
    const p = projectSession(session, VAULT_TAG);
    const sequences = p.toolCallSummary.nonMcpSummary.nGrams.map((g) => g.sequence.join('>'));
    expect(p.toolCallSummary.nonMcpSummary.nGrams.length).toBeLessThanOrEqual(3);
    expect(sequences).toContain('Read>Edit');
  });

  it('tags samples from the projects bucket with their project', () => {
    const session = s('p', 0, 1);
    const projected = projectSession(session, { bucket: 'projects', project: '-Users-x-git-a' });
    expect(projected.bucket).toBe('projects');
    expect(projected.project).toBe('-Users-x-git-a');
  });
});

describe('sampleSessions (byte-budget)', () => {
  it('returns all sessions when total cost < budget', () => {
    const all = [s('a', 1, 1), s('b', 2, 2)];
    const out = sampleSessions(all, { byteBudget: 10_000_000 }, VAULT_TAG);
    expect(out.map((x) => x.id).sort()).toEqual(['a', 'b']);
  });

  it('stops adding sessions once budget is exceeded', () => {
    const all = Array.from({ length: 50 }, (_, i) => s(`s${i}`, i % 24, 5));
    const out = sampleSessions(all, { byteBudget: 5_000 }, VAULT_TAG);
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
    const out = sampleSessions(all, { byteBudget: 1 }, VAULT_TAG);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('huge');
  });

  it('returns SampledSession shape (toolCallSummary, no toolCalls)', () => {
    const all = [s('a', 1, 1)];
    const out = sampleSessions(all, { byteBudget: 1_000_000 }, VAULT_TAG);
    expect(out[0]!.toolCallSummary).toBeDefined();
    expect((out[0]! as unknown as { toolCalls?: unknown }).toolCalls).toBeUndefined();
  });

  it('covers a range of hours when stratifying', () => {
    const all = Array.from({ length: 30 }, (_, i) => s(`s${i}`, i % 24, 1));
    const out = sampleSessions(all, { byteBudget: 1_000_000 }, VAULT_TAG);
    const hours = new Set(out.map((x) => new Date(x.createdAt).getUTCHours() % 24));
    const bucketsRepresented = new Set([...hours].map((h) => Math.floor(h / 6)));
    expect(bucketsRepresented.size).toBe(4);
  });
});

function externalFrom(sessions: SessionSummary[], project: string): ExternalSession[] {
  return sessions.map((summary) => ({ project, summary }));
}

describe('sampleBalanced', () => {
  it('produces samples tagged with their bucket from both pools', () => {
    const vault = [s('v0', 1, 1), s('v1', 5, 2)];
    const projects = externalFrom([s('p0', 10, 1), s('p1', 14, 2)], '-Users-x-git-a');
    const out = sampleBalanced(vault, projects, { byteBudget: 1_000_000 });
    expect(out.samples.some((x) => x.bucket === 'vault')).toBe(true);
    expect(out.samples.some((x) => x.bucket === 'projects')).toBe(true);
    const projectsSample = out.samples.find((x) => x.bucket === 'projects')!;
    expect(projectsSample.project).toBe('-Users-x-git-a');
    const vaultSample = out.samples.find((x) => x.bucket === 'vault')!;
    expect(vaultSample.project).toBeNull();
  });

  it('handles an empty projects pool — vault budget still used', () => {
    const vault = Array.from({ length: 3 }, (_, i) => s(`v${i}`, i % 24, 1));
    const out = sampleBalanced(vault, [], { byteBudget: 1_000_000 });
    expect(out.samples.length).toBeGreaterThan(0);
    expect(out.samples.every((x) => x.bucket === 'vault')).toBe(true);
  });

  it('handles an empty vault pool — projects budget still used', () => {
    const projects = externalFrom(
      Array.from({ length: 3 }, (_, i) => s(`p${i}`, i % 24, 1)),
      '-Users-x-git-a',
    );
    const out = sampleBalanced([], projects, { byteBudget: 1_000_000 });
    expect(out.samples.length).toBeGreaterThan(0);
    expect(out.samples.every((x) => x.bucket === 'projects')).toBe(true);
  });

  it('respects the budget — total cost stays below it (modulo the underflow-tolerance for the first sample of each pool)', () => {
    const vault = Array.from({ length: 30 }, (_, i) => s(`v${i}`, i % 24, 3));
    const projects = externalFrom(
      Array.from({ length: 30 }, (_, i) => s(`p${i}`, i % 24, 3)),
      '-Users-x-git-a',
    );
    const out = sampleBalanced(vault, projects, { byteBudget: 5_000 });
    expect(out.samples.length).toBeGreaterThan(0);
    expect(out.samples.length).toBeLessThan(60);
  });
});
