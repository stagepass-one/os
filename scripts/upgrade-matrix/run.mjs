#!/usr/bin/env node
/**
 * In-container upgrade regression matrix.
 *
 * For each fixture CLI version, scaffolds a realistic project with that
 * published CLI, upgrades it with the target CLI (local pack or @latest),
 * and asserts upgrade behaviour derived from packages/cli upgrade + CHANGELOG.
 *
 * Needs network access to the npm registry.
 *
 * Usage (inside the matrix image):
 *   node scripts/upgrade-matrix/run.mjs [--target local|latest] [--only 2.3.0]
 */

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDoctorProjectClean, check } from './assert.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_DIR = join(ROOT, 'packages', 'cli');
const LOADER_DIR = join(ROOT, 'packages', 'loader');
const MODULES_DIR = join(ROOT, 'packages', 'modules');
const npm = 'npm';

/** @type {Array<{ version: string, lang: 'ts'|'js', styles: string, modules: string, name: string }>} */
export const FIXTURES = [
  {
    version: '2.2.7',
    lang: 'ts',
    styles: 'scss',
    modules: 'cookies',
    name: 'matrix-227-ts',
  },
  {
    version: '2.3.0',
    lang: 'js',
    styles: 'css',
    modules: 'cookies',
    name: 'matrix-230-js',
  },
  {
    version: '2.4.0',
    lang: 'ts',
    styles: 'scss',
    modules: 'cookies',
    name: 'matrix-240-ts',
  },
];

const USER_MARKER = 'STAGEPASS_MATRIX_USER_MARKER_do_not_touch';
const CUSTOM_FILE = 'CUSTOM_MATRIX_NOTE.txt';
const CUSTOM_CONTENTS = `${USER_MARKER}\nuser-authored file; upgrade must leave this byte-identical.\n`;

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ target: 'local'|'latest', only: string|null, help: boolean }} */
  const out = { target: 'local', only: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--target') {
      const v = argv[++i];
      if (v !== 'local' && v !== 'latest') {
        throw new Error(`--target must be local or latest (got ${v})`);
      }
      out.target = v;
    } else if (a === '--only') {
      out.only = String(argv[++i] || '');
    } else {
      throw new Error(`Unknown argument: ${a}`);
    }
  }
  return out;
}

function printHelp() {
  console.log(`Usage: node scripts/upgrade-matrix/run.mjs [options]

In-container runner for the upgrade fixture matrix (issue #143).

Options:
  --target local|latest   CLI under test (default: local = npm pack of this checkout)
  --only <version>        Run a single fixture (2.2.7, 2.3.0, or 2.4.0)
  -h, --help              Show this help

Requires network access to the npm registry.
Host entry point: scripts/upgrade-matrix.sh (Docker only).
`);
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').ExecFileSyncOptionsWithStringEncoding} [opts]
 */
function run(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opts]
 */
function runInherit(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'inherit', 'inherit'],
    ...opts,
  });
  if (res.error) throw res.error;
  if (res.status !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} exited ${res.status}`);
  }
  return res;
}

/**
 * Capture stdout+stderr and exit code without throwing.
 * @param {string} cmd
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [opts]
 */
function runCapture(cmd, args, opts = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  const res = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
  const stdout = String(res.stdout || '');
  const stderr = String(res.stderr || '');
  return {
    status: res.status == null ? 1 : res.status,
    stdout,
    stderr,
    combined: `${stdout}${stderr}`,
  };
}

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} packDest
 */
function packWorkspacePackages(env, packDest) {
  mkdirSync(packDest, { recursive: true });
  const packOne = (dir) => {
    const [info] = JSON.parse(
      run(npm, ['pack', '--json', '--pack-destination', packDest], { cwd: dir, env })
    );
    return join(packDest, info.filename);
  };
  return {
    cli: packOne(CLI_DIR),
    loader: packOne(LOADER_DIR),
    modules: packOne(MODULES_DIR),
  };
}

/**
 * @param {string} prefix
 * @param {string} spec
 * @param {NodeJS.ProcessEnv} env
 */
function installCliPrefix(prefix, spec, env) {
  mkdirSync(prefix, { recursive: true });
  runInherit(npm, ['install', '-g', '--prefix', prefix, '--no-audit', '--no-fund', spec], {
    env,
  });
  const bin = join(prefix, 'bin', 'stagepass');
  if (!existsSync(bin)) throw new Error(`stagepass bin missing after install of ${spec}`);
  return bin;
}

/**
 * @param {{ version: string, lang: string, styles: string, modules: string, name: string }} fixture
 */
function newArgsForFixture(fixture) {
  const args = [
    'new',
    fixture.name,
    '--yes',
    '--lang',
    fixture.lang,
    '--styles',
    fixture.styles,
    '--no-git',
    '--install',
    '--site-modules',
    fixture.modules,
  ];
  // 2.2.7 has no --no-php / --no-link; later CLIs default off but pass explicitly.
  if (fixture.version !== '2.2.7') {
    args.push('--no-php', '--no-link');
  }
  return args;
}

/**
 * @param {string} projectDir
 * @param {'ts'|'js'} lang
 */
function applyUserMarkers(projectDir, lang) {
  const entry = lang === 'ts' ? join(projectDir, 'src', 'main.ts') : join(projectDir, 'src', 'main.js');
  const before = readFileSync(entry, 'utf8');
  writeFileSync(entry, `${before}\n// ${USER_MARKER}\n`, 'utf8');
  writeFileSync(join(projectDir, CUSTOM_FILE), CUSTOM_CONTENTS, 'utf8');
  const agentsPath = join(projectDir, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const agents = readFileSync(agentsPath, 'utf8');
    writeFileSync(agentsPath, `${agents}\n\n<!-- ${USER_MARKER} -->\n`, 'utf8');
  }
  return {
    entryPath: entry,
    entryBefore: readFileSync(entry, 'utf8'),
    customBefore: CUSTOM_CONTENTS,
    agentsMarker: USER_MARKER,
  };
}

/**
 * @param {string} projectDir
 * @param {object} markers
 * @param {string} fixtureLabel
 */
function assertUserPreserved(projectDir, markers, fixtureLabel) {
  /** @type {import('./assert.mjs').AssertionResult[]} */
  const results = [];
  const entryAfter = readFileSync(markers.entryPath, 'utf8');
  results.push(
    check(
      fixtureLabel,
      'user-source-preserved',
      entryAfter === markers.entryBefore,
      entryAfter === markers.entryBefore ? 'unchanged' : 'source mutated'
    )
  );
  const customPath = join(projectDir, CUSTOM_FILE);
  const customAfter = existsSync(customPath) ? readFileSync(customPath, 'utf8') : '';
  results.push(
    check(
      fixtureLabel,
      'user-custom-file-preserved',
      customAfter === markers.customBefore,
      customAfter === markers.customBefore ? 'unchanged' : 'custom file mutated'
    )
  );
  const agents = existsSync(join(projectDir, 'AGENTS.md'))
    ? readFileSync(join(projectDir, 'AGENTS.md'), 'utf8')
    : '';
  results.push(
    check(
      fixtureLabel,
      'user-agents-marker-preserved',
      agents.includes(markers.agentsMarker),
      agents.includes(markers.agentsMarker) ? 'marker present' : 'marker missing'
    )
  );
  return results;
}

/**
 * @param {string} projectDir
 * @param {string} expectedCliVersion
 * @param {string} latestLoader
 * @param {string} latestModules
 * @param {string} fixtureLabel
 * @param {string} upgradeStdout
 */
function assertUpgradeEffects(
  projectDir,
  expectedCliVersion,
  latestLoader,
  latestModules,
  fixtureLabel,
  upgradeStdout
) {
  /** @type {import('./assert.mjs').AssertionResult[]} */
  const results = [];
  const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
  const loaderSpec =
    pkg.devDependencies?.['@stagepass/loader'] || pkg.dependencies?.['@stagepass/loader'];
  const modulesSpec =
    pkg.devDependencies?.['@stagepass/modules'] || pkg.dependencies?.['@stagepass/modules'];

  results.push(
    check(
      fixtureLabel,
      'package-loader-range',
      loaderSpec === `^${latestLoader}`,
      `got ${loaderSpec}, want ^${latestLoader}`
    )
  );
  results.push(
    check(
      fixtureLabel,
      'package-modules-range',
      modulesSpec === `^${latestModules}`,
      `got ${modulesSpec}, want ^${latestModules}`
    )
  );

  const guidePath = join(projectDir, 'AGENTS.stagepass.md');
  const guideExists = existsSync(guidePath);
  results.push(check(fixtureLabel, 'agents-stagepass-exists', guideExists));
  if (guideExists) {
    const guide = readFileSync(guidePath, 'utf8');
    results.push(
      check(
        fixtureLabel,
        'agents-stagepass-managed-header',
        guide.includes('stagepass:managed') && guide.includes(`cli=${expectedCliVersion}`),
        guide.split('\n', 1)[0]
      )
    );
    results.push(
      check(
        fixtureLabel,
        'agents-stagepass-cdn-default',
        guide.includes('cdn.stagepass.one'),
        guide.includes('cdn.stagepass.one') ? 'stagepass CDN present' : 'missing'
      )
    );
    results.push(
      check(
        fixtureLabel,
        'agents-stagepass-declares-cookies',
        /cookies/i.test(guide),
        'cookies module section'
      )
    );
  }

  const agents = existsSync(join(projectDir, 'AGENTS.md'))
    ? readFileSync(join(projectDir, 'AGENTS.md'), 'utf8')
    : '';
  results.push(
    check(
      fixtureLabel,
      'agents-md-pointer',
      agents.includes('<!-- stagepass:begin -->') &&
        agents.includes('AGENTS.stagepass.md') &&
        agents.includes('<!-- stagepass:end -->'),
      'managed pointer block'
    )
  );

  results.push(
    check(
      fixtureLabel,
      'upgrade-stdout-snippets',
      upgradeStdout.includes('cdn.stagepass.one/loader@2') ||
        upgradeStdout.includes('cdn.stagepass.one/loader@'),
      'printed Stagepass CDN loader snippet'
    )
  );

  const sp = JSON.parse(readFileSync(join(projectDir, 'stagepass.json'), 'utf8'));
  results.push(
    check(
      fixtureLabel,
      'stagepass-json-modules',
      JSON.stringify(sp.modules) === JSON.stringify(['cookies']),
      JSON.stringify(sp.modules)
    )
  );

  return results;
}

/**
 * @param {string} projectDir
 * @param {string} bin
 * @param {NodeJS.ProcessEnv} env
 * @param {string} fixtureLabel
 */
function assertIdempotent(projectDir, bin, env, fixtureLabel) {
  /** @type {import('./assert.mjs').AssertionResult[]} */
  const results = [];
  const beforePkg = readFileSync(join(projectDir, 'package.json'), 'utf8');
  const guidePath = join(projectDir, 'AGENTS.stagepass.md');
  const beforeGuide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : '';

  const second = runCapture(bin, ['upgrade', '--yes', '--skip-site'], { cwd: projectDir, env });
  results.push(
    check(fixtureLabel, 'upgrade-idempotent-exit', second.status === 0, `exit ${second.status}`)
  );
  results.push(
    check(
      fixtureLabel,
      'upgrade-idempotent-noop-msg',
      second.combined.includes('Everything is up to date') ||
        second.combined.includes('already at the newest published ranges'),
      'noop messaging'
    )
  );
  const afterPkg = readFileSync(join(projectDir, 'package.json'), 'utf8');
  const afterGuide = existsSync(guidePath) ? readFileSync(guidePath, 'utf8') : '';
  results.push(
    check(fixtureLabel, 'upgrade-idempotent-package-json', beforePkg === afterPkg, 'unchanged')
  );
  results.push(
    check(fixtureLabel, 'upgrade-idempotent-agents-stagepass', beforeGuide === afterGuide, 'unchanged')
  );
  return results;
}

/**
 * @param {object} opts
 * @param {'local'|'latest'} opts.target
 * @param {string|null} opts.only
 */
async function main(opts) {
  const env = { ...process.env, npm_config_prefix: undefined };
  delete env.npm_config_prefix;
  env.STAGEPASS_SKIP_PLATFORM_CHECK = '1';
  env.CI = '1';

  const work = mkdtempSync(join(tmpdir(), 'stagepass-upgrade-matrix-'));
  /** @type {{ fixture: string, lang: string, result: 'PASS'|'FAIL', fails: string[] }[]} */
  const table = [];
  /** @type {import('./assert.mjs').AssertionResult[]} */
  const allResults = [];

  try {
    const latestLoader = run(npm, ['view', '@stagepass/loader', 'version'], { env }).trim();
    const latestModules = run(npm, ['view', '@stagepass/modules', 'version'], { env }).trim();
    const latestCli = run(npm, ['view', '@stagepass/cli', 'version'], { env }).trim();
    console.log(
      `Registry latest: cli=${latestCli} loader=${latestLoader} modules=${latestModules}`
    );

    let targetBin;
    let expectedCliVersion;
    if (opts.target === 'local') {
      console.log('Packing local CLI / loader / modules…');
      const packs = packWorkspacePackages(env, join(work, 'packs'));
      const prefix = join(work, 'prefix-local');
      targetBin = installCliPrefix(prefix, packs.cli, env);
      expectedCliVersion = JSON.parse(readFileSync(join(CLI_DIR, 'package.json'), 'utf8')).version;
      // Local loader/modules tarballs are only needed if a fixture install were
      // forced onto unpublished ranges; upgrade writes published ^latest, so the
      // post-upgrade npm install hits the registry. Keep the packs for debugging.
      copyFileSync(packs.cli, join(work, 'cli.tgz'));
    } else {
      const prefix = join(work, 'prefix-latest');
      targetBin = installCliPrefix(prefix, `@stagepass/cli@${latestCli}`, env);
      expectedCliVersion = latestCli;
    }

    const targetVer = run(targetBin, ['--version'], { env }).trim();
    console.log(`Target CLI --version: ${targetVer} (expect ${expectedCliVersion})`);
    if (targetVer !== expectedCliVersion) {
      throw new Error(`Target CLI version ${targetVer} !== ${expectedCliVersion}`);
    }

    const fixtures = FIXTURES.filter((f) => !opts.only || f.version === opts.only);
    if (fixtures.length === 0) {
      throw new Error(`No fixtures match --only ${opts.only}`);
    }

    for (const fixture of fixtures) {
      const label = `${fixture.version}/${fixture.lang}`;
      console.log(`\n======== Fixture ${label} (${fixture.name}) ========`);
      /** @type {string[]} */
      const fails = [];
      const fixtureWork = join(work, `fx-${fixture.version}`);
      mkdirSync(fixtureWork, { recursive: true });

      try {
        const oldPrefix = join(fixtureWork, 'old-prefix');
        const oldBin = installCliPrefix(oldPrefix, `@stagepass/cli@${fixture.version}`, env);
        const oldVer = run(oldBin, ['--version'], { env }).trim();
        allResults.push(
          check(label, 'old-cli-version', oldVer === fixture.version, `got ${oldVer}`)
        );

        const projectsDir = join(fixtureWork, 'projects');
        mkdirSync(projectsDir, { recursive: true });
        runInherit(oldBin, newArgsForFixture(fixture), { cwd: projectsDir, env });
        const projectDir = join(projectsDir, fixture.name);

        // Realistic old project: already installed by --install; build with old tree.
        runInherit(npm, ['run', 'build'], { cwd: projectDir, env });
        allResults.push(
          check(
            label,
            'old-project-build',
            existsSync(join(projectDir, 'dist', 'manifest.json')),
            'manifest.json'
          )
        );

        // Snapshot of the old project (for logs / debugging).
        const snapshot = {
          cli: fixture.version,
          packageJson: JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8')),
          stagepassJson: JSON.parse(readFileSync(join(projectDir, 'stagepass.json'), 'utf8')),
          files: {
            hasAgentsStagepass: existsSync(join(projectDir, 'AGENTS.stagepass.md')),
            hasAgentsMd: existsSync(join(projectDir, 'AGENTS.md')),
            hasCursor: existsSync(join(projectDir, '.cursor')),
            hasBuild: existsSync(join(projectDir, 'scripts', 'build.mjs')),
            entry: fixture.lang === 'ts' ? 'src/main.ts' : 'src/main.js',
          },
        };
        writeFileSync(
          join(fixtureWork, 'old-snapshot.json'),
          `${JSON.stringify(snapshot, null, 2)}\n`,
          'utf8'
        );
        console.log(`Old snapshot: ${JSON.stringify(snapshot.files)}`);

        const markers = applyUserMarkers(projectDir, fixture.lang);

        // Dry-run must not write.
        const pkgBeforeDry = readFileSync(join(projectDir, 'package.json'), 'utf8');
        const guideBeforeDry = existsSync(join(projectDir, 'AGENTS.stagepass.md'))
          ? readFileSync(join(projectDir, 'AGENTS.stagepass.md'), 'utf8')
          : null;
        const dry = runCapture(targetBin, ['upgrade', '--dry-run', '--yes', '--skip-site'], {
          cwd: projectDir,
          env,
        });
        allResults.push(check(label, 'upgrade-dry-run-exit', dry.status === 0, `exit ${dry.status}`));
        allResults.push(
          check(
            label,
            'upgrade-dry-run-message',
            dry.combined.includes('Dry run'),
            'mentions Dry run'
          )
        );
        const pkgAfterDry = readFileSync(join(projectDir, 'package.json'), 'utf8');
        const guideAfterDry = existsSync(join(projectDir, 'AGENTS.stagepass.md'))
          ? readFileSync(join(projectDir, 'AGENTS.stagepass.md'), 'utf8')
          : null;
        allResults.push(
          check(
            label,
            'upgrade-dry-run-no-write',
            pkgAfterDry === pkgBeforeDry && guideAfterDry === guideBeforeDry,
            pkgAfterDry === pkgBeforeDry && guideAfterDry === guideBeforeDry
              ? 'package.json + AGENTS.stagepass.md unchanged'
              : 'dry-run wrote files'
          )
        );

        // Real upgrade (non-interactive).
        const up = runCapture(targetBin, ['upgrade', '--yes', '--skip-site'], {
          cwd: projectDir,
          env,
        });
        allResults.push(check(label, 'upgrade-exit', up.status === 0, `exit ${up.status}`));
        if (up.status !== 0) {
          console.error(up.combined.slice(-2000));
        }

        const effectResults = assertUpgradeEffects(
          projectDir,
          expectedCliVersion,
          latestLoader,
          latestModules,
          label,
          up.combined
        );
        allResults.push(...effectResults);

        const preserveResults = assertUserPreserved(projectDir, markers, label);
        allResults.push(...preserveResults);

        // Install published ranges then rebuild.
        runInherit(npm, ['install', '--no-audit', '--no-fund'], { cwd: projectDir, env });
        runInherit(npm, ['run', 'build'], { cwd: projectDir, env });
        allResults.push(
          check(
            label,
            'post-upgrade-build',
            existsSync(join(projectDir, 'dist', 'manifest.json')),
            'manifest.json'
          )
        );

        const idemResults = assertIdempotent(projectDir, targetBin, env, label);
        allResults.push(...idemResults);

        // Doctor: infra fails expected in Docker; project checks must not surprise-fail.
        const doctor = runCapture(targetBin, ['doctor', '--json', '--skip-site'], {
          cwd: projectDir,
          env,
        });
        let report = { checks: [] };
        try {
          report = JSON.parse(doctor.stdout || doctor.combined);
        } catch {
          // Some CLIs may print non-JSON noise; try last JSON object.
          const text = doctor.stdout || doctor.combined;
          const start = text.indexOf('{');
          const end = text.lastIndexOf('}');
          if (start !== -1 && end > start) {
            report = JSON.parse(text.slice(start, end + 1));
          }
        }
        allResults.push(...assertDoctorProjectClean(label, report));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`Fixture ${label} threw: ${msg}`);
        allResults.push(check(label, 'fixture-completed', false, msg));
      }

      const fixtureAsserts = allResults.filter((r) => r.name.startsWith(`[${label}]`));
      const failed = fixtureAsserts.filter((r) => !r.ok);
      for (const f of failed) fails.push(f.name);
      table.push({
        fixture: fixture.version,
        lang: fixture.lang,
        result: failed.length === 0 ? 'PASS' : 'FAIL',
        fails,
      });
    }
  } finally {
    // Keep work dir contents out of the image layer; remove temp tree.
    try {
      rmSync(work, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  console.log('\n======== Matrix summary ========');
  console.log('fixture\tlang\tresult');
  for (const row of table) {
    console.log(`${row.fixture}\t${row.lang}\t${row.result}`);
    if (row.fails.length) {
      for (const f of row.fails) console.log(`  - ${f}`);
    }
  }

  const failedRows = table.filter((r) => r.result === 'FAIL');
  const failedAsserts = allResults.filter((r) => !r.ok);
  if (failedRows.length || failedAsserts.length) {
    console.error(
      `\n${failedAsserts.length} assertion(s) failed across ${failedRows.length} fixture(s).`
    );
    process.exitCode = 1;
    return;
  }
  console.log('\nAll fixtures passed.');
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

await main(args);
