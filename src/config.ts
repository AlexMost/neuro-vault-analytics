import fs from 'node:fs';
import path from 'node:path';

export interface ResolveVaultArgs {
  explicit: string | undefined;
  cwd: string;
}

export function resolveVault(args: ResolveVaultArgs): string {
  if (args.explicit !== undefined) {
    const abs = path.resolve(args.explicit);
    if (!fs.existsSync(path.join(abs, '.obsidian'))) {
      throw new Error(`No .obsidian/ directory at ${abs}`);
    }
    return abs;
  }

  let dir = path.resolve(args.cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, '.obsidian'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error('Could not locate Obsidian vault: pass --vault or run from inside a vault');
    }
    dir = parent;
  }
}

export function encodeVaultPath(absVaultPath: string): string {
  return absVaultPath.replace(/\//g, '-');
}
