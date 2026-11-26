#!/usr/bin/env node
/**
 * Assertion helpers for the upgrade fixture matrix.
 * Each check prints PASS/FAIL with the fixture label.
 */

/**
 * @typedef {{ name: string, ok: boolean, detail?: string }} AssertionResult
 */

/**
 * @param {string} fixture
 * @param {string} name
 * @param {boolean} ok
 * @param {string} [detail]
 * @returns {AssertionResult}
 */
export function check(fixture, name, ok, detail = '') {
  const label = `[${fixture}] ${name}`;
  if (ok) {
    console.log(`PASS ${label}${detail ? `: ${detail}` : ''}`);
  } else {
    console.error(`FAIL ${label}${detail ? `: ${detail}` : ''}`);
  }
  return { name: label, ok, detail };
}

/**
 * Infra doctor check ids that are expected to fail/warn inside a bare Linux
 * Docker image (no Homebrew, Caddy, dnsmasq, LaunchAgents, or linked sites).
 */
export const EXPECTED_DOCTOR_FAIL_IDS = new Set([
  'homebrew',
  'caddy',
  'php',
  'dnsmasq',
  'resolver',
  'port443',
  'caddyfile',
  'projects',
  'certs.root',
  'certs.trust',
  'certs.orphans',
  'certs.handshake',
  'autostart',
  'autostart.paths',
  'autostart.node',
  'autostart.version',
]);

/**
 * Project-related doctor checks that must not fail after a successful upgrade.
 * Warns are allowed (e.g. project.site skipped / unreachable).
 */
export const PROJECT_DOCTOR_IDS = new Set([
  'cdn',
  'cdn.project',
  'project.config',
  'project.modules',
  'project.cursor',
  'project.php',
  'project.site',
  'project.site.modules',
  'project',
]);

/**
 * @param {string} fixture
 * @param {{ checks?: Array<{ id: string, status: string, message?: string }> }} report
 * @returns {AssertionResult[]}
 */
export function assertDoctorProjectClean(fixture, report) {
  /** @type {AssertionResult[]} */
  const results = [];
  const checks = Array.isArray(report?.checks) ? report.checks : [];
  results.push(
    check(fixture, 'doctor-json-parseable', checks.length > 0, `${checks.length} checks`)
  );

  const unexpectedFails = checks.filter(
    (c) =>
      c.status === 'fail' &&
      !EXPECTED_DOCTOR_FAIL_IDS.has(c.id) &&
      (PROJECT_DOCTOR_IDS.has(c.id) || String(c.id).startsWith('project.'))
  );
  results.push(
    check(
      fixture,
      'doctor-no-unexpected-project-fail',
      unexpectedFails.length === 0,
      unexpectedFails.length
        ? unexpectedFails.map((c) => `${c.id}:${c.message || ''}`).join('; ')
        : 'ok'
    )
  );

  const modules = checks.find((c) => c.id === 'project.modules');
  if (modules) {
    results.push(
      check(
        fixture,
        'doctor-project-modules',
        modules.status === 'ok' || modules.status === 'warn',
        `${modules.status}: ${modules.message || ''}`
      )
    );
  }

  const cdnProject = checks.find((c) => c.id === 'cdn.project');
  if (cdnProject) {
    results.push(
      check(
        fixture,
        'doctor-cdn-project',
        cdnProject.status === 'ok' || cdnProject.status === 'warn',
        `${cdnProject.status}: ${cdnProject.message || ''}`
      )
    );
  }

  return results;
}
