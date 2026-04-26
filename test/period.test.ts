import { describe, expect, it } from 'vitest';
import { parsePeriod } from '../src/period.js';

describe('parsePeriod', () => {
  it('parses 7d into a 7-day window ending at the supplied now', () => {
    const now = 1_700_000_000_000;
    const result = parsePeriod('7d', now);
    expect(result.endMs).toBe(now);
    expect(result.startMs).toBe(now - 7 * 24 * 60 * 60 * 1000);
    expect(result.label).toBe('7d');
  });

  it('parses weeks', () => {
    const now = 1_700_000_000_000;
    const result = parsePeriod('2w', now);
    expect(result.startMs).toBe(now - 14 * 24 * 60 * 60 * 1000);
  });

  it('throws on unknown unit', () => {
    expect(() => parsePeriod('5y', 0)).toThrow(/Unsupported period/);
  });

  it('throws on garbage', () => {
    expect(() => parsePeriod('seven days', 0)).toThrow(/Unsupported period/);
  });
});
