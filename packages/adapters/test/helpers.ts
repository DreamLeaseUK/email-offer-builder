import { readFileSync } from 'node:fs';
import { HTMLRewriter } from 'htmlrewriter';
import type { HtmlRewriterCtor } from '../src/index.js';

export const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
export const fixtureJson = (name: string): unknown => JSON.parse(fixture(name));

/** Cloudflare's lol-html in wasm, same API as the Worker global. */
export const Rewriter = HTMLRewriter as unknown as HtmlRewriterCtor;

export const KNOWN_BADGES = ['In stock', 'Special offer', 'DreamLease exclusive!', 'Hot offer', 'Factory order', 'Limited numbers', 'Price drop', 'New model', 'Free maintenance', 'Home charger included'];

export const NOW = new Date('2026-09-14T09:00:00.000Z');
export const BY = 'sam.carter@dreamlease.co.uk';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n%fake brochure\n').buffer as ArrayBuffer;
export const pdfBytes = (): ArrayBuffer => PDF_BYTES.slice(0);
