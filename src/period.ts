export interface Period {
  startMs: number;
  endMs: number;
  label: string;
}

const UNIT_MS: Record<string, number> = {
  d: 24 * 60 * 60 * 1000,
  w: 7 * 24 * 60 * 60 * 1000,
};

export function parsePeriod(input: string, nowMs: number): Period {
  const match = /^(\d+)([dw])$/.exec(input.trim());
  if (!match) {
    throw new Error(`Unsupported period: '${input}'. Expected '<N>d' or '<N>w'.`);
  }
  const amount = Number(match[1]);
  const unit = match[2]!;
  const span = amount * UNIT_MS[unit]!;
  return { startMs: nowMs - span, endMs: nowMs, label: input };
}
