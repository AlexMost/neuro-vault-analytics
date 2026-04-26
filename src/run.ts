// src/run.ts
import { aggregate } from './aggregate.js';
import { discoverSessions } from './discover.js';
import { toSessionSummary } from './extract.js';
import { isVaultRelevant } from './filter.js';
import type { Period } from './period.js';
import { sampleSessions } from './sample.js';
import type { AnalyticsReport } from './types.js';

export interface RunArgs {
  vaultDir: string;
  projectsDir: string;
  period: Period;
  sampleSize: number;
}

export async function run(args: RunArgs): Promise<AnalyticsReport> {
  const { discovered, warnings } = await discoverSessions({
    vaultDir: args.vaultDir,
    projectsDir: args.projectsDir,
    period: args.period,
  });

  const vaultDiscovered = discovered.filter(isVaultRelevant);
  const summaries = vaultDiscovered.map((d) => toSessionSummary(d));

  const totalToolCalls = summaries.reduce((sum, s) => sum + s.toolCalls.length, 0);
  const aggregates = aggregate(summaries);
  const samples = sampleSessions(summaries, args.sampleSize);

  return {
    period: args.period,
    stats: {
      sessionsTotal: discovered.length,
      sessionsVault: summaries.length,
      totalToolCalls,
      avgToolCallsPerSession: summaries.length === 0 ? 0 : totalToolCalls / summaries.length,
    },
    aggregates,
    samples,
    warnings,
  };
}
