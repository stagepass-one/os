import { describe, it, expect } from 'vitest';
import { readPackageVersions } from '../../../../../scripts/check-release-version.mjs';
import {
  NPM_PACK_ARGS,
  executeReleaseDryRun,
  formatDryRun,
  runNpmPackDryRun,
  selectRelease,
  summarizePack,
} from '../../../../../scripts/release-dry-run.mjs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');
const SCRIPT = path.join(ROOT, 'scripts/release-dry-run.mjs');

function findNpm() {
  const besideNode = path.join(path.dirname(process.execPath), 'npm');
  if (existsSync(besideNode)) return besideNode;
  const found = spawnSync('bash', ['-lc', 'command -v npm'], { encoding: 'utf8' });
  return (found.stdout || '').trim();
}

function writePackage(root, dir, version) {
  const pkgDir = path.join(root, 'packages', dir);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({ name: `@stagepass/${dir}`, version })
  );
  return pkgDir;
}

function packJson(pkg, { fileCount = 2, totalSize = 200, name, version } = {}) {
  return [
    {
      name: name ?? pkg.name,
      version: version ?? pkg.version,
      files: Array.from({ length: fileCount }, (_, i) => ({ path: `file-${i}`, size: 1 })),
      entryCount: fileCount,
      unpackedSize: totalSize,
      size: 50,
    },
  ];
}

/**
 * @param {string[]} args
 * @param {{ mode: 'forbid'|'fake'|'guard', pkg?: { name: string, version: string }, extraEnv?: Record<string, string> }} options
 */
function runCli(args, { mode, pkg, extraEnv = {} }) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'sp-dry-'));
  const log = path.join(tmp, 'npm-log');
  const shim = path.join(tmp, 'npm');
  writeFileSync(log, '');
  const realNpm = findNpm();
  if (mode === 'guard' && !realNpm) {
    rmSync(tmp, { recursive: true, force: true });
    throw new Error('npm not found for the guarded pack test');
  }
  if (mode === 'fake') {
    const payload = JSON.stringify(packJson(pkg));
    writeFileSync(
      shim,
      `#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const args = process.argv.slice(2);
appendFileSync(process.env.SP_NPM_LOG, args.join(' ') + '\\n');
if (args.join(' ') !== 'pack --dry-run --json') {
  console.error('blocked npm ' + args.join(' '));
  process.exit(97);
}
console.log(${JSON.stringify(payload)});
`
    );
  } else if (mode === 'guard') {
    writeFileSync(
      shim,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$SP_NPM_LOG"
if [ "$1" = "pack" ] && [ "$2" = "--dry-run" ] && [ "$3" = "--json" ] && [ "$#" -eq 3 ]; then
  PATH="$SP_REAL_PATH" exec "$SP_REAL_NPM" "$@"
fi
echo "blocked npm $*" >&2
exit 97
`
    );
  } else {
    writeFileSync(
      shim,
      `#!/bin/sh
printf '%s\\n' "$*" >> "$SP_NPM_LOG"
echo "blocked npm $*" >&2
exit 97
`
    );
  }
  chmodSync(shim, 0o755);
  const env = {
    ...process.env,
    PATH: `${tmp}${path.delimiter}${process.env.PATH}`,
    SP_NPM_LOG: log,
    SP_REAL_NPM: realNpm,
    SP_REAL_PATH: process.env.PATH,
  };
  delete env.RELEASE_REF;
  delete env.GITHUB_REF_NAME;
  delete env.NODE_AUTH_TOKEN;
  delete env.NPM_TOKEN;
  Object.assign(env, extraEnv);
  const res = spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env,
  });
  const invocations = readFileSync(log, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  rmSync(tmp, { recursive: true, force: true });
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    invocations,
  };
}

describe('release dry-run selection', () => {
  const packages = readPackageVersions(ROOT);

  it('locks the npm invocation to pack --dry-run --json', () => {
    expect(NPM_PACK_ARGS).toEqual(['pack', '--dry-run', '--json']);
  });

  it('selects exactly the package whose version matches the tag', () => {
    for (const pkg of packages) {
      const selection = selectRelease(`${pkg.dir}-v${pkg.version}`, ROOT);
      expect(selection).toEqual({
        dir: pkg.dir,
        name: pkg.name,
        version: pkg.version,
        distTag: pkg.version.includes('-') ? 'next' : 'latest',
      });
      const others = packages.filter((other) => other.dir !== pkg.dir);
      for (const other of others) {
        expect(selection.dir).not.toBe(other.dir);
        expect(selection.name).not.toBe(other.name);
      }
    }
  });

  it('fails closed when the tag version does not match the package', () => {
    let packed = false;
    expect(() =>
      executeReleaseDryRun('loader-v0.0.0', {
        pack() {
          packed = true;
          return [];
        },
      })
    ).toThrow(/does not match tag version/);
    expect(packed).toBe(false);
  });

  it('fails closed on a shared v* tag', () => {
    const loader = packages.find((pkg) => pkg.dir === 'loader');
    let packed = false;
    const pack = () => {
      packed = true;
      return [];
    };
    expect(() => executeReleaseDryRun(`v${loader.version}`, { pack })).toThrow(
      /Not a package release tag/
    );
    expect(() => executeReleaseDryRun('v2.5.1', { pack })).toThrow(/Not a package release tag/);
    expect(packed).toBe(false);
  });

  it('maps a prerelease to next and a stable fixture to latest', () => {
    const pre = mkdtempSync(path.join(os.tmpdir(), 'sp-dry-pre-'));
    const stable = mkdtempSync(path.join(os.tmpdir(), 'sp-dry-stable-'));
    try {
      writePackage(pre, 'loader', '1.2.3-beta.1');
      const preRun = executeReleaseDryRun('loader-v1.2.3-beta.1', {
        root: pre,
        pack: (dir) => {
          expect(dir).toBe(path.join(pre, 'packages', 'loader'));
          return packJson({ name: '@stagepass/loader', version: '1.2.3-beta.1' });
        },
      });
      expect(preRun.selection.distTag).toBe('next');
      expect(preRun.selection).toEqual({
        dir: 'loader',
        name: '@stagepass/loader',
        version: '1.2.3-beta.1',
        distTag: 'next',
      });
      expect(formatDryRun(preRun.selection, preRun.summary)).toContain('dist_tag: next');
      expect(formatDryRun(preRun.selection, preRun.summary)).toContain(
        'package_dir: packages/loader'
      );

      writePackage(stable, 'modules', '9.9.9');
      const stableRun = executeReleaseDryRun('modules-v9.9.9', {
        root: stable,
        pack: () => packJson({ name: '@stagepass/modules', version: '9.9.9' }),
      });
      expect(stableRun.selection.distTag).toBe('latest');
    } finally {
      rmSync(pre, { recursive: true, force: true });
      rmSync(stable, { recursive: true, force: true });
    }
  });

  it('fails when the packed name or version does not match the selection', () => {
    const loader = packages.find((pkg) => pkg.dir === 'loader');
    expect(() =>
      executeReleaseDryRun(`loader-v${loader.version}`, {
        pack: () => packJson(loader, { name: '@stagepass/cli', version: loader.version }),
      })
    ).toThrow(/does not match selected/);
  });

  it('passes only npm pack --dry-run --json to the pack runner', () => {
    const calls = [];
    const parsed = runNpmPackDryRun('/tmp/stagepass-pack', (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts.cwd });
      return JSON.stringify(
        packJson({ name: '@stagepass/loader', version: '2.5.1' }, { fileCount: 3, totalSize: 90 })
      );
    });
    expect(calls).toEqual([
      { cmd: 'npm', args: ['pack', '--dry-run', '--json'], cwd: '/tmp/stagepass-pack' },
    ]);
    expect(summarizePack(parsed)).toEqual({
      name: '@stagepass/loader',
      version: '2.5.1',
      fileCount: 3,
      totalSize: 90,
    });
  });
});

describe('release dry-run process', () => {
  const packages = readPackageVersions(ROOT);

  it('prints the selected package and does not call npm publish or npm stage', () => {
    for (const pkg of packages) {
      const result = runCli([`${pkg.dir}-v${pkg.version}`], { mode: 'fake', pkg });
      const distTag = pkg.version.includes('-') ? 'next' : 'latest';
      expect(result.status).toBe(0);
      expect(result.invocations).toEqual(['pack --dry-run --json']);
      expect(result.stdout).toBe(
        [
          `stage_dir: ${pkg.dir}`,
          `package_dir: packages/${pkg.dir}`,
          `dist_tag: ${distTag}`,
          `name: ${pkg.name}`,
          `version: ${pkg.version}`,
          'file_count: 2',
          'total_size: 200',
          '',
        ].join('\n')
      );
      for (const other of packages) {
        if (other.dir === pkg.dir) continue;
        expect(result.stdout).not.toContain(`stage_dir: ${other.dir}`);
        expect(result.stdout).not.toContain(other.name);
      }
      expect(result.stdout).not.toMatch(/\b(publish|stage publish)\b/);
      expect(result.stderr).not.toMatch(/\bnpm (publish|stage)\b/);
    }
  });

  it('exits 1 on a wrong version and does not pack', () => {
    const result = runCli(['loader-v0.0.0'], { mode: 'forbid' });
    expect(result.status).toBe(1);
    expect(result.invocations).toEqual([]);
    expect(result.stderr).toMatch(/does not match tag version/);
  });

  it('exits 1 on a shared v* tag and does not pack', () => {
    const loader = packages.find((pkg) => pkg.dir === 'loader');
    const result = runCli([`v${loader.version}`], { mode: 'forbid' });
    expect(result.status).toBe(1);
    expect(result.invocations).toEqual([]);
    expect(result.stderr).toMatch(/Not a package release tag/);
  });

  it('fails closed on extra arguments and on an empty argument', () => {
    const loader = packages.find((pkg) => pkg.dir === 'loader');
    const extra = runCli([`loader-v${loader.version}`, 'extra'], { mode: 'forbid' });
    expect(extra.status).toBe(1);
    expect(extra.invocations).toEqual([]);
    const empty = runCli([''], {
      mode: 'forbid',
      extraEnv: { RELEASE_REF: `loader-v${loader.version}` },
    });
    expect(empty.status).toBe(1);
    expect(empty.invocations).toEqual([]);
  });

  it('uses RELEASE_REF when the CLI argument is omitted', () => {
    const modules = packages.find((pkg) => pkg.dir === 'modules');
    const result = runCli([], {
      mode: 'fake',
      pkg: modules,
      extraEnv: { RELEASE_REF: `modules-v${modules.version}` },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('stage_dir: modules');
    expect(result.stdout).toContain('dist_tag: latest');
  });

  it('runs npm pack --dry-run once for the current loader tag', () => {
    const loader = packages.find((pkg) => pkg.dir === 'loader');
    const result = runCli([`loader-v${loader.version}`], { mode: 'guard' });
    expect(result.status).toBe(0);
    expect(result.invocations).toEqual(['pack --dry-run --json']);
    expect(result.stdout).toContain('stage_dir: loader');
    expect(result.stdout).toContain('package_dir: packages/loader');
    expect(result.stdout).toContain('dist_tag: latest');
    expect(result.stdout).toContain(`name: ${loader.name}`);
    expect(result.stdout).toContain(`version: ${loader.version}`);
    expect(result.stdout).toMatch(/file_count: [1-9]\d*/);
    expect(result.stdout).toMatch(/total_size: [1-9]\d*/);
    expect(result.invocations.join('\n')).not.toMatch(/\b(publish|stage)\b/);
    expect(result.stderr).not.toMatch(/\bnpm (publish|stage)\b/);
  });
});
