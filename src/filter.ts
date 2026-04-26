import type { Discovered } from './discover.js';

const NEURO_VAULT_PREFIX = 'mcp__neuro-vault-mcp__';
const WIKI_LINK = /\[\[[^\]]+\]\]/;
const TOOL_NAME = /"type":"tool_use"[^}]*"name":"([^"]+)"/g;
const USER_TEXT = /"type":"user"[\s\S]*?"text":"([^"]+)"/g;

function logHasNeuroVaultTool(jsonl: string): boolean {
  TOOL_NAME.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOOL_NAME.exec(jsonl))) {
    if (match[1]!.startsWith(NEURO_VAULT_PREFIX)) return true;
  }
  return false;
}

function logHasWikiLink(jsonl: string): boolean {
  USER_TEXT.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = USER_TEXT.exec(jsonl))) {
    if (WIKI_LINK.test(match[1]!)) return true;
  }
  return false;
}

export function isVaultRelevant(d: Discovered): boolean {
  if (d.meta.currentNote && d.meta.currentNote.trim().length > 0) return true;
  if (logHasNeuroVaultTool(d.mainLog)) return true;
  if (d.subagentLogs.some((s) => logHasNeuroVaultTool(s.jsonl))) return true;
  if (logHasWikiLink(d.mainLog)) return true;
  return false;
}
