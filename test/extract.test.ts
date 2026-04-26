import { describe, expect, it } from 'vitest';
import { toSessionSummary } from '../src/extract.js';
import type { Discovered } from '../src/discover.js';

const meta = {
  id: 'conv-A',
  title: 'N+1',
  createdAt: 1_000,
  updatedAt: 6_000,
  currentNote: 'Tasks/x.md',
  sessionId: 'session-A',
  usage: {
    model: 'opus',
    inputTokens: 10,
    cacheCreationInputTokens: 100,
    cacheReadInputTokens: 900,
    contextWindow: 200000,
    contextTokens: 1010,
    percentage: 1,
  },
};

const MAIN = [
  '{"type":"assistant","timestamp":"2026-04-26T10:00:01.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"a1","name":"mcp__neuro-vault-mcp__get_tag","input":{"tag":"#x"}}]}}',
  '{"type":"user","timestamp":"2026-04-26T10:00:02.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a1","content":"r"}]}}',
  '{"type":"assistant","timestamp":"2026-04-26T10:00:03.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"a2","name":"mcp__neuro-vault-mcp__read_note","input":{}}]}}',
  '{"type":"user","timestamp":"2026-04-26T10:00:04.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a2","content":"err","is_error":true}]}}',
].join('\n');

const SIDE = [
  '{"type":"assistant","timestamp":"2026-04-26T10:00:05.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"s1","name":"mcp__neuro-vault-mcp__search_notes","input":{}}]}}',
  '{"type":"user","timestamp":"2026-04-26T10:00:06.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"s1","content":"r"}]}}',
].join('\n');

const D: Discovered = {
  meta,
  mainLog: MAIN,
  subagentLogs: [{ agentId: '7', jsonl: SIDE }],
};

describe('toSessionSummary', () => {
  it('merges main + subagent tool calls in chronological order', () => {
    const s = toSessionSummary(D);
    expect(s.toolCalls.map((c) => c.name)).toEqual([
      'mcp__neuro-vault-mcp__get_tag',
      'mcp__neuro-vault-mcp__read_note',
      'mcp__neuro-vault-mcp__search_notes',
    ]);
    expect(s.toolCalls[2]!.source).toBe('subagent:7');
  });

  it('computes cache hit ratio', () => {
    const s = toSessionSummary(D);
    expect(s.cacheHitRatio).toBeCloseTo(900 / 1010, 3);
  });

  it('computes durationMs from meta', () => {
    expect(toSessionSummary(D).durationMs).toBe(5_000);
  });

  it('marks outcome as dead_end when the last main-session call errored', () => {
    const onlyError: Discovered = { meta, mainLog: MAIN, subagentLogs: [] };
    expect(toSessionSummary(onlyError).outcome).toBe('dead_end');
  });

  it('marks outcome as completed otherwise', () => {
    const completed: Discovered = { meta, mainLog: SIDE, subagentLogs: [] };
    expect(toSessionSummary(completed).outcome).toBe('completed');
  });

  it('reports subagent tool counts', () => {
    const s = toSessionSummary(D);
    expect(s.subagent.count).toBe(1);
    expect(s.subagent.toolCallsPerAgent).toEqual([1]);
  });
});
