#!/usr/bin/env bash
# Copies every image still held in nuvho_kb.uploads.data into the KB file store on
# nuvho-vectordb, checks each copy by SHA-256, and marks the row file_verified_at.
# Decision 2026-11-09 (docs/handover/2026-11-kb-image-files.md).
#
# Run ON nuvho-vectordb as root (it reads the database as postgres over the local socket
# and writes files owned by kb-files), after migration 009:
#
#   bash migrate-uploads-to-files.sh            # dry run: counts only, writes nothing
#   bash migrate-uploads-to-files.sh --yes      # copy + verify + mark rows
#   bash migrate-uploads-to-files.sh --verify   # read-only check of every row against its file
#
# Safe to re-run: rows already marked are skipped, an existing identical file is just
# marked, and an existing file with different content is reported, never overwritten.
# Settings (env): KB_DB (nuvho_kb), FILES_DIR (/srv/kb-uploads/files), FILES_OWNER (kb-files).

set -euo pipefail

MODE=dry
case "${1:-}" in
  --yes) MODE=copy ;;
  --verify) MODE=verify ;;
  "") ;;
  *) echo "Usage: $0 [--yes | --verify]" >&2; exit 2 ;;
esac

KB_DB="${KB_DB:-nuvho_kb}"
FILES_DIR="${FILES_DIR:-/srv/kb-uploads/files}"
FILES_OWNER="${FILES_OWNER:-kb-files}"
ID_RE='^[a-z0-9]+-[a-f0-9]{12}$'
EXT_RE='^(jpg|png|webp|gif)$'

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
[ -d "$FILES_DIR" ] || { echo "Missing $FILES_DIR (set up the kb-files store first)." >&2; exit 1; }
id "$FILES_OWNER" >/dev/null 2>&1 || { echo "Missing user $FILES_OWNER." >&2; exit 1; }

# </dev/null: never let psql (or sudo) read the row list the loops below are reading
psql_q() { sudo -u postgres psql -d "$KB_DB" -X -At -v ON_ERROR_STOP=1 "$@" </dev/null; }

has_data_col=$(psql_q -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='nuvho_kb' AND table_name='uploads' AND column_name='data'")
has_flag_col=$(psql_q -c "SELECT count(*) FROM information_schema.columns WHERE table_schema='nuvho_kb' AND table_name='uploads' AND column_name='file_verified_at'")

echo "Database : $KB_DB   Files: $FILES_DIR (owner $FILES_OWNER)   Mode: $MODE"

# ── verify: every row (with or without bytes) must have its file ─────────────
if [ "$MODE" = verify ]; then
  ok=0; missing=0; mismatch=0
  if [ "$has_data_col" = 1 ]; then
    query="SELECT id, ext, CASE WHEN data IS NULL THEN '' ELSE encode(sha256(data),'hex') END FROM nuvho_kb.uploads ORDER BY id"
  else
    query="SELECT id, ext, '' FROM nuvho_kb.uploads ORDER BY id"
  fi
  while IFS='|' read -r id ext sha; do
    f="$FILES_DIR/$id.$ext"
    if [ ! -f "$f" ]; then echo "  MISSING  $id.$ext"; missing=$((missing+1)); continue; fi
    if [ -n "$sha" ] && [ "$(sha256sum "$f" | cut -d' ' -f1)" != "$sha" ]; then
      echo "  MISMATCH $id.$ext"; mismatch=$((mismatch+1)); continue
    fi
    ok=$((ok+1))
  done < <(psql_q -F '|' -c "$query")
  echo "Verified: $ok ok, $missing missing, $mismatch mismatched"
  [ $missing -eq 0 ] && [ $mismatch -eq 0 ]
  exit $?
fi

# ── dry run / copy ───────────────────────────────────────────────────────────
[ "$has_data_col" = 1 ] || { echo "uploads.data is already gone: nothing to copy."; exit 0; }
[ "$has_flag_col" = 1 ] || { echo "Run migration 009 first (uploads.file_verified_at is missing)." >&2; exit 1; }

todo=$(psql_q -c "SELECT count(*) || ' rows, ' || pg_size_pretty(coalesce(sum(size_bytes),0)::bigint) FROM nuvho_kb.uploads WHERE data IS NOT NULL AND file_verified_at IS NULL")
echo "To copy  : $todo"
if [ "$MODE" = dry ]; then echo "Dry run: nothing written. Re-run with --yes to copy."; exit 0; fi

copied=0; marked=0; conflicts=0; failed=0
tmp_dir=$(mktemp -d "$FILES_DIR/.migrate.XXXXXX")
trap 'rm -rf "$tmp_dir"' EXIT

while IFS='|' read -r id ext sha; do
  if ! [[ "$id" =~ $ID_RE && "$ext" =~ $EXT_RE ]]; then echo "  SKIP     unexpected id/ext: $id.$ext"; failed=$((failed+1)); continue; fi
  f="$FILES_DIR/$id.$ext"
  if [ -e "$f" ]; then
    if [ "$(sha256sum "$f" | cut -d' ' -f1)" = "$sha" ]; then
      psql_q -c "UPDATE nuvho_kb.uploads SET file_verified_at = now() WHERE id = '$id'" >/dev/null
      marked=$((marked+1))
    else
      echo "  CONFLICT $id.$ext exists with different content (left untouched)"; conflicts=$((conflicts+1))
    fi
    continue
  fi
  t="$tmp_dir/$id.$ext"
  psql_q -c "SELECT encode(data, 'base64') FROM nuvho_kb.uploads WHERE id = '$id'" | base64 -d > "$t"
  if [ "$(sha256sum "$t" | cut -d' ' -f1)" != "$sha" ]; then
    echo "  FAILED   $id.$ext (copy does not match the database)"; rm -f "$t"; failed=$((failed+1)); continue
  fi
  chown "$FILES_OWNER:$FILES_OWNER" "$t"
  chmod 640 "$t"
  mv -n "$t" "$f"
  psql_q -c "UPDATE nuvho_kb.uploads SET file_verified_at = now() WHERE id = '$id'" >/dev/null
  copied=$((copied+1))
done < <(psql_q -F '|' -c "SELECT id, ext, encode(sha256(data),'hex') FROM nuvho_kb.uploads WHERE data IS NOT NULL AND file_verified_at IS NULL ORDER BY id")

echo "Done: $copied copied, $marked already present, $conflicts conflicts, $failed failed"
left=$(psql_q -c "SELECT count(*) FROM nuvho_kb.uploads WHERE data IS NOT NULL AND file_verified_at IS NULL")
echo "Rows with bytes not yet verified: $left"
[ "$conflicts" -eq 0 ] && [ "$failed" -eq 0 ]
