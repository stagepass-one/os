#!/usr/bin/env node
/**
 * Local dry-run of the release workflow's package selection and pack step.
 *
 * Accepts the same release ref as scripts/check-release-version.mjs
 * (`cli-vX`, `loader-vX`, `modules-vX`, or RELEASE_REF / GITHUB_REF_NAME when
 * the CLI argument is omitted). An empty argument does not fall back. Extra
 * arguments, a shared `v*` tag, and any other ref fail closed.
 *
 * Prints the single package directory the workflow step
 * "Verify package tag matches the selected package version" would stage,
 * and the dist-tag that step writes (`latest` for a stable version, `next`
 * when the version contains `-`). Then runs `npm pack --dry-run --json` in
 * that package directory and prints name, version, file count, and total
 * size (unpacked size: the sum of the packed file sizes).
 *
 * Does not publish the package and does not stage it. The npm invocation is
 * only `npm pack --dry-run --json` (no network write).
 *
 * Usage:
 *   node scripts/release-dry-run.mjs loader-v2.5.1
 *   npm run release:dry-run -- loader-v2.5.1
 *
 * Exit 0 on success, 1 on mismatch or any other failure.
 */

import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distTagForVersion, releasePlan } from './check-release-version.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Argv passed to npm. Kept as data so tests can lock the exact command. */
export const NPM_PACK_ARGS = ['pack', '--dry-run', '--json'];

/**
 * Select the one package the release workflow would stage for `tag`.
 * Dist-tag matches `distTagForVersion` in check-release-version.mjs, which
 * is what `.github/workflows/release.yml` stores as `dist_tag`.
 * @param {string} tag
 * @param {string} [root]
 * @returns {{ dir: string, name: string, version: string, distTag: 'latest'|'next' }}
 */
export function selectRelease(tag, root = ROOT) {
  const plan = releasePlan(tag, root);
  if (plan.stage.length !== 1) {
    throw new Error(`Tag version ${plan.version} did not select exactly one package`);
  }
  const selected = plan.stage[0];
  return {
    dir: selected.dir,
    name: selected.name,
    version: selected.version,
    distTag: distTagForVersion(plan.version),
  };
}

/**
 * @param {string} stdout
 * @returns {unknown}
 */
export function parsePackStdout(stdout) {
  const text = String(stdout).trim();
  if (!text) {
    throw new Error('npm pack --dry-run did not return JSON');
  }
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start === -1 || end <= start) {
      throw new Error('npm pack --dry-run did not return JSON');
    }
    return JSON.parse(text.slice(start, end + 1));
  }
}

/**
 * Name, version, file count, and total unpacked size from `npm pack --json`.
 * @param {unknown} packJson
 * @returns {{ name: string, version: string, fileCount: number, totalSize: number }}
 */
export function summarizePack(packJson) {
  const list = Array.isArray(packJson) ? packJson : [packJson];
  if (list.length !== 1 || !list[0] || typeof list[0] !== 'object') {
    throw new Error('npm pack --dry-run did not return exactly one package');
  }
  const info = /** @type {{ name?: unknown, version?: unknown, files?: unknown, entryCount?: unknown, unpackedSize?: unknown, size?: unknown }} */ (
    list[0]
  );
  if (typeof info.name !== 'string' || typeof info.version !== 'string') {
    throw new Error('npm pack --dry-run did not return a package name and version');
  }
  const files = Array.isArray(info.files) ? info.files : null;
  const fileCount = files ? files.length : info.entryCount;
  if (!Number.isInteger(fileCount) || fileCount < 0) {
    throw new Error('npm pack --dry-run did not return a file count');
  }
  let totalSize = typeof info.unpackedSize === 'number' ? info.unpackedSize : undefined;
  if (totalSize === undefined && files) {
    totalSize = files.reduce((sum, file) => {
      const size = file && typeof file === 'object' ? file.size : undefined;
      return sum + (typeof size === 'number' ? size : 0);
    }, 0);
  }
  if (totalSize === undefined && typeof info.size === 'number') {
    totalSize = info.size;
  }
  if (typeof totalSize !== 'number' || !Number.isFinite(totalSize) || totalSize < 0) {
    throw new Error('npm pack --dry-run did not return a total size');
  }
  return { name: info.name, version: info.version, fileCount, totalSize };
}

/**
 * @param {string} packageDir
 * @param {typeof execFileSync} [execFile]
 * @returns {unknown}
 */
export function runNpmPackDryRun(packageDir, execFile = execFileSync) {
  let stdout;
  try {
    stdout = execFile('npm', NPM_PACK_ARGS, {
      cwd: packageDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (err) {
    const stderr = err && err.stderr ? String(err.stderr).trim() : '';
    throw new Error(stderr ? `npm pack --dry-run failed: ${stderr}` : 'npm pack --dry-run failed');
  }
  return parsePackStdout(stdout);
}

/**
 * @param {string} ref
 * @param {{ root?: string, pack?: (packageDir: string, selection: ReturnType<typeof selectRelease>) => unknown }} [options]
 */
export function executeReleaseDryRun(ref, options = {}) {
  const root = options.root ?? ROOT;
  const selection = selectRelease(ref, root);
  const packageDir = join(root, 'packages', selection.dir);
  const packJson = options.pack
    ? options.pack(packageDir, selection)
    : runNpmPackDryRun(packageDir);
  const summary = summarizePack(packJson);
  if (summary.name !== selection.name || summary.version !== selection.version) {
    throw new Error(
      `Packed ${summary.name}@${summary.version} does not match selected ${selection.name}@${selection.version}`
    );
  }
  return { selection, summary, packageDir };
}

/**
 * @param {{ dir: string, distTag: string }} selection
 * @param {{ name: string, version: string, fileCount: number, totalSize: number }} summary
 */
export function formatDryRun(selection, summary) {
  return [
    `stage_dir: ${selection.dir}`,
    `package_dir: packages/${selection.dir}`,
    `dist_tag: ${selection.distTag}`,
    `name: ${summary.name}`,
    `version: ${summary.version}`,
    `file_count: ${summary.fileCount}`,
    `total_size: ${summary.totalSize}`,
  ].join('\n');
}

function main() {
  try {
    if (process.argv.length > 3) {
      throw new Error('Extra arguments are not allowed');
    }
    const ref = process.argv[2] ?? process.env.RELEASE_REF ?? process.env.GITHUB_REF_NAME ?? '';
    const { selection, summary } = executeReleaseDryRun(ref);
    console.log(formatDryRun(selection, summary));
  } catch (e) {
    console.error(`❌ ${e.message || e}`);
    process.exit(1);
  }
}

const isDirect =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirect) {
  main();
}
