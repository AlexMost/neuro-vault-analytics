#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { resolveVault } from './config.js';
import { formatJson, formatText } from './format.js';
import { parsePeriod } from './period.js';
import { run } from './run.js';

async function main(): Promise<number> {
  const argv = await yargs(hideBin(process.argv))
    .scriptName('nv-analytics')
    .usage('$0 --period <span> [options]')
    .option('period', {
      type: 'string',
      demandOption: true,
      describe: 'Window to analyze (e.g. 7d, 2w)',
    })
    .option('vault', {
      type: 'string',
      describe: 'Path to the Obsidian vault. Auto-detected from cwd if omitted.',
    })
    .option('sample-size', {
      type: 'number',
      default: 15,
      describe: 'Number of representative sessions to include in samples[]',
    })
    .option('format', {
      type: 'string',
      choices: ['json', 'text'] as const,
      default: 'json',
      describe: 'Output format',
    })
    .option('projects-dir', {
      type: 'string',
      default: path.join(os.homedir(), '.claude', 'projects'),
      describe: 'Root of the SDK projects store (override for testing).',
    })
    .strict()
    .help()
    .parseAsync();

  const period = parsePeriod(argv.period, Date.now());
  const vaultDir = resolveVault({ explicit: argv.vault, cwd: process.cwd() });

  const report = await run({
    vaultDir,
    projectsDir: argv['projects-dir'] as string,
    period,
    sampleSize: argv['sample-size'] as number,
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
