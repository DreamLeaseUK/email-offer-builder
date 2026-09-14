/**
 * CAP ID guard — brief §2, §5.3.
 * DreamLease rule: CAP IDs are never stored. The website's vehicle image URLs carry one
 * (`images.motorleaseplatform.com/cvd/?...capId=<id>...`). Every object that is about to be
 * persisted, cached or logged goes through assertNoCapId() first.
 */

const LEAK_PATTERNS: ReadonlyArray<RegExp> = [
  /capid/i,
  /images\.motorleaseplatform\.com/i,
];

/** Returns the first matching fragment, or null if the value is clean. */
export function findCapIdLeak(value: unknown): string | null {
  const serialised = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  for (const pattern of LEAK_PATTERNS) {
    const match = serialised.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export class CapIdLeakError extends Error {
  constructor(context: string, fragment: string) {
    super(`CAP ID leak in ${context}: matched "${fragment}"`);
    this.name = 'CapIdLeakError';
  }
}

/** Throws if the value, serialised, contains anything that looks like a CAP ID or a source image URL. */
export function assertNoCapId(value: unknown, context = 'object'): void {
  const leak = findCapIdLeak(value);
  if (leak) throw new CapIdLeakError(context, leak);
}
