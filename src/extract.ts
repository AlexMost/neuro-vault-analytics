import { extractToolCalls } from './parse-jsonl.js';
import type { Discovered } from './discover.js';
import type { Outcome, SessionSummary, SubagentStats, ToolCall } from './types.js';

function cacheHitRatio(usage: Discovered['meta']['usage']): number {
  const denom = usage.cacheReadInputTokens + usage.cacheCreationInputTokens + usage.inputTokens;
  return denom === 0 ? 0 : usage.cacheReadInputTokens / denom;
}

function subagentStats(perAgent: ToolCall[][]): SubagentStats {
  const toolCallsPerAgent = perAgent.map((calls) => calls.length);
  const okFinals = perAgent.filter(
    (calls) => calls.length > 0 && calls[calls.length - 1]!.status === 'ok',
  ).length;
  const finalCallOkRate = perAgent.length === 0 ? 1 : okFinals / perAgent.length;
  return { count: perAgent.length, toolCallsPerAgent, finalCallOkRate };
}

function lastMainStatus(main: ToolCall[]): Outcome {
  if (main.length === 0) return 'completed';
  return main[main.length - 1]!.status === 'error' ? 'dead_end' : 'completed';
}

export function toSessionSummary(d: Discovered): SessionSummary {
  const main = extractToolCalls(d.mainLog, 'main');
  const perAgent = d.subagentLogs.map((s) =>
    extractToolCalls(s.jsonl, `subagent:${s.agentId}` as const),
  );
  const all = [...main, ...perAgent.flat()].sort((a, b) => a.ts - b.ts);

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
    outcome: lastMainStatus(main),
  };
}
