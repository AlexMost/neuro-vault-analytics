import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { discoverExternalSessions } from '../src/discover-external.js';
import { addExternalProject } from './fixtures/build-vault-fixture.js';

const PERIOD = { startMs: 1_745_000_000_000, endMs: 1_746_000_000_000, label: 'fixture' };

const VAULT_CALL_JSONL = [
  '{"type":"assistant","timestamp":"2025-04-26T13:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"a","name":"mcp__neuro-vault__read_notes","input":{}}]}}',
  '{"type":"user","timestamp":"2025-04-26T13:00:01.000Z","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"a","content":"ok"}]}}',
].join('\n');

const NO_VAULT_JSONL = [
  '{"type":"assistant","timestamp":"2025-04-26T14:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"b","name":"Bash","input":{"command":"ls"}}]}}',
].join('\n');

describe('discoverExternalSessions', () => {
  let root: string;
  let projectsDir: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'nv-discover-external-'));
    projectsDir = path.join(root, 'projects');
    await fs.mkdir(projectsDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns sessions from external projects that called the vault MCP', async () => {
    await addExternalProject(projectsDir, {
      name: '-Users-x-git-catalog-ui',
      sessions: [
        { sessionId: 's1', jsonl: VAULT_CALL_JSONL, mtimeMs: 1_745_700_000_000 },
      ],
    });
    const { discovered } = await discoverExternalSessions({
      projectsDir,
      vaultProject: '-Users-x-Obsidian',
      period: PERIOD,
    });
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.project).toBe('-Users-x-git-catalog-ui');
    expect(discovered[0]!.sessionId).toBe('s1');
  });

  it('drops projects with no vault MCP calls', async () => {
    await addExternalProject(projectsDir, {
      name: '-Users-x-git-unrelated',
      sessions: [
        { sessionId: 'u1', jsonl: NO_VAULT_JSONL, mtimeMs: 1_745_700_000_000 },
      ],
    });
    const { discovered } = await discoverExternalSessions({
      projectsDir,
      vaultProject: '-Users-x-Obsidian',
      period: PERIOD,
    });
    expect(discovered).toEqual([]);
  });

  it('skips the vault project itself', async () => {
    await addExternalProject(projectsDir, {
      name: '-Users-x-Obsidian',
      sessions: [
        { sessionId: 'v1', jsonl: VAULT_CALL_JSONL, mtimeMs: 1_745_700_000_000 },
      ],
    });
    const { discovered } = await discoverExternalSessions({
      projectsDir,
      vaultProject: '-Users-x-Obsidian',
      period: PERIOD,
    });
    expect(discovered).toEqual([]);
  });

  it('drops files whose mtime predates the period (coarse filter)', async () => {
    await addExternalProject(projectsDir, {
      name: '-Users-x-git-catalog-ui',
      sessions: [
        { sessionId: 'old', jsonl: VAULT_CALL_JSONL, mtimeMs: 1_700_000_000_000 },
      ],
    });
    const { discovered } = await discoverExternalSessions({
      projectsDir,
      vaultProject: '-Users-x-Obsidian',
      period: PERIOD,
    });
    expect(discovered).toEqual([]);
  });

  it('drops files whose first-line timestamp is outside the period (refine)', async () => {
    const oldJsonl = [
      '{"type":"assistant","timestamp":"2024-01-01T00:00:00.000Z","message":{"role":"assistant","content":[{"type":"tool_use","id":"a","name":"mcp__neuro-vault__read_notes","input":{}}]}}',
    ].join('\n');
    await addExternalProject(projectsDir, {
      name: '-Users-x-git-catalog-ui',
      sessions: [
        { sessionId: 'old-first-line', jsonl: oldJsonl, mtimeMs: 1_745_700_000_000 },
      ],
    });
    const { discovered } = await discoverExternalSessions({
      projectsDir,
      vaultProject: '-Users-x-Obsidian',
      period: PERIOD,
    });
    expect(discovered).toEqual([]);
  });

  it('returns empty + warning when projects dir is missing', async () => {
    const { discovered, warnings } = await discoverExternalSessions({
      projectsDir: path.join(root, 'nonexistent'),
      vaultProject: '-Users-x-Obsidian',
      period: PERIOD,
    });
    expect(discovered).toEqual([]);
    expect(warnings[0]).toMatch(/No projects directory/);
  });

  it('keeps sessions where only the subagent log calls the vault MCP', async () => {
    await addExternalProject(projectsDir, {
      name: '-Users-x-git-catalog-ui',
      sessions: [
        {
          sessionId: 'sub-only',
          jsonl: NO_VAULT_JSONL,
          mtimeMs: 1_745_700_000_000,
          subagentLogs: { 'agent-1.jsonl': VAULT_CALL_JSONL },
        },
      ],
    });
    const { discovered } = await discoverExternalSessions({
      projectsDir,
      vaultProject: '-Users-x-Obsidian',
      period: PERIOD,
    });
    expect(discovered).toHaveLength(1);
    expect(discovered[0]!.subagentLogs).toHaveLength(1);
  });
});
