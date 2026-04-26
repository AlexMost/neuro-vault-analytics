import { describe, expect, it } from 'vitest';
import { extractToolCalls } from '../src/parse-jsonl.js';

const FIXTURE = [
  // Noise: queue op
  JSON.stringify({ type: 'queue-operation', operation: 'enqueue' }),
  // tool_use (search_notes)
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-04-22T17:15:08.056Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Looking…' },
        {
          type: 'tool_use',
          id: 'tool_1',
          name: 'mcp__neuro-vault-mcp__search_notes',
          input: { query: 'vector db', limit: 5 },
        },
      ],
    },
  }),
  // tool_result for tool_1 (success)
  JSON.stringify({
    type: 'user',
    timestamp: '2026-04-22T17:15:09.000Z',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: 'one result' }],
    },
  }),
  // tool_use (read_note)
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-04-22T17:15:10.000Z',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'tool_2',
          name: 'mcp__neuro-vault-mcp__read_note',
          input: { path: 'Notes/x.md' },
        },
      ],
    },
  }),
  // tool_result for tool_2 (error)
  JSON.stringify({
    type: 'user',
    timestamp: '2026-04-22T17:15:11.000Z',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool_2',
          content: 'not found',
          is_error: true,
        },
      ],
    },
  }),
  // Garbage line — must not crash
  '{not json',
  '',
].join('\n');

describe('extractToolCalls', () => {
  it('extracts tool_use lines and resolves results to ok / error', () => {
    const calls = extractToolCalls(FIXTURE, 'main');
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      name: 'mcp__neuro-vault-mcp__search_notes',
      status: 'ok',
      source: 'main',
    });
    expect(calls[1]).toMatchObject({
      name: 'mcp__neuro-vault-mcp__read_note',
      status: 'error',
      source: 'main',
    });
    expect(calls[0]!.argsSummary).toContain('vector db');
  });

  it('caps argsSummary length', () => {
    const long = 'x'.repeat(500);
    const lines = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T17:15:08.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'foo', input: { q: long } }],
      },
    });
    const [call] = extractToolCalls(lines, 'main');
    expect(call!.argsSummary.length).toBeLessThanOrEqual(120);
  });

  it('passes the source label through', () => {
    const oneCall = JSON.stringify({
      type: 'assistant',
      timestamp: '2026-04-22T17:15:08.000Z',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't', name: 'foo', input: {} }],
      },
    });
    const [call] = extractToolCalls(oneCall, 'subagent:abc');
    expect(call!.source).toBe('subagent:abc');
  });
});
