#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { resolveVault } from './config.js';
import { formatJson, formatText } from './format.js';
import { parsePeriod } from './period.js';
import { run, runDetail } from './run.js';

const DEFAULT_BYTE_BUDGET = 50_000;

function parseByteSize(input: string): number {
  const s = input.trim().toUpperCase();
  const m = /^(\d+(?:\.\d+)?)(KB|MB|B)?$/.exec(s);
  if (!m) {
    throw new Error(`Unsupported size: '${input}'. Expected e.g. '50000', '50KB', '1MB'.`);
  }
  const n = Number(m[1]);
  const unit = m[2] ?? 'B';
  const mult = unit === 'MB' ? 1_000_000 : unit === 'KB' ? 1_000 : 1;
  return Math.round(n * mult);
}

async function main(): Promise<number> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('nv-analytics')
    .usage('$0 --period <span> [options]   |   $0 --detail <sessionId> [options]')
    .option('period', {
      type: 'string',
      describe: 'Window to analyze (e.g. 7d, 2w). Mutually exclusive with --detail.',
    })
    .option('detail', {
      type: 'string',
      describe: 'Session id to dump in full (no period filter). Mutually exclusive with --period.',
    })
    .conflicts('period', 'detail')
    .option('vault', {
      type: 'string',
      describe: 'Path to the Obsidian vault. Auto-detected from cwd if omitted.',
    })
    .option('sample-bytes', {
      type: 'string',
      default: String(DEFAULT_BYTE_BUDGET),
      describe: 'Target byte size for the samples[] array (e.g. 50000 or "50KB").',
    })
    .option('format', {
      type: 'string',
      choices: ['json', 'text'] as const,
      default: 'json',
      describe: 'Output format (period mode only; detail mode is always JSON).',
    })
    .option('projects-dir', {
      type: 'string',
      default: path.join(os.homedir(), '.claude', 'projects'),
      describe: 'Root of the SDK projects store (override for testing).',
    })
    .check((args) => {
      if (!args.period && !args.detail) {
        throw new Error('Provide either --period or --detail.');
      }
      return true;
    })
    .strict()
    .help()
    .parseAsync();

  const vaultDir = resolveVault({ explicit: argv.vault, cwd: process.cwd() });

  if (argv.detail) {
    const detail = await runDetail({
      vaultDir,
      projectsDir: argv['projects-dir'] as string,
      sessionId: argv.detail as string,
    });
    process.stdout.write(JSON.stringify(detail, null, 2) + '\n');
    return 0;
  }

  const period = parsePeriod(argv.period as string, Date.now());
  const byteBudget = parseByteSize(argv['sample-bytes'] as string);

  const report = await run({
    vaultDir,
    projectsDir: argv['projects-dir'] as string,
    period,
    byteBudget,
  });

  const out = argv.format === 'text' ? formatText(report) : formatJson(report);
  process.stdout.write(out);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    process.stderr.write(`nv-analytics: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
