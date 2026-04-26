import fs from 'node:fs/promises';
import path from 'node:path';
import type { ClaudianMeta } from './types.js';
import { encodeVaultPath } from './config.js';
import type { Period } from './period.js';

export interface DiscoveredSubagent {
  agentId: string;
  jsonl: string;
}

export interface Discovered {
  meta: ClaudianMeta;
  mainLog: string;
  subagentLogs: DiscoveredSubagent[];
}

export interface DiscoverArgs {
  vaultDir: string;
  /** Root of the SDK projects store, normally `~/.claude/projects`. */
  projectsDir: string;
  period: Period;
}

export interface DiscoverResult {
  discovered: Discovered[];
  warnings: string[];
}

async function readFileOrEmpty(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

async function listSubagents(dir: string): Promise<DiscoveredSubagent[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  const out: DiscoveredSubagent[] = [];
  for (const entry of entries) {
    const match = /^agent-(.+)\.jsonl$/.exec(entry);
    if (!match) continue;
    const jsonl = await fs.readFile(path.join(dir, entry), 'utf8');
    out.push({ agentId: match[1]!, jsonl });
  }
  return out;
}

export async function discoverSessions(args: DiscoverArgs): Promise<DiscoverResult> {
  const sessionsDir = path.join(args.vaultDir, '.claude', 'sessions');
  let metaFiles: string[];
  try {
    metaFiles = (await fs.readdir(sessionsDir)).filter((f) => f.endsWith('.meta.json')).sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { discovered: [], warnings: [`No sessions directory at ${sessionsDir}`] };
    }
    throw err;
  }

  const encodedRoot = encodeVaultPath(path.resolve(args.vaultDir));
  const projectsRoot = path.join(args.projectsDir, encodedRoot);

  const discovered: Discovered[] = [];
  const warnings: string[] = [];

  for (const file of metaFiles) {
    const fullPath = path.join(sessionsDir, file);
    let meta: ClaudianMeta;
    try {
      meta = JSON.parse(await fs.readFile(fullPath, 'utf8')) as ClaudianMeta;
    } catch (err) {
      warnings.push(`Failed to parse ${file}: ${(err as Error).message}`);
      continue;
    }
    if (meta.createdAt < args.period.startMs || meta.createdAt > args.period.endMs) continue;

    const mainPath = path.join(projectsRoot, `${meta.sessionId}.jsonl`);
    const main = await readFileOrEmpty(mainPath);
    let mainLog = '';
    if (main === null) {
      warnings.push(`Missing SDK log for ${meta.sessionId} (expected at ${mainPath})`);
    } else {
      mainLog = main;
    }

    const subagentLogs = await listSubagents(path.join(projectsRoot, meta.sessionId, 'subagents'));

    discovered.push({ meta, mainLog, subagentLogs });
  }

  return { discovered, warnings };
}
