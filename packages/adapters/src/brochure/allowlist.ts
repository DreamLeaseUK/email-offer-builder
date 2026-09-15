/**
 * Manufacturer UK domain allowlist — brief §5.8 step 5. An entry is a host ("bmw.co.uk"), a host plus
 * a leading path prefix ("volvocars.com/uk"), or a bare global host ("kia.com") whose UK content is
 * recognised by a /uk|/gb|/en-gb path segment (many OEMs serve UK brochures from a global domain, e.g.
 * kia.com/content/dam/.../uk/en/...). A brochure is only auto-attached from one of these.
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

/** A UK TLD is UK by definition; a global host (.com/.net) needs a UK segment in the path. */
const isUkTld = (host: string): boolean => host.endsWith('.co.uk') || host.endsWith('.uk');
const UK_PATH_SEGMENTS = ['uk', 'gb', 'en-gb', 'en_gb', 'uk-en', 'en-uk'];
const hasUkPathSegment = (path: string): boolean => path.split('/').some((seg) => UK_PATH_SEGMENTS.includes(seg));

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
    if (prefix) {
      // Explicit leading path prefix, e.g. volvocars.com/uk, tesla.com/en_gb.
      if (path === `/${prefix}` || path.startsWith(`/${prefix}/`)) return { entry, host };
      continue;
    }
    // Bare host: a UK TLD matches any path; a global host (e.g. kia.com) must carry a UK path segment
    // somewhere, so its UK brochures match but its /eu and /us content does not.
    if (isUkTld(h) || hasUkPathSegment(path)) return { entry, host };
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
  omoda: 'omodaauto',
  gwm: 'gwmcars',
  gwmora: 'gwmcars',
  ora: 'gwmcars',
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
