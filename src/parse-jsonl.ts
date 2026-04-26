import type { ToolCall } from './types.js';

interface ContentBlock {
  type: string;
  // tool_use
  id?: string;
  name?: string;
  input?: unknown;
  // tool_result
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
}

interface SdkLine {
  type?: string;
  timestamp?: string;
  message?: { role?: string; content?: ContentBlock[] };
}

const ARGS_CAP = 120;

function summarizeArgs(input: unknown): string {
  let s: string;
  try {
    s = typeof input === 'string' ? input : JSON.stringify(input);
  } catch {
    s = String(input);
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > ARGS_CAP ? s.slice(0, ARGS_CAP - 1) + '…' : s;
}

function sizeOf(content: unknown): number {
  if (typeof content === 'string') return Buffer.byteLength(content, 'utf8');
  try {
    return Buffer.byteLength(JSON.stringify(content) ?? '', 'utf8');
  } catch {
    return 0;
  }
}

export function extractToolCalls(jsonl: string, source: ToolCall['source']): ToolCall[] {
  // First pass: collect tool_use entries and tool_result entries keyed by tool_use_id.
  const calls = new Map<
    string,
    { name: string; argsSummary: string; ts: number; source: ToolCall['source'] }
  >();
  const results = new Map<string, { resultSize: number; isError: boolean }>();

  for (const raw of jsonl.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let obj: SdkLine;
    try {
      obj = JSON.parse(line) as SdkLine;
    } catch {
      continue;
    }
    const blocks = obj.message?.content;
    if (!Array.isArray(blocks)) continue;
    const ts = obj.timestamp ? Date.parse(obj.timestamp) : NaN;

    if (obj.type === 'assistant') {
      for (const block of blocks) {
        if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          calls.set(block.id, {
            name: block.name,
            argsSummary: summarizeArgs(block.input),
            ts: Number.isFinite(ts) ? ts : 0,
            source,
          });
        }
      }
    } else if (obj.type === 'user') {
      for (const block of blocks) {
        if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          results.set(block.tool_use_id, {
            resultSize: sizeOf(block.content),
            isError: block.is_error === true,
          });
        }
      }
    }
  }

  const out: ToolCall[] = [];
  for (const [id, call] of calls) {
    const result = results.get(id);
    out.push({
      name: call.name,
      argsSummary: call.argsSummary,
      resultSize: result ? result.resultSize : null,
      status: result?.isError ? 'error' : 'ok',
      source: call.source,
      ts: call.ts,
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
