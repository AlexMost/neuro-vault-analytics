import type { AnalyticsReport } from './types.js';

export function formatJson(report: AnalyticsReport): string {
  return JSON.stringify(report, null, 2);
}

export function formatText(report: AnalyticsReport): string {
  const lines: string[] = [];
  lines.push(`Usage analytics — period ${report.period.label}`);
  lines.push(`Sessions: ${report.stats.sessionsVault} / ${report.stats.sessionsTotal} touch vault`);
  lines.push(
    `Tool calls: ${report.stats.totalToolCalls} (avg ${report.stats.avgToolCallsPerSession.toFixed(1)} / session)`,
  );
  if (report.aggregates.topTools.length > 0) {
    const top = report.aggregates.topTools
      .map((t) => `${t.key.replace('mcp__neuro-vault-mcp__', '')} (${t.count})`)
      .join(', ');
    lines.push(`Top tools: ${top}`);
  }
  if (report.aggregates.unusedTools.length > 0) {
    lines.push(
      `Unused tools: ${report.aggregates.unusedTools.map((t) => t.replace('mcp__neuro-vault-mcp__', '')).join(', ')}`,
    );
  }
  if (report.aggregates.stalePathErrors.length > 0) {
    lines.push(`Stale-path errors: ${report.aggregates.stalePathErrors.length} session(s)`);
  }
  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  return lines.join('\n') + '\n';
}
