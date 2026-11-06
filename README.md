# knowledge.nuvho.com

Nuvho Knowledge Base — built with Next.js 14, Tailwind CSS, and the Nuvho brand system.

## Quick start (local dev)

```bash
# Install dependencies
npm install

# Start dev server (hot reload)
npm run dev
# → http://localhost:3000
```

## Docker — local

```bash
# Hot-reload dev mode (no build step)
docker compose -f docker-compose.dev.yml up

# Production build + run
docker compose up --build
```

## Docker — production image

```bash
docker build -t knowledge-nuvho:latest .
docker run -p 3000:3000 knowledge-nuvho:latest
```

## Project structure

```
app/                     Next.js App Router pages
  page.tsx               Homepage (hero + category grid)
  search/page.tsx        Search results
  categories/[slug]/     Category listing
  articles/[cat]/[slug]/ Article detail
  api/health/            Health check → GET /api/health
components/              Reusable UI
  Header.tsx             Blue Slate nav + logo
  SearchHero.tsx         Search input with popular tags
  CategoryGrid.tsx       8-category card grid
  ArticleCard.tsx        Article list item
  Footer.tsx             Iron Grey footer
lib/
  data.ts                Mock categories + articles
  types.ts               TypeScript interfaces
public/
  logo-white.svg         Nuvho logo (for dark backgrounds)
  logo-primary.svg       Nuvho logo (for light backgrounds)
  icons/                 56 Nuvho duotone brand icons
```

## Brand tokens

| Token | Value | Usage |
|-------|-------|-------|
| Blue Slate | `#28687F` | Primary CTA, header, buttons |
| Steel Blue | `#6BA1BF` | Accents, links |
| Tropical Teal | `#80B9BF` | Hover states, card borders |
| Iron Grey | `#414B4C` | Body text, footer |
| Platinum | `#E9EAEC` | Backgrounds, dividers |

Fonts: **Comfortaa** (headings) · **Raleway** (body) — loaded from Google Fonts.

## Article editor & image uploads

Staff (@nuvho.com) edit article bodies in a self-hosted **TinyMCE 8** editor
(GPL, bundled from npm — no Tiny Cloud account or API key, no runtime calls to tiny.cloud).
It runs in inline mode inside the page so it inherits the brand fonts and the `.nw-prose`
article styles. The `<>` toolbar button still exposes the raw HTML.

- **Images** dropped, pasted or inserted in the editor, and the hero image field, upload to
  `POST /api/admin/uploads` (images only — JPG, PNG, WebP, GIF — up to `MAX_UPLOAD_MB`,
  default 10) and are referenced by URL from the article HTML.
- **Storage** (`lib/uploads.ts`, `UPLOAD_STORAGE`):
  - **`db` (default)** — rows in `nuvho_kb.uploads` in the main Postgres database
    (migration `scripts/005_uploads.sql`), served by the app at `/uploads/<id>.<ext>` with
    immutable caching. This is the production setting: the App Platform containers that serve
    knowledge.nuvho.com have no persistent disk, and Cloudflare in front caches image
    extensions so Postgres is read about once per image per edge. Images ride along in every
    database backup.
  - **`local`** — files under `UPLOADS_DIR` (`./uploads` in dev, the `knowledge-uploads`
    volume at `/app/uploads` in Docker), served at `/uploads/<yyyy>/<mm>/<file>`. For a plain
    Docker host only.
  - The upload response includes `backend: "db" | "local"` so a deployment can be checked with
    one test upload.
- **Sanitising**: every save route runs the HTML through `lib/sanitize.ts` (allow-list of the
  tags, attributes and inline styles that `.nw-prose` renders) before it reaches Postgres.
- **Attachments** (PDF, Office files) are intentionally not accepted yet. To enable them, add
  the MIME type in `ALLOWED_TYPES` / `sniffType()` in `lib/uploads.ts` and widen
  `ACCEPTED_IMAGE_TYPES` in `lib/uploadClient.ts`.

## Image library (hero images)

The hero image field (on an article's Edit page, and in the admin dashboard's article form for new and
existing articles) can also **Choose from library**: curated photos from the Marketing
SharePoint *Image Repository*, imported as a snapshot. Selecting a photo opens a preview of the real
article hero and tile (desktop / mobile) before it is applied; nothing is saved until "Save changes".

- `scripts/008_image_library.sql` creates `nuvho_kb.image_library` (image bytes live in `nuvho_kb.uploads`).
- `scripts/import-image-library.mjs "<path>/Image Repository" --dry-run | --yes` resizes every photo to a
  2400px JPEG plus a 480px thumbnail and records it. Re-run whenever marketing adds photos; unchanged files
  are skipped and removed ones are hidden.
- No env setting: the option appears by itself once the table exists and the import has stored at least one
  photo (`hasLibraryImages()` in `lib/imageLibraryDb.ts`). Until then both forms are unchanged.
- The preview is the staff-only `/admin/hero-preview` page, built entirely from the unsaved form, so it also works
  for an article that has not been created yet.

Rollout steps: [docs/handover/2026-11-kb-image-library.md](docs/handover/2026-11-kb-image-library.md).

## Deploy

Production (knowledge.nuvho.com) runs on **DigitalOcean App Platform** behind Cloudflare, built
from this repository. Set the environment variables from `.env.example` in the App Platform
component settings. For image uploads:

1. Run `scripts/005_uploads.sql` once against the production database (creates
   `nuvho_kb.uploads`).
2. Leave `UPLOAD_STORAGE` unset or `db`. Do **not** set `local` on App Platform — the
   container disk is wiped on every deploy.
3. Deploy, then upload one image from an article's Edit page and confirm the response's
   `backend` is `db` and the image loads at its `/uploads/<id>.<ext>` URL.

### Alternative: Docker host (servermain)

1. Build image: `docker build -t knowledge-nuvho:latest .`
2. Push to server or transfer via `docker save`
3. Run `docker compose up -d` on the server
4. Point nginx at port 3000 for `knowledge.nuvho.com`
5. Uploads default to the database (`UPLOAD_STORAGE=db`). To keep them on disk instead, set
   `UPLOAD_STORAGE=local`; `docker-compose.yml` already mounts the `knowledge-uploads` volume
   at `/app/uploads`.
6. Allow editor uploads through nginx — the default 1 MB body limit blocks them:

   ```nginx
   # /etc/nginx/sites-available/knowledge.nuvho.com — inside the server {} block
   client_max_body_size 12m;   # ≥ MAX_UPLOAD_MB plus multipart overhead
   ```

   Optional: serve uploads straight from the volume instead of through Node by adding
   `location /uploads/ { alias <volume mountpoint>/; expires 1y; add_header Cache-Control "public, immutable"; }`
   where the mountpoint is `docker volume inspect knowledge-nuvho_knowledge-uploads`.

Health check endpoint: `GET /api/health`
