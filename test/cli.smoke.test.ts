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

  it('accepts --sample-bytes 50KB', async () => {
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
        '--sample-bytes',
        '50KB',
      ],
      { cwd: ROOT },
    );
    const report = JSON.parse(stdout);
    for (const s of report.samples) {
      expect(s.toolCallSummary).toBeDefined();
      expect(s.toolCalls).toBeUndefined();
    }
  }, 20_000);

  it('--detail returns the full SessionSummary for that session', async () => {
    const { stdout } = await exec(
      'node',
      [
        path.join(ROOT, 'dist/cli.js'),
        '--detail',
        'conv-A',
        '--vault',
        fixture.vaultDir,
        '--projects-dir',
        fixture.projectsDir,
      ],
      { cwd: ROOT },
    );
    const detail = JSON.parse(stdout);
    expect(detail.id).toBe('conv-A');
    expect(Array.isArray(detail.toolCalls)).toBe(true);
    expect(detail.toolCalls.length).toBeGreaterThan(0);
  }, 20_000);

  it('--detail with unknown session id exits non-zero with a clear message', async () => {
    await expect(
      exec(
        'node',
        [
          path.join(ROOT, 'dist/cli.js'),
          '--detail',
          'no-such-session',
          '--vault',
          fixture.vaultDir,
          '--projects-dir',
          fixture.projectsDir,
        ],
        { cwd: ROOT },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('session no-such-session not found'),
    });
  }, 20_000);
});
