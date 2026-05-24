import { decodeProjectPath } from './config.js';
import type { AggregateBucket, ProjectBreakdown, SessionSummary } from './types.js';

/** Synthetic marker used in the unique-tools computation to represent the vault project. */
const VAULT_MARKER = '__vault__';

export interface ExternalSession {
  project: string;
  summary: SessionSummary;
}

function topNTools(sessions: SessionSummary[], n: number): AggregateBucket[] {
  const counts = new Map<string, number>();
  for (const s of sessions) {
    for (const c of s.toolCalls) {
      counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, n);
}

/**
 * Build per-project breakdown for all external projects with at least one session.
 * `uniqueTools` is computed relative to the union of the vault and all other
 * projects — a tool used in this project AND anywhere else is not unique.
 */
export function buildPerProject(
  vault: SessionSummary[],
  external: ExternalSession[],
): ProjectBreakdown[] {
  // Bucket external sessions by project.
  const byProject = new Map<string, SessionSummary[]>();
  for (const e of external) {
    const list = byProject.get(e.project);
    if (list) list.push(e.summary);
    else byProject.set(e.project, [e.summary]);
  }

  // For each tool name, which projects called it (vault marker counts as one).
  const toolToProjects = new Map<string, Set<string>>();
  const addToolUses = (sessions: SessionSummary[], marker: string): void => {
    for (const s of sessions) {
      for (const c of s.toolCalls) {
        let set = toolToProjects.get(c.name);
        if (!set) {
          set = new Set();
          toolToProjects.set(c.name, set);
        }
        set.add(marker);
      }
    }
  };
  addToolUses(vault, VAULT_MARKER);
  for (const [project, sessions] of byProject) addToolUses(sessions, project);

  const out: ProjectBreakdown[] = [];
  for (const [project, sessions] of byProject) {
    const uniqueTools: string[] = [];
    for (const [tool, projects] of toolToProjects) {
      if (projects.size === 1 && projects.has(project)) uniqueTools.push(tool);
    }
    uniqueTools.sort();

    out.push({
      project,
      decodedPath: decodeProjectPath(project),
      sessionsTotal: sessions.length,
      sessionsVault: sessions.length,
      topTools: topNTools(sessions, 5),
      uniqueTools,
    });
  }

  out.sort((a, b) => b.sessionsVault - a.sessionsVault || a.project.localeCompare(b.project));
  return out;
}
