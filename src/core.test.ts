import { describe, it, expect } from 'vitest';
import { normalizePhone, isWithinCallingHours, fillPrompt } from './core.js';

describe('normalizePhone', () => {
  it.each(['050 123 4567', '0501234567', '+971 50 123 4567', '00971501234567'])('UAE %s', (raw) =>
    expect(normalizePhone(raw)).toBe('+971501234567'));
  it('keeps international numbers', () => expect(normalizePhone('+44 7911 123456')).toBe('+447911123456'));
  it.each(['', 'abc', '123', '+971 12'])('rejects %s', (raw) => expect(normalizePhone(raw)).toBeNull());
});

describe('isWithinCallingHours (Asia/Dubai = UTC+4, no DST)', () => {
  it('08:59 Dubai is outside', () => expect(isWithinCallingHours(new Date('2026-10-11T04:59:00Z'))).toBe(false));
  it('09:00 Dubai is inside (start inclusive)', () => expect(isWithinCallingHours(new Date('2026-10-11T05:00:00Z'))).toBe(true));
  it('17:59 Dubai is inside', () => expect(isWithinCallingHours(new Date('2026-10-11T13:59:00Z'))).toBe(true));
  it('18:00 Dubai is outside (end exclusive)', () => expect(isWithinCallingHours(new Date('2026-10-11T14:00:00Z'))).toBe(false));
  it('custom hours', () => expect(isWithinCallingHours(new Date('2026-10-11T16:30:00Z'), { start: '10:00', end: '21:00' })).toBe(true));
});

describe('fillPrompt', () => {
  it('fills vars and uses fallbacks for missing values', () =>
    expect(fillPrompt('Hi {name}, about {property}.', { name: 'Ali', property: '' }, { property: 'the property you enquired about' }))
      .toBe('Hi Ali, about the property you enquired about.'));
  it('throws on vars with neither value nor fallback', () =>
    expect(() => fillPrompt('{a} {b}', {}, {})).toThrow('Unfilled prompt variables: a, b'));
});
