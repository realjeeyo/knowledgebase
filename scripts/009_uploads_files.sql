-- Migration 009: image bytes move out of Postgres into the file store (lib/fileStore.mjs)
-- Run once on the KB database BEFORE deploying the file-store code:
--   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f scripts/009_uploads_files.sql
--
-- Decision 2026-11-09: images are plain files on nuvho-vectordb (/srv/kb-uploads/files,
-- reached by the app over SFTP on the private network), the same design as Nuvho Onboarding.
-- nuvho_kb.uploads stays as the metadata index (and the target of image_library's foreign
-- keys); new rows no longer carry the bytes, so `data` must accept NULL.
--
-- Non-destructive: existing bytes stay until 010_uploads_drop_data.sql, which runs only
-- after every file is copied, checked, and production is verified
-- (docs/handover/2026-11-kb-image-files.md).

ALTER TABLE nuvho_kb.uploads ALTER COLUMN data DROP NOT NULL;

-- Set by scripts/migrate-uploads-to-files.sh once a row's bytes are confirmed in the file
-- store (same SHA-256). 010 refuses to drop `data` while any row with bytes lacks it.
ALTER TABLE nuvho_kb.uploads ADD COLUMN IF NOT EXISTS file_verified_at TIMESTAMPTZ;

COMMENT ON TABLE nuvho_kb.uploads IS
  'Image metadata (knowledge.nuvho.com). Files live in the file store at <id>.<ext> (lib/fileStore.mjs); served at /uploads/<id>.<ext>. data is legacy and is dropped by migration 010.';
