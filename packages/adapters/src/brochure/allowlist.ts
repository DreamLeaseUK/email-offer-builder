/**
 * Manufacturer UK domain allowlist — brief §5.8 step 5. Entries are hosts ("kia.co.uk") or a host
 * plus a path prefix ("volvocars.com/uk"). A brochure is only auto-attached from one of them.
 */

export interface AllowlistMatch {
  entry: string;
  host: string;
}

function splitEntry(entry: string): { host: string; prefix: string } {
  const [host = '', ...rest] = entry.toLowerCase().split('/');
  const prefix = rest.join('/').replace(/\/+$/, '');
  return { host, prefix };
}

/** The allowlist entry the URL falls under, or null. */
export function matchAllowlist(url: string, allowlist: string[]): AllowlistMatch | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  for (const entry of allowlist) {
    const { host: h, prefix } = splitEntry(entry);
    if (!h) continue;
    const hostOk = host === h || host.endsWith(`.${h}`);
    if (!hostOk) continue;
    if (prefix && !(path === `/${prefix}` || path.startsWith(`/${prefix}/`))) continue;
    return { entry, host };
  }
  return null;
}

export const isAllowlisted = (url: string, allowlist: string[]): boolean => matchAllowlist(url, allowlist) !== null;

const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/** Aliases for makes whose UK site is not simply <make>.co.uk. Keys are letters-only makes. */
const MAKE_ALIASES: Record<string, string> = {
  cupra: 'cupraofficial',
  volvo: 'volvocars',
  landrover: 'landrover',
  mercedes: 'mercedesbenz',
  mercedesbenz: 'mercedesbenz',
  jaecoo: 'omodajaecoo',
  omoda: 'omodajaecoo',
  gwmora: 'ora',
  gwm: 'ora',
};

/** The allowlist entry for a make ("Kia" -> "kia.co.uk"), or undefined when the make is not listed. */
export function manufacturerEntry(make: string, allowlist: string[]): string | undefined {
  const m = letters(make);
  if (!m) return undefined;
  const wanted = MAKE_ALIASES[m] ?? m;
  const candidates = allowlist.map((entry) => ({ entry, label: letters(splitEntry(entry).host.split('.')[0] ?? '') }));
  return candidates.find((c) => c.label === wanted)?.entry ?? candidates.find((c) => c.label.startsWith(wanted) || wanted.startsWith(c.label))?.entry;
}

/** A browsable URL for an allowlist entry, for `map`. */
export function entryUrl(entry: string): string {
  const { host, prefix } = splitEntry(entry);
  const h = host.startsWith('www.') ? host : `www.${host}`;
  return `https://${h}/${prefix ? `${prefix}/` : ''}`;
}
