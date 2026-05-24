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

  it('returns an AnalyticsReport split across vault and projects buckets', async () => {
    const report = await run({
      vaultDir: fixture.vaultDir,
      projectsDir: fixture.projectsDir,
      period: { startMs: 1_745_000_000_000, endMs: 1_746_000_000_000, label: 'fixture' },
      byteBudget: 10_000_000,
    });

    // Fixture has six vault metas (A-F); C is non-vault → filtered, F has no SDK log but its
    // meta still counts toward the vault bucket because currentNote is set. Five vault sessions survive.
    expect(report.buckets.vault.sessionsTotal).toBe(5);
    // Projects bucket has one external session under `-Users-x-git-catalog-ui`.
    expect(report.buckets.projects.sessionsTotal).toBe(1);
    // Total is union of both.
    expect(report.buckets.total.sessionsTotal).toBe(6);

    // A is the N+1 fixture: read_property and read_notes both ×4 in the vault bucket;
    // alphabetical tie-break puts read_notes first.
    expect(report.buckets.vault.topTools[0]!.key).toBe('mcp__neuro-vault__read_notes');
    expect(report.buckets.vault.topTools[0]!.count).toBe(4);
    expect(report.buckets.vault.topTools[1]!.key).toBe('mcp__neuro-vault__read_property');

    // B is the stale-path fixture.
    expect(report.buckets.vault.stalePathErrors).toHaveLength(1);

    // F is missing SDK → warning.
    expect(report.warnings.some((w) => w.includes('session-F'))).toBe(true);

    // Per-project breakdown surfaces the external project that called the vault MCP.
    expect(report.perProject).toHaveLength(1);
    expect(report.perProject[0]!.project).toBe('-Users-x-git-catalog-ui');

    // edit_note lives only in the external project — surfaces in projects.topTools AND
    // is flagged as unique to that project.
    expect(report.buckets.projects.topTools.some((t) => t.key.endsWith('edit_note'))).toBe(true);
    expect(report.perProject[0]!.uniqueTools).toContain('mcp__neuro-vault__edit_note');

    // Samples have at least one from each bucket given fixture data.
    expect(report.samples.length).toBeGreaterThan(0);
    expect(report.samples.some((s) => s.bucket === 'vault')).toBe(true);
    expect(report.samples.some((s) => s.bucket === 'projects')).toBe(true);
  });
});
