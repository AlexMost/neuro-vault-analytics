import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { encodeVaultPath, resolveVault } from '../src/config.js';

const FIXTURE = path.resolve(import.meta.dirname, 'fixtures/vault-empty');

describe('resolveVault', () => {
  it('returns the explicit --vault path when it has .obsidian/', () => {
    expect(resolveVault({ explicit: FIXTURE, cwd: '/nope' })).toBe(FIXTURE);
  });

  it('walks up from cwd to find .obsidian/', () => {
    const inner = path.join(FIXTURE, 'sub', 'deep');
    expect(resolveVault({ explicit: undefined, cwd: inner })).toBe(FIXTURE);
  });

  it('throws when no vault is found', () => {
    expect(() => resolveVault({ explicit: undefined, cwd: '/' })).toThrow(/vault/i);
  });

  it('throws when explicit path is missing .obsidian/', () => {
    expect(() => resolveVault({ explicit: '/tmp', cwd: '/tmp' })).toThrow(/\.obsidian/);
  });
});

describe('encodeVaultPath', () => {
  it('replaces every / with -', () => {
    expect(encodeVaultPath('/Users/me/Obsidian')).toBe('-Users-me-Obsidian');
  });
});
