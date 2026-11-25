/**
 * CORS origin allowlist helpers.
 *
 * Default patterns (anchored, case-insensitive):
 * - https://*.sp
 * - http(s)://localhost[:port]
 * - http(s)://127.0.0.1[:port]
 * - per-project live hostnames / *.wildcards / https:// origins
 *   (including explicit `*.webflow.io` when passed via --origin)
 */

const UNSAFE_ORIGIN_RE = /[\s#"'{}$\\;()[\],<>|/]/;
const HOSTNAME_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
/** Whitespace (incl. Unicode) or C0/DEL controls; reject on the raw CLI string before trim/URL parse. */
const HOST_WHITESPACE_OR_CONTROL_RE = /[\s\x00-\x1f\x7f]/;
export const HOST_WHITESPACE_ERROR =
  'Host must not contain whitespace or control characters.';
export const ORIGIN_PORT_ERROR =
  'Origin allowlist is hostname-only (https, no port). Omit the port or use the default https port :443.';

/**
 * Reject hosts / site inputs that contain whitespace or control characters.
 * Call on the raw string before any trim or `new URL()`.
 *
 * @param {unknown} input
 * @param {string} [label]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function rejectWhitespaceOrControls(input, label = 'Host') {
  const raw = String(input == null ? '' : input);
  if (HOST_WHITESPACE_OR_CONTROL_RE.test(raw)) {
    return {
      ok: false,
      error: `${label} must not contain whitespace or control characters.`,
    };
  }
  return { ok: true };
}

/** Built-in Origin regex alternatives (without leading ^ / trailing $ / (?i)). */
export const DEFAULT_ORIGIN_ALTERNATIVES = Object.freeze([
  'https://([a-z0-9-]+\\.)*[a-z0-9-]+\\.sp',
  'https?://localhost(:[0-9]{1,5})?',
  'https?://127\\.0\\.0\\.1(:[0-9]{1,5})?',
]);

/**
 * Broad Webflow wildcards that allow any Webflow user's site.
 * Allowed when passed explicitly via --origin, but deserve a warning.
 *
 * @param {string} entry - validated origin entry
 * @returns {boolean}
 */
export function isBroadWebflowWildcard(entry) {
  return entry === '*.webflow.io' || entry === '*.webflow.com';
}

/**
 * Strip a pasted URL (or bare host with path/port) down to a hostname candidate.
 * http(s) only; keeps a leading `*.` wildcard; strips path/query/fragment;
 * strips default HTTPS port `:443` and rejects any other port.
 *
 * @param {string} input Lowercased raw string (no whitespace/controls).
 * @returns {{ ok: true, host: string } | { ok: false, error: string }}
 */
function extractOriginHostname(input) {
  let raw = input;

  if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) {
    if (raw.startsWith('https://')) {
      raw = raw.slice('https://'.length);
    } else if (raw.startsWith('http://')) {
      // Input convenience only; stored allowlist entries remain https origins.
      raw = raw.slice('http://'.length);
    } else {
      return {
        ok: false,
        error: 'Origin must use http:// or https:// (or a bare hostname).',
      };
    }
  }

  if (raw.includes('@')) {
    return { ok: false, error: 'Origin must not contain credentials.' };
  }

  // Host only: drop path, query, and fragment (including a trailing slash).
  const hostPart = raw.split(/[/?#]/, 1)[0];
  if (!hostPart) {
    return { ok: false, error: 'Origin entry is empty.' };
  }

  // Ports: allow stripping the default HTTPS port; reject any other.
  const lastColon = hostPart.lastIndexOf(':');
  if (lastColon !== -1) {
    // IPv6 is out of scope; a colon means an explicit port on a hostname.
    const maybePort = hostPart.slice(lastColon + 1);
    if (/^\d+$/.test(maybePort)) {
      if (maybePort === '443') {
        return { ok: true, host: hostPart.slice(0, lastColon) };
      }
      return { ok: false, error: ORIGIN_PORT_ERROR };
    }
    return {
      ok: false,
      error: 'Origin must be a hostname (optional leading *.), no path or port.',
    };
  }

  return { ok: true, host: hostPart };
}

/**
 * Validate a single live-domain / origin entry.
 * Accepts: example.com | www.example.com | *.example.com |
 * https://example.com[/…] | http://example.com[/…] (http is input-only).
 * Also accepts full Webflow staging hosts (my-project.webflow.io) and explicit
 * wildcards (*.webflow.io) when passed by the user.
 *
 * @param {string} input
 * @returns {{ ok: true, value: string, normalised?: boolean } | { ok: false, error: string }}
 */
export function validateOriginEntry(input) {
  if (typeof input !== 'string' || input === '') {
    return { ok: false, error: 'Origin entry is empty.' };
  }

  const ws = rejectWhitespaceOrControls(input, 'Origin');
  if (!ws.ok) return ws;

  const extracted = extractOriginHostname(input.toLowerCase());
  if (!extracted.ok) return extracted;

  let raw = extracted.host;

  let wildcard = false;
  if (raw.startsWith('*.')) {
    wildcard = true;
    raw = raw.slice(2);
  }

  if (!raw || raw.startsWith('.') || raw.endsWith('.') || raw.includes('..')) {
    return { ok: false, error: 'Invalid hostname in origin entry.' };
  }

  // After stripping protocol / wildcard, remaining must be safe hostname chars only
  if (UNSAFE_ORIGIN_RE.test(raw) || raw.includes('*')) {
    return { ok: false, error: 'Origin contains invalid characters.' };
  }

  const labels = raw.split('.');
  if (!labels.every((l) => HOSTNAME_LABEL_RE.test(l))) {
    return { ok: false, error: 'Origin hostname labels are not DNS-safe.' };
  }

  const value = wildcard ? `*.${raw}` : raw;
  const normalised = value !== input.toLowerCase();
  return normalised ? { ok: true, value, normalised: true } : { ok: true, value };
}

/**
 * @param {string[]} entries
 * @returns {{ ok: true, origins: string[], normalised: string[] } | { ok: false, error: string }}
 */
export function validateOriginList(entries) {
  const out = [];
  const normalised = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const result = validateOriginEntry(entry);
    if (!result.ok) return result;
    if (result.normalised && !normalised.includes(result.value)) {
      normalised.push(result.value);
    }
    if (!seen.has(result.value)) {
      seen.add(result.value);
      out.push(result.value);
    }
  }
  return { ok: true, origins: out, normalised };
}

/**
 * Escape a hostname for use inside a RE2 / Caddy regex (dots only; labels already validated).
 * @param {string} hostname
 */
export function escapeHostnameForRegex(hostname) {
  return hostname.replace(/\./g, '\\.');
}

/**
 * Convert a stored origin entry into a regex alternative matching https://...
 * @param {string} entry - validated hostname or *.hostname
 */
export function originEntryToRegexAlternative(entry) {
  if (entry.startsWith('*.')) {
    const host = escapeHostnameForRegex(entry.slice(2));
    return `https://([a-z0-9-]+\\.)*${host}`;
  }
  return `https://${escapeHostnameForRegex(entry)}`;
}

/**
 * Full Origin header regex for Caddy header_regexp (includes (?i) and anchors).
 * @param {string[]} [customOrigins]
 */
export function buildOriginAllowlistRegex(customOrigins = []) {
  const validated = validateOriginList(customOrigins);
  const customs = validated.ok ? validated.origins : [];
  const parts = [
    ...DEFAULT_ORIGIN_ALTERNATIVES,
    ...customs.map(originEntryToRegexAlternative),
  ];
  return `(?i)^(?:${parts.join('|')})$`;
}

/**
 * Whether a browser Origin would match the allowlist (for unit tests).
 * Note: Caddy/RE2 accepts (?i) inline; JS RegExp needs the `i` flag instead.
 * @param {string} origin
 * @param {string[]} [customOrigins]
 */
export function originMatchesAllowlist(origin, customOrigins = []) {
  try {
    let pattern = buildOriginAllowlistRegex(customOrigins);
    let flags = '';
    if (pattern.startsWith('(?i)')) {
      pattern = pattern.slice(4);
      flags = 'i';
    }
    return new RegExp(pattern, flags).test(origin);
  } catch {
    return false;
  }
}
