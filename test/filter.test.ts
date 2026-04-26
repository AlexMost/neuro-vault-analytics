import { describe, expect, it } from 'vitest';
import { isVaultRelevant } from '../src/filter.js';
import type { Discovered } from '../src/discover.js';
import type { ClaudianMeta } from '../src/types.js';

function meta(over: Partial<ClaudianMeta> = {}): ClaudianMeta {
  return {
    id: 'x',
    title: 't',
    createdAt: 0,
    updatedAt: 0,
    currentNote: null,
    sessionId: 's',
    usage: {
      model: 'sonnet',
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      contextWindow: 200000,
      contextTokens: 0,
      percentage: 0,
    },
    ...over,
  };
}

const TOOL_LINE = (name: string) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: '2026-04-26T10:00:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'x', name, input: {} }],
    },
  });

const USER_TEXT = (text: string) =>
  JSON.stringify({
    type: 'user',
    timestamp: '2026-04-26T10:00:00.000Z',
    message: { role: 'user', content: [{ type: 'text', text }] },
  });

describe('isVaultRelevant', () => {
  it('matches sessions with neuro-vault MCP calls', () => {
    const d: Discovered = {
      meta: meta(),
      mainLog: TOOL_LINE('mcp__neuro-vault-mcp__search_notes'),
      subagentLogs: [],
    };
    expect(isVaultRelevant(d)).toBe(true);
  });

  it('matches sessions with neuro-vault calls only in subagent', () => {
    const d: Discovered = {
      meta: meta(),
      mainLog: TOOL_LINE('Bash'),
      subagentLogs: [{ agentId: '1', jsonl: TOOL_LINE('mcp__neuro-vault-mcp__read_note') }],
    };
    expect(isVaultRelevant(d)).toBe(true);
  });

  it('matches sessions with non-empty currentNote', () => {
    const d: Discovered = {
      meta: meta({ currentNote: 'Tasks/x.md' }),
      mainLog: '',
      subagentLogs: [],
    };
    expect(isVaultRelevant(d)).toBe(true);
  });

  it('matches sessions with wiki-link in user text', () => {
    const d: Discovered = {
      meta: meta(),
      mainLog: USER_TEXT('see [[Some Note]]'),
      subagentLogs: [],
    };
    expect(isVaultRelevant(d)).toBe(true);
  });

  it('rejects sessions with none of the above', () => {
    const d: Discovered = {
      meta: meta(),
      mainLog: TOOL_LINE('Bash'),
      subagentLogs: [],
    };
    expect(isVaultRelevant(d)).toBe(false);
  });
});
