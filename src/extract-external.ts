import { extractToolCalls } from './parse-jsonl.js';
import { lastMainStatus, subagentStats } from './extract.js';
import type { DiscoveredExternal } from './discover-external.js';
import type { SessionSummary, ToolCall } from './types.js';

interface ContentBlock {
  type?: string;
  text?: string;
}

interface SdkLine {
  type?: string;
  timestamp?: string;
  message?: {
    role?: string;
    model?: string;
    content?: ContentBlock[] | string;
    usage?: {
      input_tokens?: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
}

const TITLE_CAP = 80;

interface Derived {
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  cacheHitRatio: number;
}

function deriveFromJsonl(jsonl: string, fallbackMs: number): Derived {
  let title: string | null = null;
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let lastModel: string | null = null;
  let cacheRead = 0;
  let cacheCreation = 0;
  let input = 0;

  for (const raw of jsonl.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let obj: SdkLine;
    try {
      obj = JSON.parse(line) as SdkLine;
    } catch {
      continue;
    }

    if (typeof obj.timestamp === 'string') {
      const ms = Date.parse(obj.timestamp);
      if (Number.isFinite(ms)) {
        if (firstTs === null) firstTs = ms;
        lastTs = ms;
      }
    }

    if (obj.type === 'user' && title === null) {
      const blocks = obj.message?.content;
      if (typeof blocks === 'string') {
        title = blocks;
      } else if (Array.isArray(blocks)) {
        for (const block of blocks) {
          if (block.type === 'text' && typeof block.text === 'string') {
            title = block.text;
            break;
          }
        }
      }
    }

    if (obj.type === 'assistant') {
      if (typeof obj.message?.model === 'string') {
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
  const cleanedTitle = title
    ? title.replace(/\s+/g, ' ').trim().slice(0, TITLE_CAP) || '(no title)'
    : '(no title)';

  return {
    title: cleanedTitle,
    createdAt: firstTs ?? fallbackMs,
    updatedAt: lastTs ?? fallbackMs,
    model: lastModel ?? 'unknown',
    cacheHitRatio: denom === 0 ? 0 : cacheRead / denom,
  };
}

export function toSessionSummaryFromExternal(d: DiscoveredExternal): SessionSummary {
  const main: ToolCall[] = extractToolCalls(d.mainLog, 'main');
  const perAgent: ToolCall[][] = d.subagentLogs.map((s) =>
    extractToolCalls(s.jsonl, `subagent:${s.agentId}` as const),
  );
  const all = [...main, ...perAgent.flat()].sort((a, b) => a.ts - b.ts);

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
    outcome: lastMainStatus(main),
  };
}
