/**
 * What a browser adds to a request made by the tool's own page. Writes that are not JSON (uploads, deletes, POSTs
 * with no body) need it to pass the cross-site guard (hono/csrf in src/index.ts), exactly as they do in the browser.
 */
export const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' } as const;
