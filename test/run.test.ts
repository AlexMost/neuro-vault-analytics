// test/run.test.ts
import fs from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { buildVaultFixture, type VaultFixture } from './fixtures/build-vault-fixture.js';

describe('run', () => {
  let fixture: VaultFixture;

  beforeAll(async () => {
    fixture = await buildVaultFixture();
  });

  afterAll(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it('returns an AnalyticsReport with vault sessions filtered, samples populated, warnings forwarded', async () => {
    const report = await run({
      vaultDir: fixture.vaultDir,
      projectsDir: fixture.projectsDir,
      period: { startMs: 1_745_000_000_000, endMs: 1_746_000_000_000, label: 'fixture' },
      byteBudget: 10_000_000,
    });

    // Six metas exist (A-F); F is missing-SDK and only meta. The full count is 6.
    expect(report.stats.sessionsTotal).toBe(6);
    // C is non-vault (no currentNote, no neuro-vault tools, no wiki-link) → filtered out.
    expect(report.stats.sessionsVault).toBe(5);
    // A is the N+1 fixture: read_property (4 calls) ties with read_note (4 calls);
    // tie-break is alphabetical so read_note sorts first.
    expect(report.aggregates.topTools[0]!.key).toBe('mcp__neuro-vault-mcp__read_note');
    expect(report.aggregates.topTools[0]!.count).toBe(4);
    expect(report.aggregates.topTools[1]!.key).toBe('mcp__neuro-vault-mcp__read_property');
    expect(report.aggregates.topTools[1]!.count).toBe(4);
    // B is the stale-path fixture.
    expect(report.aggregates.stalePathErrors).toHaveLength(1);
    // F is missing SDK → warning.
    expect(report.warnings.some((w) => w.includes('session-F'))).toBe(true);
    expect(report.samples.length).toBeGreaterThan(0);
  });
});
