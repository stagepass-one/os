import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { renderSiteBlock } from '../caddyfile.js';

function dockerAvailable() {
  try {
    execFileSync('docker', ['info'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function caddyAdapt(caddyfileContents) {
  // Stream the Caddyfile via stdin. Do not bind-mount: on Docker-outside-of-Docker
  // the daemon resolves -v paths on the host, where the runner/tmp path does not exist.
  const json = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-i',
      'caddy:2-alpine',
      'sh',
      '-c',
      'cat > /tmp/Caddyfile && caddy adapt --config /tmp/Caddyfile --adapter caddyfile',
    ],
    { encoding: 'utf-8', input: caddyfileContents }
  );
  return JSON.parse(json);
}

const describeAdapt = dockerAvailable() ? describe : describe.skip;

describeAdapt('caddy adapt integration (optional)', () => {
  it(
    'adapts default allowlist and allow-all blocks',
    () => {
      const allowlist = renderSiteBlock('app.sp', '/srv/app', {
        allowAllOrigins: false,
        origins: ['example.com'],
      });
      const allowAll = renderSiteBlock('open.sp', '/srv/open', {
        allowAllOrigins: true,
      });
      const withQuote = renderSiteBlock('q.sp', '/srv/My "App"', {});

      const adapted = caddyAdapt(`${allowlist}\n\n${allowAll}\n\n${withQuote}\n`);
      expect(adapted).toHaveProperty('apps.http');
      const encoded = JSON.stringify(adapted);
      expect(encoded).toMatch(/404/);
      expect(encoded).toMatch(/Access-Control-Allow-Origin/);
      expect(encoded).toMatch(/Access-Control-Allow-Private-Network/);
    },
    180000
  );
});
