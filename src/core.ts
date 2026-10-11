import { parsePhoneNumberFromString } from 'libphonenumber-js';

/** E.164 for valid numbers (local UAE formats assumed), null otherwise. */
export function normalizePhone(raw: string, defaultCountry: 'AE' = 'AE'): string | null {
  const parsed = parsePhoneNumberFromString(raw.replace(/^00/, '+'), defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

/** start inclusive, end exclusive, both "HH:mm" in `timeZone`. */
export function isWithinCallingHours(
  now: Date,
  hours: { start: string; end: string } = { start: '09:00', end: '18:00' },
  timeZone = 'Asia/Dubai',
): boolean {
  const t = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return hours.start <= t && t < hours.end;
}

export function fillPrompt(
  template: string,
  vars: Record<string, string | null | undefined>,
  fallbacks: Record<string, string>,
): string {
  const missing = new Set<string>();
  const out = template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key] || fallbacks[key];
    if (!value) missing.add(key);
    return value ?? `{${key}}`;
  });
  if (missing.size) throw new Error(`Unfilled prompt variables: ${[...missing].join(', ')}`);
  return out;
}
