// src/run.ts
import path from 'node:path';
import { aggregate, computeUnusedTools } from './aggregate.js';
import { encodeVaultPath } from './config.js';
import { discoverSessions } from './discover.js';
import { discoverExternalSessions } from './discover-external.js';
import { toSessionSummary } from './extract.js';
import { toSessionSummaryFromExternal } from './extract-external.js';
import { isVaultRelevant } from './filter.js';
import { buildPerProject, type ExternalSession } from './per-project.js';
import type { Period } from './period.js';
import { sampleBalanced } from './sample.js';
import type { AnalyticsReport, SessionSummary } from './types.js';

export interface RunArgs {
  vaultDir: string;
  projectsDir: string;
  period: Period;
  byteBudget: number;
}

export async function run(args: RunArgs): Promise<AnalyticsReport> {
  const vaultProject = encodeVaultPath(path.resolve(args.vaultDir));

  const [{ discovered: vaultDiscovered, warnings: vaultWarnings }, externalResult] =
    await Promise.all([
      discoverSessions({
        vaultDir: args.vaultDir,
        projectsDir: args.projectsDir,
        period: args.period,
      }),
      discoverExternalSessions({
        projectsDir: args.projectsDir,
        vaultProject,
        period: args.period,
      }),
    ]);

  const vaultSummaries = vaultDiscovered
    .filter(isVaultRelevant)
    .map((d) => toSessionSummary(d, { vaultDir: args.vaultDir }));
  const externalSessions: ExternalSession[] = externalResult.discovered.map((d) => ({
    project: d.project,
    summary: toSessionSummaryFromExternal(d),
  }));
  const externalSummaries = externalSessions.map((e) => e.summary);
  const allSummaries: SessionSummary[] = [...vaultSummaries, ...externalSummaries];

  const buckets = {
    vault: aggregate(vaultSummaries),
    projects: aggregate(externalSummaries),
    total: aggregate(allSummaries),
  };

  const perProject = buildPerProject(vaultSummaries, externalSessions);
  const unusedTools = computeUnusedTools(allSummaries);
  const sampleResult = sampleBalanced(vaultSummaries, externalSessions, {
    byteBudget: args.byteBudget,
  });

  const warnings = [...vaultWarnings, ...externalResult.warnings];
  if (sampleResult.budgetUnderflow) {
    warnings.push(
      `sample byte budget too small; one or both bucket pools emitted N=1 anyway (budget ${args.byteBudget})`,
    );
  }

  return {
    period: args.period,
    buckets,
    perProject,
    unusedTools,
    samples: sampleResult.samples,
    warnings,
  };
}

export interface RunDetailArgs {
  vaultDir: string;
  projectsDir: string;
  sessionId: string;
}

/**
 * Full per-session dump (no period filter, no sampling). Vault bucket only — external
 * sessions surface under their JSONL filename, which is normally not what `--detail`
 * callers want; if that need ever arises we can broaden this.
 */
export async function runDetail(args: RunDetailArgs): Promise<SessionSummary> {
  const period = { startMs: 0, endMs: Number.MAX_SAFE_INTEGER, label: 'all' };
  const { discovered } = await discoverSessions({
    vaultDir: args.vaultDir,
    projectsDir: args.projectsDir,
    period,
  });
  const found = discovered.find((d) => d.meta.id === args.sessionId);
  if (!found) {
    throw new Error(`session ${args.sessionId} not found`);
  }
  return toSessionSummary(found, { vaultDir: args.vaultDir });
}
