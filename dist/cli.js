#!/usr/bin/env node

// src/cli.ts
import os from "os";
import path3 from "path";
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

// src/format.ts
function formatJson(report) {
  return JSON.stringify(report) + "\n";
}
function formatText(report) {
  const lines = [];
  lines.push(`Usage analytics \u2014 period ${report.period.label}`);
  lines.push(`Sessions: ${report.stats.sessionsVault} / ${report.stats.sessionsTotal} touch vault`);
  lines.push(
    `Tool calls: ${report.stats.totalToolCalls} (avg ${report.stats.avgToolCallsPerSession.toFixed(1)} / session)`
  );
  if (report.aggregates.topTools.length > 0) {
    const top = report.aggregates.topTools.map((t) => `${t.key.replace("mcp__neuro-vault-mcp__", "")} (${t.count})`).join(", ");
    lines.push(`Top tools: ${top}`);
  }
  if (report.aggregates.unusedTools.length > 0) {
    lines.push(
      `Unused tools: ${report.aggregates.unusedTools.map((t) => t.replace("mcp__neuro-vault-mcp__", "")).join(", ")}`
    );
  }
  if (report.aggregates.stalePathErrors.length > 0) {
    lines.push(`Stale-path errors: ${report.aggregates.stalePathErrors.length} session(s)`);
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

// src/types.ts
var KNOWN_NEURO_VAULT_TOOLS = [
  "mcp__neuro-vault-mcp__search_notes",
  "mcp__neuro-vault-mcp__read_note",
  "mcp__neuro-vault-mcp__get_tag",
  "mcp__neuro-vault-mcp__read_property",
  "mcp__neuro-vault-mcp__find_duplicates",
  "mcp__neuro-vault-mcp__get_stats"
];

// src/aggregate.ts
var SEARCH = "mcp__neuro-vault-mcp__search_notes";
var READ_NOTE = "mcp__neuro-vault-mcp__read_note";
function topByCount(map, n) {
  return [...map.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, n);
}
function extractPath(argsSummary) {
  const m = /"path":"([^"]+)"/.exec(argsSummary);
  return m ? m[1] : null;
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
  for (const s of sessions) {
    if (s.outcome === "dead_end") deadEndCount++;
    cacheHits.push(s.cacheHitRatio);
    subagentBudgets.push(...s.subagent.toolCallsPerAgent);
    if (s.currentNote) noteCounts.set(s.currentNote, (noteCounts.get(s.currentNote) ?? 0) + 1);
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
      if (a.name === SEARCH && b.name === READ_NOTE && b.status === "error") {
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
    topTools: topByCount(toolCounts, 10),
    unusedTools: KNOWN_NEURO_VAULT_TOOLS.filter((t) => !toolCounts.has(t)),
    topSequences,
    largestResultTools,
    stalePathErrors,
    currentNoteAnchors: topByCount(noteCounts, 20),
    cacheHitDistribution: {
      p50: percentile(sortedCacheHits, 50),
      p90: percentile(sortedCacheHits, 90),
      // NOTE: plan had a bug here using sortedBudgets — fixed to sortedCacheHits
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

// src/filter.ts
var NEURO_VAULT_PREFIX = "mcp__neuro-vault-mcp__";
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

// src/sample.ts
var MCP_PREFIX = "mcp__neuro-vault-mcp__";
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
function projectSession(s) {
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
    }
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
function sampleSessionsWithMeta(sessions, opts) {
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
      const projected = projectSession(q.shift());
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

// src/run.ts
async function run(args) {
  const { discovered, warnings } = await discoverSessions({
    vaultDir: args.vaultDir,
    projectsDir: args.projectsDir,
    period: args.period
  });
  const vaultDiscovered = discovered.filter(isVaultRelevant);
  const summaries = vaultDiscovered.map((d) => toSessionSummary(d, { vaultDir: args.vaultDir }));
  const totalToolCalls = summaries.reduce((sum, s) => sum + s.toolCalls.length, 0);
  const aggregates = aggregate(summaries);
  const sampleResult = sampleSessionsWithMeta(summaries, { byteBudget: args.byteBudget });
  const allWarnings = [...warnings];
  if (sampleResult.budgetUnderflow) {
    allWarnings.push(
      `sample byte budget too small; emitted N=1 anyway (cost > ${args.byteBudget})`
    );
  }
  return {
    period: args.period,
    stats: {
      sessionsTotal: discovered.length,
      sessionsVault: summaries.length,
      totalToolCalls,
      avgToolCallsPerSession: summaries.length === 0 ? 0 : totalToolCalls / summaries.length
    },
    aggregates,
    samples: sampleResult.samples,
    warnings: allWarnings
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
    default: path3.join(os.homedir(), ".claude", "projects"),
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