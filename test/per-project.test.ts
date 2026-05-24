import { describe, expect, it } from 'vitest';
import { buildPerProject, type ExternalSession } from '../src/per-project.js';
import type { SessionSummary, ToolCall } from '../src/types.js';

function call(name: string, ts = 0): ToolCall {
  return { name, argsSummary: '', resultSize: 100, status: 'ok', source: 'main', ts };
}

function summary(id: string, tools: string[]): SessionSummary {
  return {
    id,
    title: 't',
    createdAt: 0,
    updatedAt: 1,
    durationMs: 1,
    model: 'opus',
    contextPercentage: 0,
    cacheHitRatio: 0.5,
    currentNote: null,
    toolCalls: tools.map((t, i) => call(t, i)),
    subagent: { count: 0, toolCallsPerAgent: [], finalCallOkRate: 1 },
    outcome: 'completed',
  };
}

describe('buildPerProject', () => {
  it('groups external sessions by project and ranks by sessionsVault desc', () => {
    const external: ExternalSession[] = [
      { project: '-Users-x-git-a', summary: summary('a1', ['t1']) },
      { project: '-Users-x-git-a', summary: summary('a2', ['t1']) },
      { project: '-Users-x-git-b', summary: summary('b1', ['t2']) },
    ];
    const out = buildPerProject([], external);
    expect(out).toHaveLength(2);
    expect(out[0]!.project).toBe('-Users-x-git-a');
    expect(out[0]!.sessionsTotal).toBe(2);
    expect(out[1]!.project).toBe('-Users-x-git-b');
  });

  it('flags a tool as unique to a project when no other project and not vault use it', () => {
    const vault = [summary('v1', ['shared'])];
    const external: ExternalSession[] = [
      { project: '-Users-x-git-a', summary: summary('a1', ['shared', 'unique_to_a']) },
      { project: '-Users-x-git-b', summary: summary('b1', ['shared']) },
    ];
    const out = buildPerProject(vault, external);
    const a = out.find((p) => p.project === '-Users-x-git-a')!;
    const b = out.find((p) => p.project === '-Users-x-git-b')!;
    expect(a.uniqueTools).toContain('unique_to_a');
    expect(a.uniqueTools).not.toContain('shared');
    expect(b.uniqueTools).toEqual([]);
  });

  it('does NOT mark a tool as unique to a project when the vault also uses it', () => {
    const vault = [summary('v1', ['get_vault_overview'])];
    const external: ExternalSession[] = [
      { project: '-Users-x-git-a', summary: summary('a1', ['get_vault_overview']) },
    ];
    const out = buildPerProject(vault, external);
    expect(out[0]!.uniqueTools).toEqual([]);
  });

  it('returns empty list when there are no external sessions', () => {
    expect(buildPerProject([summary('v1', ['t1'])], [])).toEqual([]);
  });

  it('caps topTools at 5 per project', () => {
    const tools = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'];
    const external: ExternalSession[] = [
      { project: '-Users-x-git-a', summary: summary('a1', tools) },
    ];
    const out = buildPerProject([], external);
    expect(out[0]!.topTools.length).toBeLessThanOrEqual(5);
  });
});
