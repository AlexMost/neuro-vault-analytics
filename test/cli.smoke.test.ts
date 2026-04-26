import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildVaultFixture, type VaultFixture } from './fixtures/build-vault-fixture.js';

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, '..');

describe('nv-analytics CLI smoke', () => {
  let fixture: VaultFixture;

  beforeAll(async () => {
    fixture = await buildVaultFixture();
  });

  afterAll(async () => {
    await fs.rm(fixture.root, { recursive: true, force: true });
  });

  it('runs against the fixture vault and prints a valid AnalyticsReport JSON', async () => {
    const { stdout } = await exec(
      'node',
      [
        path.join(ROOT, 'dist/cli.js'),
        '--period',
        '99999d',
        '--vault',
        fixture.vaultDir,
        '--projects-dir',
        fixture.projectsDir,
        '--format',
        'json',
      ],
      { cwd: ROOT },
    );
    const report = JSON.parse(stdout);
    expect(report.period.label).toBe('99999d');
    expect(report.stats.sessionsVault).toBeGreaterThan(0);
    expect(Array.isArray(report.warnings)).toBe(true);
  }, 20_000);

  it('respects --format text', async () => {
    const { stdout } = await exec(
      'node',
      [
        path.join(ROOT, 'dist/cli.js'),
        '--period',
        '99999d',
        '--vault',
        fixture.vaultDir,
        '--projects-dir',
        fixture.projectsDir,
        '--format',
        'text',
      ],
      { cwd: ROOT },
    );
    expect(stdout).toMatch(/Usage analytics/);
  }, 20_000);
});
