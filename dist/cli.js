#!/usr/bin/env node

// src/cli.ts
import os from "os";
import path5 from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// src/config.ts
import fs from "fs";
import path from "path";
function resolveVault(args) {
  if (args.explicit !== void 0) {
    const abs = path.resolve(args.explicit);
    if (!fs.existsSync(path.join(abs, ".obsidian"))) {
      throw new Error(`No .obsidian/ directory at ${abs}`);
    }
    return abs;
  }
  let dir = path.resolve(args.cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, ".obsidian"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Could not locate Obsidian vault: pass --vault or run from inside a vault");
    }
    dir = parent;
  }
}
function encodeVaultPath(absVaultPath) {
  return absVaultPath.replace(/\//g, "-");
}
function decodeProjectPath(encoded) {
  return encoded.replace(/-/g, "/");
}

// src/format.ts
function formatJson(report) {
  return JSON.stringify(report) + "\n";
}
function shortToolName(name) {
  return name.replace("mcp__neuro-vault__", "");
}
function bucketLine(label, b) {
  const top = b.topTools.slice(0, 3).map((t) => `${shortToolName(t.key)} (${t.count})`).join(", ");
  const avg = b.avgToolCallsPerSession.toFixed(1);
  const tail = top ? `  top: ${top}` : "";
  return `${label.padEnd(8)} sessions=${b.sessionsTotal}  tool_calls=${b.totalToolCalls}  avg=${avg}${tail}`;
}
function formatText(report) {
  const lines = [];
  lines.push(`Usage analytics \u2014 period ${report.period.label}`);
  lines.push(bucketLine("vault", report.buckets.vault));
  lines.push(bucketLine("projects", report.buckets.projects));
  lines.push(bucketLine("total", report.buckets.total));
  if (report.perProject.length > 0) {
    lines.push("");
    lines.push("Per-project breakdown:");
    for (const p of report.perProject) {
      const top = p.topTools.map((t) => `${shortToolName(t.key)} (${t.count})`).join(", ");
      const uniq = p.uniqueTools.length ? `  unique: ${p.uniqueTools.map(shortToolName).join(", ")}` : "";
      lines.push(`  ${p.project}  sessions=${p.sessionsTotal}  ${top}${uniq}`);
    }
  }
  if (report.unusedTools.length > 0) {
    lines.push("");
    lines.push(`Unused tools (catalog): ${report.unusedTools.map(shortToolName).join(", ")}`);
  }
  const stale = report.buckets.total.stalePathErrors.length;
  if (stale > 0) {
    lines.push(`Stale-path errors: ${stale} session(s)`);
  }
  if (report.warnings.length > 0) {
    lines.push("");
    lines.push("Warnings:");
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n") + "\n";
}

// src/period.ts
var UNIT_MS = {
  d: 24 * 60 * 60 * 1e3,
  w: 7 * 24 * 60 * 60 * 1e3
};
function parsePeriod(input, nowMs) {
  const match = /^(\d+)([dw])$/.exec(input.trim());
  if (!match) {
    throw new Error(`Unsupported period: '${input}'. Expected '<N>d' or '<N>w'.`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const span = amount * UNIT_MS[unit];
  return { startMs: nowMs - span, endMs: nowMs, label: input };
}

// src/run.ts
import path4 from "path";

// src/types.ts
var KNOWN_NEURO_VAULT_TOOLS = [
  "mcp__neuro-vault__create_note",
  "mcp__neuro-vault__edit_note",
  "mcp__neuro-vault__find_duplicates",
  "mcp__neuro-vault__get_note_links",
  "mcp__neuro-vault__get_similar_notes",
  "mcp__neuro-vault__get_stats",
  "mcp__neuro-vault__get_vault_overview",
  "mcp__neuro-vault__list_properties",
  "mcp__neuro-vault__list_tags",
  "mcp__neuro-vault__query_notes",
  "mcp__neuro-vault__read_daily",
  "mcp__neuro-vault__read_notes",
  "mcp__neuro-vault__read_property",
  "mcp__neuro-vault__remove_property",
  "mcp__neuro-vault__search_notes",
  "mcp__neuro-vault__set_property"
];

// src/aggregate.ts
var SEARCH = "mcp__neuro-vault__search_notes";
var READ_NOTES = "mcp__neuro-vault__read_notes";
function topByCount(map, n) {
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, n);
}
function extractPath(argsSummary) {
  const arr = /"paths":\["([^"]+)"/.exec(argsSummary);
  if (arr) return arr[1];
  const str = /"paths":"([^"]+)"/.exec(argsSummary);
  if (str) return str[1];
  const legacy = /"path":"([^"]+)"/.exec(argsSummary);
  return legacy ? legacy[1] : null;
}
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p / 100 * (sorted.length - 1)));
  return sorted[idx];
}
function sequencesIn(summary, n) {
  const names = summary.toolCalls.map((c) => c.name);
  const out = [];
  for (let i = 0; i + n <= names.length; i++) {
    out.push(names.slice(i, i + n));
  }
  return out;
}
function aggregate(sessions) {
  const toolCounts = /* @__PURE__ */ new Map();
  const resultSizeAcc = /* @__PURE__ */ new Map();
  const seqCounts = /* @__PURE__ */ new Map();
  const noteCounts = /* @__PURE__ */ new Map();
  const stalePathErrors = [];
  const cacheHits = [];
  const subagentBudgets = [];
  let deadEndCount = 0;
  let totalToolCalls = 0;
  for (const s of sessions) {
    if (s.outcome === "dead_end") deadEndCount++;
    cacheHits.push(s.cacheHitRatio);
    subagentBudgets.push(...s.subagent.toolCallsPerAgent);
    if (s.currentNote) noteCounts.set(s.currentNote, (noteCounts.get(s.currentNote) ?? 0) + 1);
    totalToolCalls += s.toolCalls.length;
    for (const call of s.toolCalls) {
      toolCounts.set(call.name, (toolCounts.get(call.name) ?? 0) + 1);
      if (call.resultSize !== null) {
        const acc = resultSizeAcc.get(call.name) ?? { sum: 0, n: 0 };
        acc.sum += call.resultSize;
        acc.n += 1;
        resultSizeAcc.set(call.name, acc);
      }
    }
    for (const n of [2, 3]) {
      for (const seq of sequencesIn(s, n)) {
        const key = seq.join(">");
        const bucket = seqCounts.get(key) ?? { sequence: seq, count: 0, sessionIds: /* @__PURE__ */ new Set() };
        bucket.count++;
        bucket.sessionIds.add(s.id);
        seqCounts.set(key, bucket);
      }
    }
    for (let i = 0; i + 1 < s.toolCalls.length; i++) {
      const a = s.toolCalls[i];
      const b = s.toolCalls[i + 1];
      if (a.name === SEARCH && b.name === READ_NOTES && b.status === "error") {
        stalePathErrors.push({
          sessionId: s.id,
          searchToolCallTs: a.ts,
          readToolCallTs: b.ts,
          failedPath: extractPath(b.argsSummary)
        });
      }
    }
  }
  const sortedCacheHits = [...cacheHits].sort((a, b) => a - b);
  const sortedBudgets = [...subagentBudgets].sort((a, b) => a - b);
  const largestResultTools = [...resultSizeAcc.entries()].map(([key, { sum, n }]) => ({ key, avgSizeBytes: Math.round(sum / n) })).sort((a, b) => b.avgSizeBytes - a.avgSizeBytes).slice(0, 10);
  const topSequences = [...seqCounts.values()].sort((a, b) => b.count - a.count || a.sequence.join(">").localeCompare(b.sequence.join(">"))).slice(0, 10).map(({ sequence, count, sessionIds }) => ({ sequence, count, sessionIds: [...sessionIds] }));
  return {
    sessionsTotal: sessions.length,
    sessionsVault: sessions.length,
    totalToolCalls,
    avgToolCallsPerSession: sessions.length === 0 ? 0 : totalToolCalls / sessions.length,
    topTools: topByCount(toolCounts, 10),
    topSequences,
    largestResultTools,
    stalePathErrors,
    currentNoteAnchors: topByCount(noteCounts, 20),
    cacheHitDistribution: {
      p50: percentile(sortedCacheHits, 50),
      p90: percentile(sortedCacheHits, 90),
      mean: cacheHits.length ? cacheHits.reduce((a, b) => a + b, 0) / cacheHits.length : 0
    },
    subagentBudget: {
      mean: subagentBudgets.length ? subagentBudgets.reduce((a, b) => a + b, 0) / subagentBudgets.length : 0,
      p95: percentile(sortedBudgets, 95),
      max: subagentBudgets.length ? Math.max(...subagentBudgets) : 0
    },
    deadEndCount
  };
}
function computeUnusedTools(sessions) {
  const seen = /* @__PURE__ */ new Set();
  for (const s of sessions) {
    for (const c of s.toolCalls) seen.add(c.name);
  }
  return KNOWN_NEURO_VAULT_TOOLS.filter((t) => !seen.has(t));
}

// src/discover.ts
import fs2 from "fs/promises";
import path2 from "path";
async function readFileOrEmpty(filePath) {
  try {
    return await fs2.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}
async function listSubagents(dir) {
  let entries;
  try {
    entries = await fs2.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    const match = /^agent-(.+)\.jsonl$/.exec(entry);
    if (!match) continue;
    const jsonl = await fs2.readFile(path2.join(dir, entry), "utf8");
    out.push({ agentId: match[1], jsonl });
  }
  return out;
}
async function discoverSessions(args) {
  const sessionsDir = path2.join(args.vaultDir, ".claude", "sessions");
  let metaFiles;
  try {
    metaFiles = (await fs2.readdir(sessionsDir)).filter((f) => f.endsWith(".meta.json")).sort();
  } catch (err) {
    if (err.code === "ENOENT") {
      return { discovered: [], warnings: [`No sessions directory at ${sessionsDir}`] };
    }
    throw err;
  }
  const encodedRoot = encodeVaultPath(path2.resolve(args.vaultDir));
  const projectsRoot = path2.join(args.projectsDir, encodedRoot);
  const discovered = [];
  const warnings = [];
  for (const file of metaFiles) {
    const fullPath = path2.join(sessionsDir, file);
    let meta;
    try {
      meta = JSON.parse(await fs2.readFile(fullPath, "utf8"));
    } catch (err) {
      warnings.push(`Failed to parse ${file}: ${err.message}`);
      continue;
    }
    if (meta.createdAt < args.period.startMs || meta.createdAt > args.period.endMs) continue;
    const mainPath = path2.join(projectsRoot, `${meta.sessionId}.jsonl`);
    const main2 = await readFileOrEmpty(mainPath);
    let mainLog = "";
    if (main2 === null) {
      warnings.push(`Missing SDK log for ${meta.sessionId} (expected at ${mainPath})`);
    } else {
      mainLog = main2;
    }
    const subagentLogs = await listSubagents(path2.join(projectsRoot, meta.sessionId, "subagents"));
    discovered.push({ meta, mainLog, subagentLogs });
  }
  return { discovered, warnings };
}

// src/discover-external.ts
import fs3 from "fs/promises";
import path3 from "path";

// src/filter.ts
var NEURO_VAULT_PREFIX = "mcp__neuro-vault__";
var WIKI_LINK = /\[\[[^\]]+\]\]/;
var TOOL_NAME = /"type":"tool_use"[^}]*"name":"([^"]+)"/g;
var USER_TEXT = /"type":"user"[\s\S]*?"text":"([^"]+)"/g;
function logHasNeuroVaultTool(jsonl) {
  TOOL_NAME.lastIndex = 0;
  let match;
  while (match = TOOL_NAME.exec(jsonl)) {
    if (match[1].startsWith(NEURO_VAULT_PREFIX)) return true;
  }
  return false;
}
function logHasWikiLink(jsonl) {
  USER_TEXT.lastIndex = 0;
  let match;
  while (match = USER_TEXT.exec(jsonl)) {
    if (WIKI_LINK.test(match[1])) return true;
  }
  return false;
}
function isVaultRelevant(d) {
  if (d.meta.currentNote && d.meta.currentNote.trim().length > 0) return true;
  if (logHasNeuroVaultTool(d.mainLog)) return true;
  if (d.subagentLogs.some((s) => logHasNeuroVaultTool(s.jsonl))) return true;
  if (logHasWikiLink(d.mainLog)) return true;
  return false;
}

// src/discover-external.ts
function firstLineTimestampMs(jsonl) {
  for (const raw of jsonl.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const obj = JSON.parse(line);
      if (typeof obj.timestamp === "string") {
        const ms = Date.parse(obj.timestamp);
        return Number.isFinite(ms) ? ms : null;
      }
    } catch {
    }
    return null;
  }
  return null;
}
async function listJsonlFiles(dir) {
  let entries;
  try {
    entries = await fs3.readdir(dir);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return entries.filter((e) => e.endsWith(".jsonl"));
}
async function discoverExternalSessions(args) {
  let entries;
  try {
    entries = await fs3.readdir(args.projectsDir);
  } catch (err) {
    if (err.code === "ENOENT") {
      return {
        discovered: [],
        warnings: [`No projects directory at ${args.projectsDir}`]
      };
    }
    throw err;
  }
  const discovered = [];
  const warnings = [];
  for (const project of entries) {
    if (project === args.vaultProject) continue;
    const projectPath = path3.join(args.projectsDir, project);
    let stat;
    try {
      stat = await fs3.stat(projectPath);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;
    const jsonlFiles = await listJsonlFiles(projectPath);
    for (const file of jsonlFiles) {
      const sessionId = file.slice(0, -".jsonl".length);
      const jsonlPath = path3.join(projectPath, file);
      let fileStat;
      try {
        fileStat = await fs3.stat(jsonlPath);
      } catch {
        continue;
      }
      const mtimeMs = fileStat.mtimeMs;
      if (mtimeMs < args.period.startMs) continue;
      const mainLog = await fs3.readFile(jsonlPath, "utf8");
      const subagentLogs = await listSubagents(path3.join(projectPath, sessionId, "subagents"));
      if (!logHasNeuroVaultTool(mainLog) && !subagentLogs.some((s) => logHasNeuroVaultTool(s.jsonl))) {
        continue;
      }
      const firstTs = firstLineTimestampMs(mainLog);
      const createdAt = firstTs ?? mtimeMs;
      if (createdAt < args.period.startMs || createdAt > args.period.endMs) continue;
      discovered.push({
        sessionId,
        project,
        mtimeMs,
        mainLog,
        subagentLogs
      });
    }
  }
  return { discovered, warnings };
}

// src/parse-jsonl.ts
var ARGS_CAP = 200;
function summarizeArgs(input, vaultDir) {
  let s;
  try {
    s = typeof input === "string" ? input : JSON.stringify(input);
  } catch {
    s = String(input);
  }
  s = s.replace(/\s+/g, " ").trim();
  if (vaultDir && vaultDir.length > 0) {
    s = s.split(`${vaultDir}/`).join("vault:");
  }
  return s.length > ARGS_CAP ? s.slice(0, ARGS_CAP - 1) + "\u2026" : s;
}
function sizeOf(content) {
  if (typeof content === "string") return Buffer.byteLength(content, "utf8");
  try {
    return Buffer.byteLength(JSON.stringify(content) ?? "", "utf8");
  } catch {
    return 0;
  }
}
function extractToolCalls(jsonl, source, vaultDir) {
  const calls = /* @__PURE__ */ new Map();
  const results = /* @__PURE__ */ new Map();
  for (const raw of jsonl.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const blocks = obj.message?.content;
    if (!Array.isArray(blocks)) continue;
    const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;
    if (obj.type === "assistant") {
      for (const block of blocks) {
        if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
          calls.set(block.id, {
            name: block.name,
            argsSummary: summarizeArgs(block.input, vaultDir),
            ts: Number.isFinite(ts) ? ts : 0,
            source
          });
        }
      }
    } else if (obj.type === "user") {
      for (const block of blocks) {
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          results.set(block.tool_use_id, {
            resultSize: sizeOf(block.content),
            isError: block.is_error === true
          });
        }
      }
    }
  }
  const out = [];
  for (const [id, call] of calls) {
    const result = results.get(id);
    out.push({
      name: call.name,
      argsSummary: call.argsSummary,
      resultSize: result ? result.resultSize : null,
      status: result?.isError ? "error" : "ok",
      source: call.source,
      ts: call.ts
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// src/extract.ts
function cacheHitRatio(usage) {
  const denom = usage.cacheReadInputTokens + usage.cacheCreationInputTokens + usage.inputTokens;
  return denom === 0 ? 0 : usage.cacheReadInputTokens / denom;
}
function subagentStats(perAgent) {
  const toolCallsPerAgent = perAgent.map((calls) => calls.length);
  const okFinals = perAgent.filter(
    (calls) => calls.length > 0 && calls[calls.length - 1].status === "ok"
  ).length;
  const finalCallOkRate = perAgent.length === 0 ? 1 : okFinals / perAgent.length;
  return { count: perAgent.length, toolCallsPerAgent, finalCallOkRate };
}
function lastMainStatus(main2) {
  if (main2.length === 0) return "completed";
  return main2[main2.length - 1].status === "error" ? "dead_end" : "completed";
}
function toSessionSummary(d, opts = {}) {
  const main2 = extractToolCalls(d.mainLog, "main", opts.vaultDir);
  const perAgent = d.subagentLogs.map(
    (s) => extractToolCalls(s.jsonl, `subagent:${s.agentId}`, opts.vaultDir)
  );
  const all = [...main2, ...perAgent.flat()].sort((a, b) => a.ts - b.ts);
  return {
    id: d.meta.id,
    title: d.meta.title,
    createdAt: d.meta.createdAt,
    updatedAt: d.meta.updatedAt,
    durationMs: d.meta.updatedAt - d.meta.createdAt,
    model: d.meta.usage.model,
    contextPercentage: d.meta.usage.percentage,
    cacheHitRatio: cacheHitRatio(d.meta.usage),
    currentNote: d.meta.currentNote,
    toolCalls: all,
    subagent: subagentStats(perAgent),
    outcome: lastMainStatus(main2)
  };
}

// src/extract-external.ts
var TITLE_CAP = 80;
function deriveFromJsonl(jsonl, fallbackMs) {
  let title = null;
  let firstTs = null;
  let lastTs = null;
  let lastModel = null;
  let cacheRead = 0;
  let cacheCreation = 0;
  let input = 0;
  for (const raw of jsonl.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof obj.timestamp === "string") {
      const ms = Date.parse(obj.timestamp);
      if (Number.isFinite(ms)) {
        if (firstTs === null) firstTs = ms;
        lastTs = ms;
      }
    }
    if (obj.type === "user" && title === null) {
      const blocks = obj.message?.content;
      if (typeof blocks === "string") {
        title = blocks;
      } else if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === "text" && typeof block.text === "string") {
            title = block.text;
            break;
          }
        }
      }
    }
    if (obj.type === "assistant") {
      if (typeof obj.message?.model === "string") {
        lastModel = obj.message.model;
      }
      const usage = obj.message?.usage;
      if (usage) {
        cacheRead += usage.cache_read_input_tokens ?? 0;
        cacheCreation += usage.cache_creation_input_tokens ?? 0;
        input += usage.input_tokens ?? 0;
      }
    }
  }
  const denom = cacheRead + cacheCreation + input;
  const cleanedTitle = title ? title.replace(/\s+/g, " ").trim().slice(0, TITLE_CAP) || "(no title)" : "(no title)";
  return {
    title: cleanedTitle,
    createdAt: firstTs ?? fallbackMs,
    updatedAt: lastTs ?? fallbackMs,
    model: lastModel ?? "unknown",
    cacheHitRatio: denom === 0 ? 0 : cacheRead / denom
  };
}
function toSessionSummaryFromExternal(d) {
  const main2 = extractToolCalls(d.mainLog, "main");
  const perAgent = d.subagentLogs.map(
    (s) => extractToolCalls(s.jsonl, `subagent:${s.agentId}`)
  );
  const all = [...main2, ...perAgent.flat()].sort((a, b) => a.ts - b.ts);
  const derived = deriveFromJsonl(d.mainLog, d.mtimeMs);
  return {
    id: d.sessionId,
    title: derived.title,
    createdAt: derived.createdAt,
    updatedAt: derived.updatedAt,
    durationMs: Math.max(0, derived.updatedAt - derived.createdAt),
    model: derived.model,
    contextPercentage: 0,
    cacheHitRatio: derived.cacheHitRatio,
    currentNote: null,
    toolCalls: all,
    subagent: subagentStats(perAgent),
    outcome: lastMainStatus(main2)
  };
}

// src/per-project.ts
var VAULT_MARKER = "__vault__";
function topNTools(sessions, n) {
  const counts = /* @__PURE__ */ new Map();
  for (const s of sessions) {
    for (const c of s.toolCalls) {
      counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, n);
}
function buildPerProject(vault, external) {
  const byProject = /* @__PURE__ */ new Map();
  for (const e of external) {
    const list = byProject.get(e.project);
    if (list) list.push(e.summary);
    else byProject.set(e.project, [e.summary]);
  }
  const toolToProjects = /* @__PURE__ */ new Map();
  const addToolUses = (sessions, marker) => {
    for (const s of sessions) {
      for (const c of s.toolCalls) {
        let set = toolToProjects.get(c.name);
        if (!set) {
          set = /* @__PURE__ */ new Set();
          toolToProjects.set(c.name, set);
        }
        set.add(marker);
      }
    }
  };
  addToolUses(vault, VAULT_MARKER);
  for (const [project, sessions] of byProject) addToolUses(sessions, project);
  const out = [];
  for (const [project, sessions] of byProject) {
    const uniqueTools = [];
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
      uniqueTools
    });
  }
  out.sort((a, b) => b.sessionsVault - a.sessionsVault || a.project.localeCompare(b.project));
  return out;
}

// src/sample.ts
var MCP_PREFIX = "mcp__neuro-vault__";
var ANOMALY_RESULT_BYTES = 5 * 1024;
function isAnomaly(c) {
  if (c.status === "error") return true;
  if (c.resultSize !== null && c.resultSize > ANOMALY_RESULT_BYTES) return true;
  return false;
}
function topToolsOf(calls, limit) {
  const counts = /* @__PURE__ */ new Map();
  for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, limit);
}
function topNGramsOf(calls, limit) {
  const names = calls.map((c) => c.name);
  const counts = /* @__PURE__ */ new Map();
  for (const n of [2, 3]) {
    for (let i = 0; i + n <= names.length; i++) {
      const seq = names.slice(i, i + n);
      const key = seq.join(">");
      const bucket = counts.get(key) ?? { sequence: seq, count: 0 };
      bucket.count++;
      counts.set(key, bucket);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.sequence.join(">").localeCompare(b.sequence.join(">"))).slice(0, limit).map(({ sequence, count }) => ({ sequence, count, sessionIds: [] }));
}
function projectSession(s, tag) {
  const mcpCalls = s.toolCalls.filter((c) => c.name.startsWith(MCP_PREFIX));
  const anomalies = s.toolCalls.filter(isAnomaly);
  const nonMcpClean = s.toolCalls.filter(
    (c) => !c.name.startsWith(MCP_PREFIX) && !isAnomaly(c)
  );
  return {
    id: s.id,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    durationMs: s.durationMs,
    model: s.model,
    contextPercentage: s.contextPercentage,
    cacheHitRatio: s.cacheHitRatio,
    currentNote: s.currentNote,
    outcome: s.outcome,
    subagent: s.subagent,
    toolCallSummary: {
      total: s.toolCalls.length,
      mcpCalls,
      anomalies,
      nonMcpSummary: {
        total: nonMcpClean.length,
        topTools: topToolsOf(nonMcpClean, 5),
        nGrams: topNGramsOf(nonMcpClean, 3)
      }
    },
    bucket: tag.bucket,
    project: tag.project
  };
}
function hourBucket(ts) {
  const h = new Date(ts).getUTCHours();
  return Math.floor(h / 6);
}
function callBucket(calls, quartiles) {
  if (calls <= quartiles[0]) return 0;
  if (calls <= quartiles[1]) return 1;
  if (calls <= quartiles[2]) return 2;
  return 3;
}
function quartilesOf(values) {
  if (values.length === 0) return [0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.floor(p / 100 * (sorted.length - 1))];
  return [at(25), at(50), at(75)];
}
function costOf(p) {
  return Buffer.byteLength(JSON.stringify(p), "utf8");
}
function sampleSessionsWithMeta(sessions, opts, tag) {
  if (sessions.length === 0) return { samples: [], budgetUnderflow: false };
  const quartiles = quartilesOf(sessions.map((s) => s.toolCalls.length));
  const strata = /* @__PURE__ */ new Map();
  for (const s of sessions) {
    const key = `${hourBucket(s.createdAt)}-${callBucket(s.toolCalls.length, quartiles)}`;
    const list = strata.get(key);
    if (list) list.push(s);
    else strata.set(key, [s]);
  }
  const queues = [...strata.values()];
  const out = [];
  let used = 0;
  let budgetUnderflow = false;
  while (true) {
    let advanced = false;
    for (const q of queues) {
      if (q.length === 0) continue;
      const projected = projectSession(q.shift(), tag);
      const cost = costOf(projected);
      if (out.length === 0) {
        out.push(projected);
        used += cost;
        if (cost > opts.byteBudget) budgetUnderflow = true;
        advanced = true;
        continue;
      }
      if (used + cost > opts.byteBudget) {
        continue;
      }
      out.push(projected);
      used += cost;
      advanced = true;
    }
    if (!advanced) break;
  }
  return { samples: out, budgetUnderflow };
}
function sampleBalanced(vault, external, opts) {
  const half = Math.floor(opts.byteBudget / 2);
  const vaultResult = sampleSessionsWithMeta(vault, { byteBudget: half }, {
    bucket: "vault",
    project: null
  });
  const projectByRef = /* @__PURE__ */ new Map();
  for (const e of external) projectByRef.set(e.summary, e.project);
  const projectsResult = sampleSessionsWithMeta(
    external.map((e) => e.summary),
    { byteBudget: opts.byteBudget - half },
    { bucket: "projects", project: "" }
  );
  for (const sample of projectsResult.samples) {
    const owner = external.find((e) => e.summary.id === sample.id);
    sample.project = owner ? owner.project : "";
  }
  return {
    samples: [...vaultResult.samples, ...projectsResult.samples],
    budgetUnderflow: vaultResult.budgetUnderflow || projectsResult.budgetUnderflow
  };
}

// src/run.ts
async function run(args) {
  const vaultProject = encodeVaultPath(path4.resolve(args.vaultDir));
  const [{ discovered: vaultDiscovered, warnings: vaultWarnings }, externalResult] = await Promise.all([
    discoverSessions({
      vaultDir: args.vaultDir,
      projectsDir: args.projectsDir,
      period: args.period
    }),
    discoverExternalSessions({
      projectsDir: args.projectsDir,
      vaultProject,
      period: args.period
    })
  ]);
  const vaultSummaries = vaultDiscovered.filter(isVaultRelevant).map((d) => toSessionSummary(d, { vaultDir: args.vaultDir }));
  const externalSessions = externalResult.discovered.map((d) => ({
    project: d.project,
    summary: toSessionSummaryFromExternal(d)
  }));
  const externalSummaries = externalSessions.map((e) => e.summary);
  const allSummaries = [...vaultSummaries, ...externalSummaries];
  const buckets = {
    vault: aggregate(vaultSummaries),
    projects: aggregate(externalSummaries),
    total: aggregate(allSummaries)
  };
  const perProject = buildPerProject(vaultSummaries, externalSessions);
  const unusedTools = computeUnusedTools(allSummaries);
  const sampleResult = sampleBalanced(vaultSummaries, externalSessions, {
    byteBudget: args.byteBudget
  });
  const warnings = [...vaultWarnings, ...externalResult.warnings];
  if (sampleResult.budgetUnderflow) {
    warnings.push(
      `sample byte budget too small; one or both bucket pools emitted N=1 anyway (budget ${args.byteBudget})`
    );
  }
  return {
    period: args.period,
    buckets,
    perProject,
    unusedTools,
    samples: sampleResult.samples,
    warnings
  };
}
async function runDetail(args) {
  const period = { startMs: 0, endMs: Number.MAX_SAFE_INTEGER, label: "all" };
  const { discovered } = await discoverSessions({
    vaultDir: args.vaultDir,
    projectsDir: args.projectsDir,
    period
  });
  const found = discovered.find((d) => d.meta.id === args.sessionId);
  if (!found) {
    throw new Error(`session ${args.sessionId} not found`);
  }
  return toSessionSummary(found, { vaultDir: args.vaultDir });
}

// src/cli.ts
var DEFAULT_BYTE_BUDGET = 5e4;
function parseByteSize(input) {
  const s = input.trim().toUpperCase();
  const m = /^(\d+(?:\.\d+)?)(KB|MB|B)?$/.exec(s);
  if (!m) {
    throw new Error(`Unsupported size: '${input}'. Expected e.g. '50000', '50KB', '1MB'.`);
  }
  const n = Number(m[1]);
  const unit = m[2] ?? "B";
  const mult = unit === "MB" ? 1e6 : unit === "KB" ? 1e3 : 1;
  return Math.round(n * mult);
}
async function main() {
  const argv = await yargs(hideBin(process.argv)).scriptName("nv-analytics").usage("$0 --period <span> [options]   |   $0 --detail <sessionId> [options]").option("period", {
    type: "string",
    describe: "Window to analyze (e.g. 7d, 2w). Mutually exclusive with --detail."
  }).option("detail", {
    type: "string",
    describe: "Session id to dump in full (no period filter). Mutually exclusive with --period."
  }).conflicts("period", "detail").option("vault", {
    type: "string",
    describe: "Path to the Obsidian vault. Auto-detected from cwd if omitted."
  }).option("sample-bytes", {
    type: "string",
    default: String(DEFAULT_BYTE_BUDGET),
    describe: 'Target byte size for the samples[] array (e.g. 50000 or "50KB").'
  }).option("format", {
    type: "string",
    choices: ["json", "text"],
    default: "json",
    describe: "Output format (period mode only; detail mode is always JSON)."
  }).option("projects-dir", {
    type: "string",
    default: path5.join(os.homedir(), ".claude", "projects"),
    describe: "Root of the SDK projects store (override for testing)."
  }).check((args) => {
    if (!args.period && !args.detail) {
      throw new Error("Provide either --period or --detail.");
    }
    return true;
  }).strict().help().parseAsync();
  const vaultDir = resolveVault({ explicit: argv.vault, cwd: process.cwd() });
  if (argv.detail) {
    const detail = await runDetail({
      vaultDir,
      projectsDir: argv["projects-dir"],
      sessionId: argv.detail
    });
    process.stdout.write(JSON.stringify(detail, null, 2) + "\n");
    return 0;
  }
  const period = parsePeriod(argv.period, Date.now());
  const byteBudget = parseByteSize(argv["sample-bytes"]);
  const report = await run({
    vaultDir,
    projectsDir: argv["projects-dir"],
    period,
    byteBudget
  });
  const out = argv.format === "text" ? formatText(report) : formatJson(report);
  process.stdout.write(out);
  return 0;
}
main().then((code) => process.exit(code)).catch((err) => {
  process.stderr.write(`nv-analytics: ${err instanceof Error ? err.message : String(err)}
`);
  process.exit(1);
});
//# sourceMappingURL=cli.js.map