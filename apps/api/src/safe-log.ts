/**
 * What an unexpected error may put in the logs (house rule: no personal data in logs; CLAUDE.md rule 2: no CAP IDs
 * anywhere). A failed database query's message carries the query's values (salesperson emails, recipient details,
 * whole campaign snapshots), so only the database's own reason is kept. Validation errors keep their field-level
 * summary (no input values); anything else keeps its first line. Never request bodies, headers, tokens or values.
 * From the house template (dl-devkit/templates/house-app), 24 Sept 2026.
 */
import { DrizzleQueryError } from 'drizzle-orm';
import { z } from 'zod';

export function safeErrorLine(err: unknown): string {
  if (err instanceof DrizzleQueryError) return `database query failed: ${err.cause instanceof Error ? err.cause.message : 'no reason given'}`;
  if (err instanceof z.ZodError) return `validation failed: ${z.prettifyError(err).replace(/\s*\n\s*/g, ' ')}`;
  if (err instanceof Error) return `${err.name}: ${err.message.split('\n')[0]}`;
  return 'unknown error';
}
