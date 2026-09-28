-- One-off correction, 28 Sept 2026 (run by Matt; production data is Claude-blocked).
-- The placeholder compliance template seeded into production claimed "approved by emma.airey@dreamlease.co.uk".
-- Nobody approved it. This renames it to say so and removes the approver, in both the column and the stored JSON.
-- It stays status 'approved' only so test campaigns keep rendering until compliance publishes real wording.
-- Safe to run twice. Touches only the one seeded row (its fixed id).
--
-- Run from the repo root, in the desktop app's Terminal panel:
--   pnpm --filter @offer-mailer/api exec wrangler d1 execute offer-mailer --remote --file scripts/fix-placeholder-template.sql

UPDATE templates
SET name = 'Placeholder wording (not compliance-approved)',
    approved_by = NULL,
    data = json_remove(json_set(data, '$.name', 'Placeholder wording (not compliance-approved)'), '$.approvedBy')
WHERE id = 'd1000000-0000-4000-8000-000000000001';

-- Check: expect one row, the new name, approved_by empty, and no approvedBy in the JSON.
SELECT id, name, version, status, approved_by, json_extract(data, '$.approvedBy') AS json_approved_by
FROM templates
WHERE id = 'd1000000-0000-4000-8000-000000000001';
