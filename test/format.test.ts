import { describe, expect, it } from 'vitest';
import { formatJson, formatText } from '../src/format.js';
import type { AnalyticsReport, BucketStats } from '../src/types.js';

function emptyBucket(over: Partial<BucketStats> = {}): BucketStats {
  return {
    sessionsTotal: 0,
    sessionsVault: 0,
    totalToolCalls: 0,
    avgToolCallsPerSession: 0,
    topTools: [],
    topSequences: [],
    largestResultTools: [],
    stalePathErrors: [],
    currentNoteAnchors: [],
    cacheHitDistribution: { p50: 0, p90: 0, mean: 0 },
    subagentBudget: { mean: 0, p95: 0, max: 0 },
    deadEndCount: 0,
    ...over,
  };
}

const REPORT: AnalyticsReport = {
  period: { startMs: 0, endMs: 1, label: '7d' },
  buckets: {
    vault: emptyBucket({
      sessionsTotal: 3,
      sessionsVault: 3,
      totalToolCalls: 7,
      avgToolCallsPerSession: 7 / 3,
      topTools: [{ key: 'mcp__neuro-vault__search_notes', count: 6 }],
    }),
    projects: emptyBucket({
      sessionsTotal: 2,
      sessionsVault: 2,
      totalToolCalls: 5,
      avgToolCallsPerSession: 2.5,
      topTools: [{ key: 'mcp__neuro-vault__edit_note', count: 4 }],
    }),
    total: emptyBucket({
      sessionsTotal: 5,
      sessionsVault: 5,
      totalToolCalls: 12,
      avgToolCallsPerSession: 12 / 5,
      topTools: [{ key: 'mcp__neuro-vault__search_notes', count: 6 }],
    }),
  },
  perProject: [
    {
      project: '-Users-x-git-catalog-ui',
      decodedPath: '/Users/x/git/catalog/ui',
      sessionsTotal: 2,
      sessionsVault: 2,
      topTools: [{ key: 'mcp__neuro-vault__edit_note', count: 4 }],
      uniqueTools: ['mcp__neuro-vault__edit_note'],
    },
  ],
  unusedTools: ['mcp__neuro-vault__find_duplicates'],
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
  it('renders all three bucket lines with their counts', () => {
    const out = formatText(REPORT);
    expect(out).toMatch(/7d/);
    expect(out).toMatch(/vault\s+sessions=3/);
    expect(out).toMatch(/projects\s+sessions=2/);
    expect(out).toMatch(/total\s+sessions=5/);
  });

  it('renders the per-project breakdown and unique tools', () => {
    const out = formatText(REPORT);
    expect(out).toMatch(/-Users-x-git-catalog-ui/);
    expect(out).toMatch(/unique:.*edit_note/);
  });

  it('renders unused tools below the buckets', () => {
    const out = formatText(REPORT);
    expect(out).toMatch(/Unused tools.*find_duplicates/);
  });

  it('forwards warnings verbatim', () => {
    expect(formatText(REPORT)).toMatch(/one warning/);
  });
});
