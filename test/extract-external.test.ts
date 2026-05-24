import { describe, expect, it } from 'vitest';
import { toSessionSummaryFromExternal } from '../src/extract-external.js';
import type { DiscoveredExternal } from '../src/discover-external.js';

function build(jsonl: string, mtimeMs = 1_745_700_000_000): DiscoveredExternal {
  return {
    sessionId: 'session-X',
    project: '-Users-x-git-catalog-ui',
    mtimeMs,
    mainLog: jsonl,
    subagentLogs: [],
  };
}

describe('toSessionSummaryFromExternal', () => {
  it('derives id, title, createdAt, updatedAt, model from the JSONL', () => {
    const jsonl = [
      '{"type":"user","timestamp":"2026-04-26T13:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"Please edit my note"}]}}',
      '{"type":"assistant","timestamp":"2026-04-26T13:00:01.000Z","message":{"role":"assistant","model":"claude-sonnet-4-6","usage":{"input_tokens":10,"cache_creation_input_tokens":100,"cache_read_input_tokens":900},"content":[{"type":"tool_use","id":"a","name":"mcp__neuro-vault__edit_note","input":{}}]}}',
      '{"type":"user","timestamp":"2026-04-26T13:00:02.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a","content":"ok"}]}}',
    ].join('\n');
    const s = toSessionSummaryFromExternal(build(jsonl));
    expect(s.id).toBe('session-X');
    expect(s.title).toBe('Please edit my note');
    expect(s.createdAt).toBe(Date.parse('2026-04-26T13:00:00.000Z'));
    expect(s.updatedAt).toBe(Date.parse('2026-04-26T13:00:02.000Z'));
    expect(s.model).toBe('claude-sonnet-4-6');
    expect(s.toolCalls).toHaveLength(1);
    expect(s.toolCalls[0]!.name).toBe('mcp__neuro-vault__edit_note');
  });

  it('computes cacheHitRatio from per-turn usage blocks', () => {
    const jsonl = [
      '{"type":"assistant","timestamp":"2026-04-26T13:00:01.000Z","message":{"role":"assistant","model":"opus","usage":{"input_tokens":0,"cache_creation_input_tokens":100,"cache_read_input_tokens":900},"content":[]}}',
    ].join('\n');
    const s = toSessionSummaryFromExternal(build(jsonl));
    expect(s.cacheHitRatio).toBeCloseTo(0.9, 5);
  });

  it('falls back to mtime when no timestamps are present', () => {
    const jsonl = '{"type":"assistant","message":{"role":"assistant","content":[]}}';
    const s = toSessionSummaryFromExternal(build(jsonl, 1_745_700_000_000));
    expect(s.createdAt).toBe(1_745_700_000_000);
    expect(s.updatedAt).toBe(1_745_700_000_000);
  });

  it('fills sensible defaults when fields are missing', () => {
    const s = toSessionSummaryFromExternal(build('', 1_745_700_000_000));
    expect(s.title).toBe('(no title)');
    expect(s.model).toBe('unknown');
    expect(s.cacheHitRatio).toBe(0);
    expect(s.currentNote).toBeNull();
    expect(s.contextPercentage).toBe(0);
  });

  it('caps the title length', () => {
    const long = 'x'.repeat(200);
    const jsonl = `{"type":"user","timestamp":"2026-04-26T13:00:00.000Z","message":{"role":"user","content":[{"type":"text","text":"${long}"}]}}`;
    const s = toSessionSummaryFromExternal(build(jsonl));
    expect(s.title.length).toBeLessThanOrEqual(80);
  });
});
