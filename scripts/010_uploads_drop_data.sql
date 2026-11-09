-- Migration 010: drop the image bytes from Postgres (IRREVERSIBLE without a backup)
--
-- Run only when ALL of these are true (docs/handover/2026-11-kb-image-files.md):
--   1. A fresh pg_dump of nuvho_kb exists.
--   2. scripts/migrate-uploads-to-files.sh --verify reports every row present with a matching
--      SHA-256 (0 missing, 0 mismatched).
--   3. The file-store version of the site is live and images load in production.
--
-- Run WITHOUT -1 (VACUUM cannot run inside a transaction):
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/010_uploads_drop_data.sql
--
-- The guard below aborts if any row still has bytes but was never confirmed copied; the
-- copy script records confirmation by setting file_verified_at.

DO $$
DECLARE unverified INTEGER;
BEGIN
  SELECT count(*) INTO unverified FROM nuvho_kb.uploads
   WHERE data IS NOT NULL AND file_verified_at IS NULL;
  IF unverified > 0 THEN
    RAISE EXCEPTION '% upload rows still hold bytes that were not verified in the file store; run scripts/migrate-uploads-to-files.sh first', unverified;
  END IF;
END $$;

ALTER TABLE nuvho_kb.uploads DROP COLUMN data;
ALTER TABLE nuvho_kb.uploads DROP COLUMN IF EXISTS file_verified_at;

COMMENT ON TABLE nuvho_kb.uploads IS
  'Image metadata (knowledge.nuvho.com). Files live in the file store at <id>.<ext> (lib/fileStore.mjs); served at /uploads/<id>.<ext>.';

-- Give the ~130 MB of TOASTed image data back to the disk (brief exclusive lock on uploads)
VACUUM FULL nuvho_kb.uploads;
