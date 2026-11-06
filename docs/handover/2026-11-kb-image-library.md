# Knowledge Base: image library — rollout steps (Nov 2026)

**Feature:** "Choose from library" on the hero image field, next to paste-URL and Upload: on the article **Edit page**
and in the **admin dashboard's article form** (new and existing articles).
Editors browse the Marketing photo library, open a photo to see the **real article hero and tile** with the
article's (unsaved) title and description at desktop or phone size, then confirm. Nothing is saved until
"Save changes".
**Branch:** `feature/kb-image-library-picker`
**Switch-on:** no env setting. The Edit page and the admin dashboard check the database on each load and show "Choose from library"
only once `nuvho_kb.image_library` exists and holds at least one active photo. Until the steps below are done
both forms look exactly as before, so the code can merge first.

## Decisions (5 Nov 2026)

| Question | Decision |
|---|---|
| How the KB reads the repository | **Snapshot import** (no live Microsoft Graph connection, no Entra credentials in production) |
| Where the option appears | **Hero image** on the article Edit page (5 Nov), extended on 6 Nov to the **admin dashboard's article form** for new and existing articles. Not for inline body images |
| Preview | **Hero preview inside the picker**: the real hero + article tile, desktop/mobile toggle |
| Stored size | **2400px-wide JPEG, quality 85** (never enlarged) plus a 480px thumbnail for the grid |

**Source folder:** SharePoint `nuvhosystems` › Documents › Nuvho Pty Ltd › Marketing › 6. Content › Image Repository
(sharing link: `https://nuvho.sharepoint.com/:f:/s/nuvhosystems/IgDPzwf1XmLbR6VSFadDEBUwAe16oPg0QRCa46oDZkYhUx8`).
On 5 Nov 2026 it held 229 photos (~775 MB, largest 25 MB) in:
Generic Imagery/Hotel (17), Generic Imagery/Travel (30), Regions/Ireland (21), Regions/UK/UK London (22),
Regions/UK/UK Manchester (13), Regions/Germany (59), Regions/Australia/Melbourne (20),
Regions/Australia/Queensland (29), Regions/Australia/Sydney (18). Subfolders become the picker's collections.

## How it works

- `scripts/import-image-library.mjs` reads a **local copy** of the folder, resizes each photo with `sharp`
  (EXIF rotation applied, metadata incl. GPS stripped), and stores the 2400px image and the thumbnail as
  ordinary rows in `nuvho_kb.uploads` (`uploaded_by = 'image-library-import'`). It records each photo in
  `nuvho_kb.image_library` with its folder, file name and, for Unsplash/Pexels downloads, the photographer
  credit read from the file name.
- Picking a photo puts its existing `/uploads/<id>.jpg` URL in the hero field, so nothing is copied at pick time
  and the image is served and cached exactly like an uploaded one.
- Re-runs are safe: unchanged files (same SHA-1) are skipped, changed files get new upload rows, files removed
  from the folder are hidden from the picker (`active = false`). Old upload rows are never deleted, because
  articles may still point at them.

## Rollout

All SQL targets the KB database on `nuvho-vectordb` (209.38.90.132), database `nuvho_kb`, schema `nuvho_kb`.

1. **Back up first:** `pg_dump -Fc nuvho_kb` (there is still no standing backup job on this droplet).
2. **Create the table** (needs `005_uploads.sql`, already applied):
   ```bash
   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f scripts/008_image_library.sql
   ```
   Grants: the default privileges in `nuvho_kb` give `nuvho_kb_user` access to new tables (see the October
   handover); the app only needs `SELECT` on `image_library`, the import needs `INSERT`/`UPDATE` on it and
   `INSERT` on `uploads`.
3. **Get a local copy of the Image Repository:** in SharePoint open the folder, select all → **Download**
   (unzip it), or use **Sync** to OneDrive. Point the script at the `Image Repository` folder itself.
4. **Dry run, then import** from a checkout of this branch with `DATABASE_URL` pointing at production
   (e.g. through the usual SSH tunnel). The script prints the target host and refuses to write without `--yes`:
   ```bash
   npm ci
   node scripts/import-image-library.mjs "<path>/Image Repository" --dry-run
   node scripts/import-image-library.mjs "<path>/Image Repository" --yes
   ```
   **Storage:** expect roughly 0.3–0.8 MB per photo at 2400px plus ~30 KB per thumbnail, so about
   **70–190 MB** for the current 229 photos, in the same database as the vector DBs. Check free disk on the
   droplet first. `--width 1920` roughly halves it if needed.
5. **Check:** nothing to switch on. Once the import has finished, open any article's Edit page (or Admin → Articles → Add article / Edit) → Hero image →
   **Choose from library**. (To hide the option again, mark the rows inactive:
   `UPDATE nuvho_kb.image_library SET active = false;`, and re-run the import to bring them back.)

**When marketing adds or replaces photos:** repeat steps 3–4. Only new or changed files are processed.

## Checked locally (5 Nov 2026)

Against a throwaway Postgres with migrations 005 and 008 and a copy of the folder layout with the real file names:
refuses to write without `--yes`; dry run; import (4000px originals stored at 2400px, a 1920px original left at
1920px, `Thumbs.db` skipped); re-run skips all; changed file re-imported; removed file deactivated and restored
file reactivated. In the browser: picker loads only for `@nuvho.com` sessions (API 403 otherwise), collection
filter and search, desktop and mobile previews with the real breakpoints and the tile, "Use this image" fills the
field, Save publishes the hero, phone-width layout, Escape closes. Not tested against the production database or
with the real 229 photos.

**6 Nov 2026:** the env flag was replaced by the photo check (table missing / empty / only inactive photos → hidden;
one active photo → shown; database unreachable → hidden, page still renders). In the admin dashboard: Add article →
Choose from library → preview ("Untitled article", today's date) and Edit → Choose from library → preview → Use this image
→ Save changes publishes the hero. The article Edit page uses the same shared preview page.
