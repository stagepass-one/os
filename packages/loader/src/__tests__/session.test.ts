import { describe, it, expect } from 'vitest';
import {
  parseSession,
  createSession,
  serializeSession,
  parseSessionHours,
  DEFAULT_SESSION_HOURS,
} from '../session.js';

describe('session expiry', () => {
  const now = 1_700_000_000_000;

  it('creates a session with default 12h expiry', () => {
    const record = createSession('test.sp', DEFAULT_SESSION_HOURS, now);
    expect(record.domain).toBe('test.sp');
    expect(record.expires).toBe(now + 12 * 60 * 60 * 1000);
  });

  it('honours a positive custom lifetime and falls back for 0 / negative / NaN', () => {
    expect(createSession('app.sp', 2, now).expires).toBe(now + 2 * 60 * 60 * 1000);
    expect(createSession('app.sp', 0, now).expires).toBe(now + 12 * 60 * 60 * 1000);
    expect(createSession('app.sp', -3, now).expires).toBe(now + 12 * 60 * 60 * 1000);
    expect(createSession('app.sp', Number.NaN, now).expires).toBe(now + 12 * 60 * 60 * 1000);
  });

  it('parses valid JSON sessions', () => {
    const raw = serializeSession(createSession('app.sp', 2, now));
    expect(parseSession(raw, now + 1000)?.domain).toBe('app.sp');
    expect(parseSession(raw, now + 1000)?.expires).toBe(now + 2 * 60 * 60 * 1000);
  });

  it('clears expired, legacy, and malformed values', () => {
    expect(parseSession('test.sp', now)).toBe(null);
    expect(parseSession('{not-json', now)).toBe(null);
    expect(
      parseSession(JSON.stringify({ domain: 'test.sp', expires: now - 1 }), now)
    ).toBe(null);
    // Expires exactly at `now` is already stale (`expires <= now`).
    expect(
      parseSession(JSON.stringify({ domain: 'test.sp', expires: now }), now)
    ).toBe(null);
    // JSON has no Infinity/NaN; 1e309 parses to Infinity and must still be rejected.
    expect(parseSession('{"domain":"test.sp","expires":1e309}', now)).toBe(null);
    expect(parseSession('{"domain":"test.sp","expires":null}', now)).toBe(null);
    expect(
      parseSession(JSON.stringify({ domain: 'evil.com', expires: now + 9999 }), now)
    ).toBe(null);
  });

  it('parses session hours attribute', () => {
    expect(parseSessionHours(null)).toBe(12);
    expect(parseSessionHours('')).toBe(12);
    expect(parseSessionHours('24')).toBe(24);
    expect(parseSessionHours('0')).toBe(12);
    expect(parseSessionHours('-1')).toBe(12);
    expect(parseSessionHours('nope')).toBe(12);
  });
});
