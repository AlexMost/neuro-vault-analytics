import fs from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { discoverSessions } from '../src/discover.js';
import { buildVaultFixture, type VaultFixture } from './fixtures/build-vault-fixture.js';

const PERIOD = { startMs: 1_745_000_000_000, endMs: 1_746_000_000_000, label: 'fixture' };

describe('discoverSessions', () => {
  let fixture: VaultFixture;

  beforeAll(async () => {
    fixture = await buildVaultFixture();
  });

  afterAll(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it('returns one Discovered per meta in the period', async () => {
    const result = await discoverSessions({
      vaultDir: fixture.vaultDir,
      projectsDir: fixture.projectsDir,
      period: PERIOD,
    });
    const ids = result.discovered.map((d) => d.meta.id).sort();
    expect(ids).toEqual(['conv-A', 'conv-B', 'conv-C', 'conv-D', 'conv-E', 'conv-F']);
  });

  it('joins by sessionId to the SDK log', async () => {
    const { discovered } = await discoverSessions({
      vaultDir: fixture.vaultDir,
      projectsDir: fixture.projectsDir,
      period: PERIOD,
    });
    const a = discovered.find((d) => d.meta.id === 'conv-A')!;
    expect(a.mainLog).toContain('"id":"a1"');
  });

  it('reads subagent sidecars', async () => {
    const { discovered } = await discoverSessions({
      vaultDir: fixture.vaultDir,
      projectsDir: fixture.projectsDir,
      period: PERIOD,
    });
    const e = discovered.find((d) => d.meta.id === 'conv-E')!;
    expect(e.subagentLogs).toHaveLength(1);
    expect(e.subagentLogs[0]!.agentId).toBe('1');
  });

  it('records a warning when SDK log is missing but does not drop the meta', async () => {
    const { discovered, warnings } = await discoverSessions({
      vaultDir: fixture.vaultDir,
      projectsDir: fixture.projectsDir,
      period: PERIOD,
    });
    const f = discovered.find((d) => d.meta.id === 'conv-F')!;
    expect(f.mainLog).toBe('');
    expect(warnings.some((w) => w.includes('session-F'))).toBe(true);
  });

  it('drops metas outside the period', async () => {
    const { discovered } = await discoverSessions({
      vaultDir: fixture.vaultDir,
      projectsDir: fixture.projectsDir,
      period: { startMs: 0, endMs: 1, label: 'tiny' },
    });
    expect(discovered).toHaveLength(0);
  });
});
