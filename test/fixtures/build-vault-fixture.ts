import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { encodeVaultPath } from '../../src/config.js';

const METAS: Record<string, unknown> = {
  'conv-A-vault-n1.meta.json': {
    id: 'conv-A',
    title: 'Read tasks for today',
    createdAt: 1745700000000,
    updatedAt: 1745700300000,
    currentNote: 'Tasks/Today.md',
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
  },
  'conv-B-stale-path.meta.json': {
    id: 'conv-B',
    title: 'Search and read',
    createdAt: 1745700400000,
    updatedAt: 1745700500000,
    currentNote: 'Tasks/Stale.md',
    sessionId: 'session-B',
    usage: {
      model: 'sonnet',
      inputTokens: 5,
      cacheCreationInputTokens: 50,
      cacheReadInputTokens: 500,
      contextWindow: 200000,
      contextTokens: 555,
      percentage: 1,
    },
  },
  'conv-C-not-vault.meta.json': {
    id: 'conv-C',
    title: 'Code review of foo.ts',
    createdAt: 1745700700000,
    updatedAt: 1745700800000,
    currentNote: null,
    sessionId: 'session-C',
    usage: {
      model: 'sonnet',
      inputTokens: 10,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      contextWindow: 200000,
      contextTokens: 10,
      percentage: 0,
    },
  },
  'conv-D-heavy.meta.json': {
    id: 'conv-D',
    title: 'Long planning session',
    createdAt: 1745700900000,
    updatedAt: 1745704500000,
    currentNote: 'Tasks/Planning.md',
    sessionId: 'session-D',
    usage: {
      model: 'opus',
      inputTokens: 100,
      cacheCreationInputTokens: 5000,
      cacheReadInputTokens: 95000,
      contextWindow: 200000,
      contextTokens: 100100,
      percentage: 51,
    },
  },
  'conv-E-subagent.meta.json': {
    id: 'conv-E',
    title: 'Dispatch subagent',
    createdAt: 1745704600000,
    updatedAt: 1745704800000,
    currentNote: 'Tasks/Subagent.md',
    sessionId: 'session-E',
    usage: {
      model: 'opus',
      inputTokens: 1,
      cacheCreationInputTokens: 100,
      cacheReadInputTokens: 200,
      contextWindow: 200000,
      contextTokens: 301,
      percentage: 0,
    },
  },
  'conv-F-missing-sdk.meta.json': {
    id: 'conv-F',
    title: 'Lost transcript',
    createdAt: 1745704900000,
    updatedAt: 1745705000000,
    currentNote: 'Tasks/Lost.md',
    sessionId: 'session-F',
    usage: {
      model: 'sonnet',
      inputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      contextWindow: 200000,
      contextTokens: 0,
      percentage: 0,
    },
  },
};

const SDK_LOGS: Record<string, string> = {
  'session-A.jsonl': [
    '{"type":"assistant","timestamp":"2026-04-26T10:00:01.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"a1","name":"mcp__neuro-vault-mcp__get_tag","input":{"tag":"#today"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T10:00:02.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a1","content":"five paths"}]}}',
    '{"type":"assistant","timestamp":"2026-04-26T10:00:03.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"a2","name":"mcp__neuro-vault-mcp__read_property","input":{"path":"Tasks/1.md"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T10:00:04.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a2","content":"x"}]}}',
    '{"type":"assistant","timestamp":"2026-04-26T10:00:05.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"a3","name":"mcp__neuro-vault-mcp__read_property","input":{"path":"Tasks/2.md"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T10:00:06.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a3","content":"x"}]}}',
    '{"type":"assistant","timestamp":"2026-04-26T10:00:07.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"a4","name":"mcp__neuro-vault-mcp__read_property","input":{"path":"Tasks/3.md"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T10:00:08.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a4","content":"x"}]}}',
    '{"type":"assistant","timestamp":"2026-04-26T10:00:09.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"a5","name":"mcp__neuro-vault-mcp__read_property","input":{"path":"Tasks/4.md"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T10:00:10.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a5","content":"x"}]}}',
  ].join('\n'),
  'session-B.jsonl': [
    '{"type":"assistant","timestamp":"2026-04-26T10:10:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"b1","name":"mcp__neuro-vault-mcp__search_notes","input":{"query":"foo"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T10:10:01.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"b1","content":"[\\"Tasks/Old.md\\"]"}]}}',
    '{"type":"assistant","timestamp":"2026-04-26T10:10:02.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"b2","name":"mcp__neuro-vault-mcp__read_note","input":{"path":"Tasks/Old.md"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T10:10:03.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"b2","content":"not found","is_error":true}]}}',
  ].join('\n'),
  'session-C.jsonl': [
    '{"type":"assistant","timestamp":"2026-04-26T10:20:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"c1","name":"Bash","input":{"command":"ls"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T10:20:01.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"c1","content":"file.txt"}]}}',
  ].join('\n'),
  'session-D.jsonl': [
    '{"type":"assistant","timestamp":"2026-04-26T11:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"d1","name":"mcp__neuro-vault-mcp__search_notes","input":{"query":"plan"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T11:00:01.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"d1","content":"results"}]}}',
    '{"type":"assistant","timestamp":"2026-04-26T11:00:02.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"d2","name":"mcp__neuro-vault-mcp__read_note","input":{"path":"Tasks/Planning.md"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T11:00:03.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"d2","content":"long content"}]}}',
  ].join('\n'),
  'session-E.jsonl': [
    '{"type":"assistant","timestamp":"2026-04-26T12:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"e1","name":"mcp__neuro-vault-mcp__search_notes","input":{"query":"x"}}]}}',
    '{"type":"user","timestamp":"2026-04-26T12:00:01.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"e1","content":"r"}]}}',
  ].join('\n'),
};

const SUBAGENT_LOGS: Record<string, Record<string, string>> = {
  'session-E': {
    'agent-1.jsonl': [
      '{"type":"assistant","timestamp":"2026-04-26T12:00:10.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"e1a","name":"mcp__neuro-vault-mcp__read_note","input":{"path":"a.md"}}]}}',
      '{"type":"user","timestamp":"2026-04-26T12:00:11.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"e1a","content":"a"}]}}',
      '{"type":"assistant","timestamp":"2026-04-26T12:00:12.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"e1b","name":"mcp__neuro-vault-mcp__read_note","input":{"path":"b.md"}}]}}',
      '{"type":"user","timestamp":"2026-04-26T12:00:13.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"e1b","content":"b"}]}}',
    ].join('\n'),
  },
};

export interface VaultFixture {
  root: string;
  vaultDir: string;
  projectsDir: string;
}

export async function buildVaultFixture(): Promise<VaultFixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nv-analytics-'));
  const vaultDir = path.join(root, 'vault');
  const projectsDir = path.join(root, 'projects');
  await fs.mkdir(path.join(vaultDir, '.obsidian'), { recursive: true });
  const sessionsDir = path.join(vaultDir, '.claude', 'sessions');
  await fs.mkdir(sessionsDir, { recursive: true });
  for (const [name, body] of Object.entries(METAS)) {
    await fs.writeFile(path.join(sessionsDir, name), JSON.stringify(body, null, 2));
  }

  const encoded = encodeVaultPath(path.resolve(vaultDir));
  const projRoot = path.join(projectsDir, encoded);
  await fs.mkdir(projRoot, { recursive: true });
  for (const [name, body] of Object.entries(SDK_LOGS)) {
    await fs.writeFile(path.join(projRoot, name), body);
  }
  for (const [sessionId, files] of Object.entries(SUBAGENT_LOGS)) {
    const dir = path.join(projRoot, sessionId, 'subagents');
    await fs.mkdir(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      await fs.writeFile(path.join(dir, name), body);
    }
  }

  return { root, vaultDir, projectsDir };
}
