/**
 * Is this request served on this laptop (wrangler dev) rather than by the live Worker? Either it is addressed to
 * localhost, or its caller is: wrangler dev reports a loopback caller even when it presents a custom domain as the
 * host. On the live site neither can be true, because Cloudflare sets CF-Connecting-IP to the real caller and
 * overwrites anything sent. From the house template (dl-devkit), 24 Sept 2026.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const LOOPBACK_CALLERS = new Set(['127.0.0.1', '::1']);

export const isThisLaptop = (url: string, caller: string | undefined): boolean =>
  LOCAL_HOSTS.has(new URL(url).hostname) || LOOPBACK_CALLERS.has(caller ?? '');
