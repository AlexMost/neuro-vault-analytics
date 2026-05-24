import type { AnalyticsReport, BucketStats } from './types.js';

export function formatJson(report: AnalyticsReport): string {
  return JSON.stringify(report) + '\n';
}

function shortToolName(name: string): string {
  return name.replace('mcp__neuro-vault__', '');
}

function bucketLine(label: string, b: BucketStats): string {
  const top = b.topTools
    .slice(0, 3)
    .map((t) => `${shortToolName(t.key)} (${t.count})`)
    .join(', ');
  const avg = b.avgToolCallsPerSession.toFixed(1);
  const tail = top ? `  top: ${top}` : '';
  return `${label.padEnd(8)} sessions=${b.sessionsTotal}  tool_calls=${b.totalToolCalls}  avg=${avg}${tail}`;
}

export function formatText(report: AnalyticsReport): string {
  const lines: string[] = [];
  lines.push(`Usage analytics — period ${report.period.label}`);
  lines.push(bucketLine('vault', report.buckets.vault));
  lines.push(bucketLine('projects', report.buckets.projects));
  lines.push(bucketLine('total', report.buckets.total));

  if (report.perProject.length > 0) {
    lines.push('');
    lines.push('Per-project breakdown:');
    for (const p of report.perProject) {
      const top = p.topTools.map((t) => `${shortToolName(t.key)} (${t.count})`).join(', ');
      const uniq = p.uniqueTools.length
        ? `  unique: ${p.uniqueTools.map(shortToolName).join(', ')}`
        : '';
      lines.push(`  ${p.project}  sessions=${p.sessionsTotal}  ${top}${uniq}`);
    }
  }

  if (report.unusedTools.length > 0) {
    lines.push('');
    lines.push(`Unused tools (catalog): ${report.unusedTools.map(shortToolName).join(', ')}`);
  }

  const stale = report.buckets.total.stalePathErrors.length;
  if (stale > 0) {
    lines.push(`Stale-path errors: ${stale} session(s)`);
  }

  if (report.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  return lines.join('\n') + '\n';
}
