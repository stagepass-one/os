/**
 * Official loader/modules CDN.
 *
 * Default host is https://cdn.stagepass.one: major alias `@2` (short loader URL,
 * no `data-stagepass-version`). Exact pins (full file path + optional
 * `data-stagepass-version`) stay documented. jsDelivr remains an alternative
 * (npm package paths, major pin, `/dist/` segment). Do not recommend unpkg.
 */
export const STAGEPASS_CDN_ORIGIN = 'https://cdn.stagepass.one';
export const STAGEPASS_JSDELIVR_CDN = 'https://cdn.jsdelivr.net/npm';
/** Default package CDN origin (Stagepass CDN). Prefer stagepassPackageUrl(). */
export const STAGEPASS_PACKAGE_CDN = STAGEPASS_CDN_ORIGIN;

/**
 * Published npm versions for documented exact-pin examples (loader / modules).
 * Literals only: not read from the CLI package version, and not copied
 * automatically when the monorepo is ahead of npm.
 * Default generated snippets use {@link SNIPPET_MAJOR_PIN}, not these.
 */
export const SNIPPET_LOADER_VERSION = '2.5.1';
export const SNIPPET_MODULES_VERSION = '2.2.2';
export const SNIPPET_MAJOR_PIN = '@2';

/**
 * @param {unknown} raw
 * @returns {'stagepass' | 'jsdelivr' | null}
 */
export function normalizeCdnChoice(raw) {
  const v = String(raw == null ? '' : raw).trim().toLowerCase();
  if (v === 'stagepass') return 'stagepass';
  if (v === 'jsdelivr') return 'jsdelivr';
  return null;
}

/**
 * Pins used in generated Webflow snippets for a CDN host.
 * Stagepass CDN and jsDelivr both default to the major pin `@2`.
 * @param {unknown} [cdn]
 * @param {{ loaderVersion?: string, modulesVersion?: string, exact?: boolean }} [options]
 * @returns {{ cdn: 'stagepass' | 'jsdelivr', loaderPin: string, modulesPin: string }}
 */
export function defaultSnippetPins(cdn, options = {}) {
  const host = normalizeCdnChoice(cdn) || 'stagepass';
  if (host === 'jsdelivr' || options.exact !== true) {
    return {
      cdn: host,
      loaderPin: SNIPPET_MAJOR_PIN,
      modulesPin: SNIPPET_MAJOR_PIN,
    };
  }
  const loaderVersion = options.loaderVersion || SNIPPET_LOADER_VERSION;
  const modulesVersion = options.modulesVersion || SNIPPET_MODULES_VERSION;
  return {
    cdn: host,
    loaderPin: `@${loaderVersion}`,
    modulesPin: `@${modulesVersion}`,
  };
}

/**
 * @param {string} name Package short name (`loader` or `modules`)
 * @param {string} pin CDN pin including `@` (for example `@2` or `@2.5.0`)
 * @param {string} [file] File under the host path (`loader.min.js`). Omitted for
 *   the Stagepass CDN major-alias loader short URL (`/loader@2`).
 * @param {{ cdn?: string }} [options]
 * @returns {string}
 */
export function stagepassPackageUrl(name, pin, file, options = {}) {
  const cdn = normalizeCdnChoice(options.cdn) || 'stagepass';
  if (cdn === 'jsdelivr') {
    const distFile = file || (name === 'loader' ? 'loader.min.js' : `${name}.min.js`);
    return `${STAGEPASS_JSDELIVR_CDN}/@stagepass/${name}${pin}/dist/${distFile}`;
  }
  // Short major-alias form for the loader: /loader@2 (no /loader.min.js).
  if (
    pin === SNIPPET_MAJOR_PIN &&
    name === 'loader' &&
    (file == null || file === '' || file === 'loader.min.js')
  ) {
    return `${STAGEPASS_CDN_ORIGIN}/loader${pin}`;
  }
  if (!file) {
    return `${STAGEPASS_CDN_ORIGIN}/${name}${pin}`;
  }
  return `${STAGEPASS_CDN_ORIGIN}/${name}${pin}/${file}`;
}
