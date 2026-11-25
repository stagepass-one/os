import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadMaintenance(sp: any) {
  vi.resetModules();
  (window as any).stagepass = sp;
  (globalThis as any).stagepass = sp;
  (window as any).sp = sp;
  (globalThis as any).sp = sp;
  await import('../index.ts');
}

describe('Maintenance module', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    localStorage.clear();
    delete (window as any).stagepass;
    delete (globalThis as any).stagepass;
    delete (window as any).sp;
    delete (globalThis as any).sp;
    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      get: () => null,
    });
  });

  function mockSp(overrides: Record<string, unknown> = {}) {
    const stagepassObj: any = {
      env: () => 'production',
      is: () => false,
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      use: (_n: string, _v: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
      ...overrides,
    };
    Object.defineProperty(stagepassObj, 'vars', {
      configurable: true,
      get() {
        throw new Error('sp.vars must not be read by modules');
      },
    });
    return stagepassObj;
  }

  it('registers enable/disable/isActive and shows overlay for visitors', async () => {
    const stagepassObj = mockSp();
    await loadMaintenance(stagepassObj);

    expect(stagepassObj.maintenance.isActive()).toBe(false);
    stagepassObj.maintenance.enable({
      title: 'We will be back soon',
      text: 'Maintenance in progress',
    });
    expect(stagepassObj.maintenance.isActive()).toBe(true);

    const overlay = document.getElementById('stagepass-maintenance-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay?.getAttribute('role')).toBe('alertdialog');
    expect(overlay?.textContent).toContain('We will be back soon');
    expect(overlay?.textContent).toContain('Maintenance in progress');
    expect(overlay?.innerHTML).not.toMatch(/<script/i);

    stagepassObj.maintenance.disable();
    expect(document.getElementById('stagepass-maintenance-overlay')).toBeNull();
    expect(stagepassObj.maintenance.isActive()).toBe(false);
  });

  it('shows a badge instead of overlay when a developer session is active', async () => {
    localStorage.setItem(
      'stagepass_domain',
      JSON.stringify({ domain: 'my-project.sp', expires: Date.now() + 1e8 })
    );
    const stagepassObj = mockSp({
      env: () => 'local',
      is: (n: string) => n === 'local',
    });
    await loadMaintenance(stagepassObj);
    stagepassObj.maintenance.enable({ title: 'Offline' });
    expect(document.getElementById('stagepass-maintenance-overlay')).toBeNull();
    const badge = document.getElementById('stagepass-maintenance-badge');
    expect(badge).toBeTruthy();
    expect(badge?.textContent).toContain('Offline');
  });

  it('auto-enables only when data-stagepass-maintenance="true"', async () => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@stagepass/modules@2/dist/maintenance.min.js';
    script.setAttribute('data-stagepass-maintenance', 'true');
    script.setAttribute('data-stagepass-maintenance-title', 'Closed');
    script.setAttribute('data-stagepass-maintenance-text', 'Try later');
    document.head.appendChild(script);
    Object.defineProperty(document, 'currentScript', {
      configurable: true,
      get: () => script,
    });

    const stagepassObj = mockSp();
    await loadMaintenance(stagepassObj);
    expect(stagepassObj.maintenance.isActive()).toBe(true);
    expect(document.getElementById('stagepass-maintenance-overlay')?.textContent).toContain(
      'Closed'
    );
  });

  it('warns without throwing when loader is missing', async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../index.ts');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('registers via public API without reading sp.vars', async () => {
    const stagepassObj = mockSp();
    await loadMaintenance(stagepassObj);
    expect(typeof stagepassObj.maintenance.enable).toBe('function');
    expect(typeof stagepassObj.env).toBe('function');
    expect(typeof stagepassObj.is).toBe('function');
  });

  it('enable() without options keeps last title/text; disable() does not reset them', async () => {
    const stagepassObj = mockSp();
    await loadMaintenance(stagepassObj);

    stagepassObj.maintenance.enable();
    expect(document.getElementById('stagepass-maintenance-title')?.textContent).toBe(
      'We will be back soon'
    );
    expect(document.getElementById('stagepass-maintenance-desc')?.textContent).toBe(
      'This site is temporarily unavailable while we perform maintenance.'
    );

    stagepassObj.maintenance.enable({ title: 'Zwei', text: 'Zwei-Text' });
    expect(document.getElementById('stagepass-maintenance-title')?.textContent).toBe('Zwei');
    expect(document.getElementById('stagepass-maintenance-desc')?.textContent).toBe('Zwei-Text');

    stagepassObj.maintenance.disable();
    expect(document.getElementById('stagepass-maintenance-overlay')).toBeNull();
    expect(stagepassObj.maintenance.isActive()).toBe(false);

    stagepassObj.maintenance.enable();
    expect(stagepassObj.maintenance.isActive()).toBe(true);
    expect(document.getElementById('stagepass-maintenance-title')?.textContent).toBe('Zwei');
    expect(document.getElementById('stagepass-maintenance-desc')?.textContent).toBe('Zwei-Text');
  });
  it('shows a badge for a localhost session even when sp.is is not local', async () => {
    localStorage.setItem(
      'stagepass_domain',
      JSON.stringify({ domain: 'localhost', expires: Date.now() + 1e8 })
    );
    const stagepassObj = mockSp({ is: () => false });
    await loadMaintenance(stagepassObj);
    stagepassObj.maintenance.enable({ title: 'Offline' });
    expect(document.getElementById('stagepass-maintenance-overlay')).toBeNull();
    expect(document.getElementById('stagepass-maintenance-badge')).toBeTruthy();
  });

  it('shows a badge for a localhost:port session even when sp.is is not local', async () => {
    localStorage.setItem(
      'stagepass_domain',
      JSON.stringify({ domain: 'localhost:3000', expires: Date.now() + 1e8 })
    );
    const stagepassObj = mockSp({ is: () => false });
    await loadMaintenance(stagepassObj);
    stagepassObj.maintenance.enable({ title: 'Offline' });
    expect(document.getElementById('stagepass-maintenance-overlay')).toBeNull();
    expect(document.getElementById('stagepass-maintenance-badge')).toBeTruthy();
  });

  it('auto-enables from the last all.min.js script when currentScript is absent', async () => {
    const first = document.createElement('script');
    first.src = 'https://cdn.example.com/all.min.js';
    document.head.appendChild(first);
    const last = document.createElement('script');
    last.src = 'https://cdn.example.com/all.min.js?v=2';
    last.setAttribute('data-stagepass-maintenance', 'true');
    last.setAttribute('data-stagepass-maintenance-title', 'All-bundle');
    document.head.appendChild(last);
    const stagepassObj = mockSp();
    await loadMaintenance(stagepassObj);
    expect(stagepassObj.maintenance.isActive()).toBe(true);
    expect(document.getElementById('stagepass-maintenance-overlay')?.textContent).toContain(
      'All-bundle'
    );
  });

});
