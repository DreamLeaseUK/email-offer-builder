/**
 * What an unexpected error may put in the logs (house rule: no personal data in logs; CLAUDE.md rule 2: no CAP IDs
 * anywhere). A failed database query's message carries the query's values (salesperson emails, recipient details,
 * whole campaign snapshots), so only the database's own reason is kept. Validation errors keep their field-level
 * summary (no input values); anything else keeps its first line. A line that still mentions a source image URL or a
 * CAP ID is withheld (findCapIdLeak). Never request bodies, headers, tokens or values.
 * From the house template (dl-devkit/templates/house-app), 24 Sept 2026.
 */
import { findCapIdLeak } from '@offer-mailer/schema';
import { DrizzleQueryError } from 'drizzle-orm';
import { z } from 'zod';

export function safeErrorLine(err: unknown): string {
  const line = describe(err);
  return findCapIdLeak(line) ? `${err instanceof Error ? err.name : 'Error'}: [message withheld: it mentioned a source image URL or CAP ID]` : line;
}

function describe(err: unknown): string {
  if (err instanceof DrizzleQueryError) return `database query failed: ${err.cause instanceof Error ? err.cause.message : 'no reason given'}`;
  if (err instanceof z.ZodError) return `validation failed: ${z.prettifyError(err).replace(/\s*\n\s*/g, ' ')}`;
  if (err instanceof Error) return `${err.name}: ${err.message.split('\n')[0]}`;
  return 'unknown error';
}
