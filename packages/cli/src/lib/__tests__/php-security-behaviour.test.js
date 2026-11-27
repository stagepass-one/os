import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../../..');
const script = 'packages/cli/src/lib/__tests__/php-security-behaviour.php';
const templates = 'packages/cli/templates/project';

function canRun(command, args) {
  try {
    execFileSync(command, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const hasPhp = canRun('php', ['-r', 'echo PHP_VERSION;']);
const hasDocker = !hasPhp && canRun('docker', ['info']);

describe.skipIf(!hasPhp && !hasDocker)('php security behaviour', () => {
  it('rate limit storage faults and trusted proxy client IPs', () => {
    const out = hasPhp
      ? execFileSync('php', [path.join(repoRoot, script)], { encoding: 'utf8' })
      : (() => {
          // Stream files via tar stdin. Do not bind-mount: on Docker-outside-of-Docker
          // the daemon resolves -v paths on the host, where the runner path does not exist.
          const archive = execFileSync('tar', ['-cf', '-', '-C', repoRoot, script, templates]);
          return execFileSync(
            'docker',
            [
              'run',
              '--rm',
              '-i',
              '-w',
              '/src',
              'php:8.2-cli',
              'sh',
              '-c',
              `mkdir -p /src && tar -xf - -C /src && php ${script}`,
            ],
            { encoding: 'utf8', timeout: 120000, input: archive }
          );
        })();
    expect(out).toContain('php-security: ok');
  }, 180000);
});
