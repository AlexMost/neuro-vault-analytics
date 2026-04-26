import { describe, expect, it } from 'vitest';
import { formatJson, formatText } from '../src/format.js';
import type { AnalyticsReport } from '../src/types.js';

const REPORT: AnalyticsReport = {
  period: { startMs: 0, endMs: 1, label: '7d' },
  stats: { sessionsTotal: 5, sessionsVault: 3, totalToolCalls: 12, avgToolCallsPerSession: 4 },
  aggregates: {
    topTools: [{ key: 'mcp__neuro-vault-mcp__search_notes', count: 6 }],
    unusedTools: ['mcp__neuro-vault-mcp__find_duplicates'],
    topSequences: [],
    largestResultTools: [],
    stalePathErrors: [],
    currentNoteAnchors: [],
    cacheHitDistribution: { p50: 0.5, p90: 0.9, mean: 0.6 },
    subagentBudget: { mean: 0, p95: 0, max: 0 },
    deadEndCount: 0,
  },
  samples: [],
  warnings: ['one warning'],
};

describe('formatJson', () => {
  it('produces parseable JSON that round-trips', () => {
    expect(JSON.parse(formatJson(REPORT))).toEqual(REPORT);
  });

  it('ends with a newline', () => {
    expect(formatJson(REPORT)).toMatch(/\n$/);
  });
});

describe('formatText', () => {
  it('mentions the period label and counts', () => {
    const out = formatText(REPORT);
    expect(out).toMatch(/7d/);
    expect(out).toMatch(/3 \/ 5/);
    expect(out).toMatch(/search_notes/);
  });
});
