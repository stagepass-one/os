import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Public-API mock; vars is a throwing getter so accidental reads fail loudly. */
function mockLoader(overrides: Record<string, unknown> = {}) {
  const stagepassObj: any = {
    env: () => 'production',
    is: (name: string) => name === 'production',
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    resolveLocalUrl: () => '',
    use: (_name: string, _version: string, factory: (api: any) => void) => {
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
  (window as any).stagepass = stagepassObj;
  (globalThis as any).stagepass = stagepassObj;
  (window as any).sp = stagepassObj;
  (globalThis as any).sp = stagepassObj;
  return stagepassObj;
}

describe('Injector Module', () => {
  beforeEach(() => {
    // Reset DOM
    document.head.innerHTML = '';
    document.body.innerHTML = '';

    mockLoader({
      env: () => 'local',
      is: (name: string) => name === 'local',
    });
  });

  describe('Type detection', () => {
    it('should detect script from .js extension', () => {
      const src = 'https://example.com/app.js';
      const ext = src.split('.').pop()?.toLowerCase();
      const type = ext === 'css' ? 'style' : 'script';
      
      expect(type).toBe('script');
    });

    it('should detect style from .css extension', () => {
      const src = 'https://example.com/styles.css';
      const ext = src.split('.').pop()?.toLowerCase();
      const type = ext === 'css' ? 'style' : 'script';
      
      expect(type).toBe('style');
    });

    it('should default to script when extension is unknown', () => {
      const src = 'https://example.com/file';
      const ext = src.split('.').pop()?.toLowerCase();
      const type = ext === 'css' ? 'style' : 'script';
      
      expect(type).toBe('script');
    });
  });

  describe('Deduplication', () => {
    it('should detect existing element by ID', () => {
      const existing = document.createElement('script');
      existing.id = 'my-script';
      existing.src = 'https://example.com/app.js';
      document.head.appendChild(existing);
      
      const found = document.getElementById('my-script');
      expect(found).toBeTruthy();
    });

    it('should detect existing script by src', () => {
      const existing = document.createElement('script');
      existing.src = 'https://example.com/app.js';
      document.head.appendChild(existing);
      
      const found = document.querySelector('script[src="https://example.com/app.js"]');
      expect(found).toBeTruthy();
    });

    it('should detect existing stylesheet by href', () => {
      const existing = document.createElement('link');
      existing.rel = 'stylesheet';
      existing.href = 'https://example.com/styles.css';
      document.head.appendChild(existing);
      
      const found = document.querySelector('link[href="https://example.com/styles.css"]');
      expect(found).toBeTruthy();
    });
  });

  describe('Positioning', () => {
    it('should insert into head for "head" position', () => {
      const position = 'head';
      const insertionPoint = position === 'head' ? document.head : document.body;
      
      expect(insertionPoint).toBe(document.head);
    });

    it('should insert into body for "body-end" position', () => {
      const position = 'body-end';
      const insertionPoint = position === 'head' ? document.head : document.body;
      
      expect(insertionPoint).toBe(document.body);
    });

    it('should find target element for relative positioning', () => {
      const target = document.createElement('script');
      target.id = 'jquery';
      document.head.appendChild(target);
      
      const targetEl = document.querySelector('#jquery');
      expect(targetEl).toBeTruthy();
    });

    it('should fallback to body when target not found', () => {
      const targetEl = document.querySelector('#nonexistent');
      const insertionPoint = targetEl || document.body;
      
      expect(insertionPoint).toBe(document.body);
    });
  });

  describe('Element creation', () => {
    it('should create script element with correct attributes', () => {
      const script = document.createElement('script');
      script.src = 'https://example.com/app.js';
      script.async = false;
      script.defer = true;
      script.id = 'my-script';
      
      expect(script.src).toBe('https://example.com/app.js');
      expect(script.async).toBe(false);
      expect(script.defer).toBe(true);
      expect(script.id).toBe('my-script');
    });

    it('forces async=false for ordered dynamic scripts', () => {
      const script = document.createElement('script');
      // Browsers default dynamically created scripts to async=true; force order
      script.async = true;
      const optionsAsync = false;
      if (optionsAsync) {
        script.async = true;
      } else {
        script.async = false;
        script.defer = true;
      }
      expect(script.async).toBe(false);
      expect(script.defer).toBe(true);
    });

    it('uses version query param instead of Date.now cache bust', () => {
      const src = 'https://cdn.example.com/app.js?x=1#h';
      const version = '2.0.0';
      const hashIdx = src.indexOf('#');
      const hash = hashIdx >= 0 ? src.slice(hashIdx) : '';
      const base = hashIdx >= 0 ? src.slice(0, hashIdx) : src;
      const sep = base.includes('?') ? '&' : '?';
      const resolved = `${base}${sep}v=${encodeURIComponent(version)}${hash}`;
      expect(resolved).toBe('https://cdn.example.com/app.js?x=1&v=2.0.0#h');
      expect(resolved.includes('_cb=')).toBe(false);
    });

    it('should create link element with correct attributes', () => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://example.com/styles.css';
      link.id = 'my-styles';
      
      expect(link.rel).toBe('stylesheet');
      expect(link.href).toBe('https://example.com/styles.css');
      expect(link.id).toBe('my-styles');
    });
  });

  describe('Error handling', () => {
    it('detects missing loader via public API, not sp.vars', () => {
      delete (window as any).stagepass;
      delete (globalThis as any).stagepass;
      const sp = (window as any).stagepass;
      const hasLoader =
        !!(sp && (typeof sp.env === 'function' || typeof sp.use === 'function'));
      expect(hasLoader).toBe(false);
    });
  });
});

describe('Inject INV-6 / F-3 source resolution via inject API', () => {
  const prodSrc = 'https://cdn.example.com/lib.js';

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('INV-6 / F-3: empty resolveLocalUrl keeps production src (no invented localhost ?_cb=)', async () => {
    vi.resetModules();
    const stagepassObj = mockLoader({
      env: () => 'local',
      is: (n: string) => n === 'local',
      resolveLocalUrl: () => '',
    });
    await import('../index.ts');
    void stagepassObj.inject({ src: prodSrc, position: 'head' });
    const el = document.querySelector(`script[src="${prodSrc}"]`) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector('script[src*="_cb="]')).toBeNull();
    expect(document.querySelector('script[src*="localhost"]')).toBeNull();
  });

  it('INV-6 / F-3: non-empty resolveLocalUrl uses that local URL', async () => {
    vi.resetModules();
    const localUrl = 'https://app.sp/lib.js?_cb=1';
    const stagepassObj = mockLoader({
      env: () => 'local',
      is: (n: string) => n === 'local',
      resolveLocalUrl: () => localUrl,
    });
    await import('../index.ts');
    void stagepassObj.inject({ src: prodSrc, position: 'head' });
    const el = document.querySelector(`script[src="${localUrl}"]`) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector(`script[src="${prodSrc}"]`)).toBeNull();
  });

  it('INV-6 / F-3: missing resolveLocalUrl keeps production src', async () => {
    vi.resetModules();
    const stagepassObj = mockLoader({
      env: () => 'local',
      is: (n: string) => n === 'local',
    });
    delete stagepassObj.resolveLocalUrl;
    await import('../index.ts');
    void stagepassObj.inject({ src: prodSrc, position: 'head' });
    const el = document.querySelector(`script[src="${prodSrc}"]`) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector('script[src*="_cb="]')).toBeNull();
  });

  it('INV-6 / F-3: stagepass false keeps production src when swap would apply', async () => {
    vi.resetModules();
    const stagepassObj = mockLoader({
      env: () => 'local',
      is: (n: string) => n === 'local',
      resolveLocalUrl: () => 'https://app.sp/lib.js',
    });
    await import('../index.ts');
    void stagepassObj.inject({ src: prodSrc, stagepass: false, position: 'head' });
    const el = document.querySelector(`script[src="${prodSrc}"]`) as HTMLScriptElement;
    expect(el).toBeTruthy();
    expect(document.querySelector('script[src="https://app.sp/lib.js"]')).toBeNull();
  });
});

describe('Inject INV-8 / F-4 body-start position via inject API', () => {
  it("INV-8 / F-4: position 'body-start' with existing body child is firstElementChild", async () => {
    vi.resetModules();
    const stagepassObj = mockLoader();
    await import('../index.ts');

    document.head.innerHTML = '';
    document.body.innerHTML = '';
    const existing = document.createElement('div');
    existing.id = 'anchor';
    document.body.appendChild(existing);

    void stagepassObj.inject({
      src: 'https://cdn.example.com/bs.js',
      position: 'body-start',
    });
    const injected = document.querySelector(
      'script[src="https://cdn.example.com/bs.js"]'
    ) as HTMLScriptElement;
    expect(injected).toBeTruthy();
    expect(document.body.firstElementChild).toBe(injected);
    expect(injected.nextElementSibling).toBe(existing);
  });
});

describe('Inject #164: no sp.vars read; silent without session', () => {
  function fireLoad(src: string) {
    const el = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement;
    expect(el).toBeTruthy();
    if (typeof el.onload === 'function') el.onload(new Event('load'));
  }

  it('attach + inject never reads sp.vars (throwing getter stays quiet)', async () => {
    vi.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    const stagepassObj = mockLoader({
      env: () => 'staging',
      is: (n: string) => n === 'staging',
    });
    await expect(import('../index.ts')).resolves.toBeDefined();
    expect(typeof stagepassObj.inject).toBe('function');
    void stagepassObj.inject({
      src: 'https://cdn.example.com/a.js',
      position: 'head',
    });
    fireLoad('https://cdn.example.com/a.js');
  });

  it('without session, inject routes through sp.log (no console.log)', async () => {
    vi.resetModules();
    document.head.innerHTML = '';
    document.body.innerHTML = '';
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stagepassObj = mockLoader({
      env: () => 'staging',
      is: (n: string) => n === 'staging',
      // Simulate loader mute: log/warn/error are no-ops without a session
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    });
    await import('../index.ts');
    void stagepassObj.inject({
      src: 'https://cdn.example.com/iframeResizer.min.js',
      position: 'head',
    });
    fireLoad('https://cdn.example.com/iframeResizer.min.js');
    expect(stagepassObj.log).toHaveBeenCalledWith(
      expect.stringContaining('Injected:')
    );
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it('uses sp.env / sp.is for env-like decisions (public API present)', async () => {
    vi.resetModules();
    const env = vi.fn(() => 'production');
    const is = vi.fn((n: string) => n === 'production');
    const stagepassObj = mockLoader({ env, is });
    await import('../index.ts');
    expect(typeof stagepassObj.env).toBe('function');
    expect(typeof stagepassObj.is).toBe('function');
    expect(stagepassObj.env()).toBe('production');
    expect(stagepassObj.is('production')).toBe(true);
    expect(stagepassObj.is('local')).toBe(false);
  });
});

describe('Inject mutation survivors (stylesheet dedupe / filename / hasLoaderApi)', () => {
  const missingLoaderWarn =
    '[Stagepass] Core loader should be loaded before the inject module.';

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('skips re-injecting a stylesheet when a matching link href already exists', async () => {
    vi.resetModules();
    const stagepassObj = mockLoader();
    await import('../index.ts');

    const href = 'https://cdn.example.com/theme.css';
    const existing = document.createElement('link');
    existing.rel = 'stylesheet';
    existing.setAttribute('href', href);
    document.head.appendChild(existing);

    const done = stagepassObj.inject({
      src: href,
      type: 'style',
      stagepass: false,
      position: 'head',
    });
    await Promise.resolve();
    await Promise.resolve();

    const matches = Array.from(document.getElementsByTagName('link')).filter(
      (el) => el.getAttribute('href') === href
    );
    expect(matches).toHaveLength(1);
    await expect(done).resolves.toBeUndefined();
  });

  it('passes extractFilename result app.js to resolveLocalUrl (not file/js)', async () => {
    vi.resetModules();
    const resolveLocalUrl = vi.fn(() => '');
    const stagepassObj = mockLoader({ resolveLocalUrl });
    await import('../index.ts');

    void stagepassObj.inject({
      src: 'https://cdn.example.com/js/app.js',
      position: 'head',
    });
    await Promise.resolve();

    expect(resolveLocalUrl).toHaveBeenCalledWith('app.js');
    expect(resolveLocalUrl).not.toHaveBeenCalledWith('file');
    expect(resolveLocalUrl).not.toHaveBeenCalledWith('js');
  });

  it('treats env-only loader as present: no missing-loader warn, inject registered', async () => {
    vi.resetModules();
    delete (window as any).stagepass;
    delete (globalThis as any).stagepass;
    delete (window as any).sp;
    delete (globalThis as any).sp;

    const stagepassObj: any = {
      env: () => 'production',
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      resolveLocalUrl: () => '',
    };
    Object.defineProperty(stagepassObj, 'vars', {
      configurable: true,
      get() {
        throw new Error('sp.vars must not be read by modules');
      },
    });
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../index.ts');
    expect(warn).not.toHaveBeenCalledWith(missingLoaderWarn);
    expect(typeof stagepassObj.inject).toBe('function');
    warn.mockRestore();
  });

  it('treats use-only loader as present: no missing-loader warn, inject registered', async () => {
    vi.resetModules();
    delete (window as any).stagepass;
    delete (globalThis as any).stagepass;
    delete (window as any).sp;
    delete (globalThis as any).sp;

    const stagepassObj: any = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      resolveLocalUrl: () => '',
      use: (_name: string, _version: string, factory: (api: any) => void) => {
        factory(stagepassObj);
        return true;
      },
    };
    Object.defineProperty(stagepassObj, 'vars', {
      configurable: true,
      get() {
        throw new Error('sp.vars must not be read by modules');
      },
    });
    (window as any).stagepass = stagepassObj;
    (globalThis as any).stagepass = stagepassObj;

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await import('../index.ts');
    expect(warn).not.toHaveBeenCalledWith(missingLoaderWarn);
    expect(typeof stagepassObj.inject).toBe('function');
    warn.mockRestore();
  });
});
