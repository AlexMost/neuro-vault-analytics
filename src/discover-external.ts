import fs from 'node:fs/promises';
import path from 'node:path';
import { logHasNeuroVaultTool } from './filter.js';
import { listSubagents, type DiscoveredSubagent } from './discover.js';
import type { Period } from './period.js';

export interface DiscoveredExternal {
  /** sessionId derived from JSONL filename stem. */
  sessionId: string;
  /** Encoded project dir name (e.g. `-Users-x-git-catalog-ui`). */
  project: string;
  /** Filesystem mtime of the JSONL in ms — fallback when JSONL timestamps are missing. */
  mtimeMs: number;
  mainLog: string;
  subagentLogs: DiscoveredSubagent[];
}

export interface DiscoverExternalArgs {
  projectsDir: string;
  /** Encoded vault dir name. The vault project is skipped — it is owned by `discoverSessions`. */
  vaultProject: string;
  period: Period;
}

export interface DiscoverExternalResult {
  discovered: DiscoveredExternal[];
  warnings: string[];
}

function firstLineTimestampMs(jsonl: string): number | null {
  for (const raw of jsonl.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line) as { timestamp?: string };
      if (typeof obj.timestamp === 'string') {
        const ms = Date.parse(obj.timestamp);
        return Number.isFinite(ms) ? ms : null;
      }
    } catch {
      // Try the next line.
    }
    return null;
  }
  return null;
}

async function listJsonlFiles(dir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }
  return entries.filter((e) => e.endsWith('.jsonl'));
}

export async function discoverExternalSessions(
  args: DiscoverExternalArgs,
): Promise<DiscoverExternalResult> {
  let entries: string[];
  try {
    entries = await fs.readdir(args.projectsDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        discovered: [],
        warnings: [`No projects directory at ${args.projectsDir}`],
      };
    }
    throw err;
  }

  const discovered: DiscoveredExternal[] = [];
  const warnings: string[] = [];

  for (const project of entries) {
    if (project === args.vaultProject) continue;
    const projectPath = path.join(args.projectsDir, project);
    let stat;
    try {
      stat = await fs.stat(projectPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const jsonlFiles = await listJsonlFiles(projectPath);
    for (const file of jsonlFiles) {
      const sessionId = file.slice(0, -'.jsonl'.length);
      const jsonlPath = path.join(projectPath, file);

      let fileStat;
      try {
        fileStat = await fs.stat(jsonlPath);
      } catch {
        continue;
      }
      const mtimeMs = fileStat.mtimeMs;
      // Coarse mtime filter: a file untouched in the period can't host an in-period session.
      if (mtimeMs < args.period.startMs) continue;

      const mainLog = await fs.readFile(jsonlPath, 'utf8');
      const subagentLogs = await listSubagents(path.join(projectPath, sessionId, 'subagents'));

      if (
        !logHasNeuroVaultTool(mainLog) &&
        !subagentLogs.some((s) => logHasNeuroVaultTool(s.jsonl))
      ) {
        continue;
      }

      // Refine: drop sessions whose first-line timestamp is outside the period.
      const firstTs = firstLineTimestampMs(mainLog);
      const createdAt = firstTs ?? mtimeMs;
      if (createdAt < args.period.startMs || createdAt > args.period.endMs) continue;

      discovered.push({
        sessionId,
        project,
        mtimeMs,
        mainLog,
        subagentLogs,
      });
    }
  }

  return { discovered, warnings };
}
