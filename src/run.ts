// src/run.ts
import { aggregate } from './aggregate.js';
import { discoverSessions } from './discover.js';
import { toSessionSummary } from './extract.js';
import { isVaultRelevant } from './filter.js';
import type { Period } from './period.js';
import { sampleSessionsWithMeta } from './sample.js';
import type { AnalyticsReport, SessionSummary } from './types.js';

export interface RunArgs {
  vaultDir: string;
  projectsDir: string;
  period: Period;
  byteBudget: number;
}

export async function run(args: RunArgs): Promise<AnalyticsReport> {
  const { discovered, warnings } = await discoverSessions({
    vaultDir: args.vaultDir,
    projectsDir: args.projectsDir,
    period: args.period,
  });

  const vaultDiscovered = discovered.filter(isVaultRelevant);
  const summaries = vaultDiscovered.map((d) => toSessionSummary(d, { vaultDir: args.vaultDir }));

  const totalToolCalls = summaries.reduce((sum, s) => sum + s.toolCalls.length, 0);
  const aggregates = aggregate(summaries);
  const sampleResult = sampleSessionsWithMeta(summaries, { byteBudget: args.byteBudget });

  const allWarnings = [...warnings];
  if (sampleResult.budgetUnderflow) {
    allWarnings.push(
      `sample byte budget too small; emitted N=1 anyway (cost > ${args.byteBudget})`,
    );
  }

  return {
    period: args.period,
    stats: {
      sessionsTotal: discovered.length,
      sessionsVault: summaries.length,
      totalToolCalls,
      avgToolCallsPerSession: summaries.length === 0 ? 0 : totalToolCalls / summaries.length,
    },
    aggregates,
    samples: sampleResult.samples,
    warnings: allWarnings,
  };
}

export interface RunDetailArgs {
  vaultDir: string;
  projectsDir: string;
  sessionId: string;
}

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
