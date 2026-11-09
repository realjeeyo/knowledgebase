# Knowledge Base: image files out of Postgres (Nov 2026)

**Change:** article images (editor uploads, hero images, the image library) are stored as **plain
files on nuvho-vectordb**, reached by the app over **SFTP on the private network**, instead of as
`BYTEA` rows in `nuvho_kb.uploads.data`. Same design as Nuvho Onboarding's upload storage
(4 Nov 2026, `src/services/fileStore.js`).
**Branch:** `feature/kb-uploads-sftp`

## Decisions (9 Nov 2026)

| Question | Decision |
|---|---|
| Where the files live | **nuvho-vectordb** (the KB database droplet, 10.126.0.14), `/srv/kb-uploads/files` |
| How the app reaches them | SFTP, port **2222**, private VPC only, dedicated chrooted key-only user **`kb-files`** |
| Existing images | Copied to files and checked by SHA-256, then `uploads.data` **dropped** (migration 010) after production is verified |
| Image processing | **None added**: files are stored exactly as uploaded (no WebP conversion) |

## What changes and what doesn't

| | Before | After |
|---|---|---|
| Image bytes | `nuvho_kb.uploads.data` (BYTEA, ~130 MB for 461 images) | `/srv/kb-uploads/files/<id>.<ext>` on nuvho-vectordb |
| `nuvho_kb.uploads` | Bytes + metadata | Metadata only (id, ext, mime, size, uploaded_by, created_at) |
| Image URLs | `/uploads/<id>.<ext>` | **Unchanged**: no article HTML, `image_library` row or Cloudflare cache entry changes |
| Serving | Read from Postgres | Streamed from the file store, same immutable caching; errors are never cached |
| Upload order | One INSERT | File first, then the row; the file is removed if the row fails |
| Disk-full protection | None | Uploads refused below 5 GB free on the server (HTTP 507) |
| Storage down | n/a | Images answer 502 within seconds; the rest of the site keeps working |
| Bad settings | n/a | The new version refuses to start, so App Platform keeps the old one |
| Backups | Images inside every `pg_dump` | **Not** in `pg_dump` any more: see "Backups" below |

Code: `lib/fileStore.mjs` (drivers `sftp` and `local`), `lib/fileStoreInstance.ts`, `lib/uploads.ts`,
`app/uploads/[...path]/route.ts`, `instrumentation.ts` + `instrumentation-node.ts`, `next.config.js`
(`ssh2` kept out of the bundle), `scripts/import-image-library.mjs` (now writes files),
`scripts/009_uploads_files.sql`, `scripts/010_uploads_drop_data.sql`, `scripts/migrate-uploads-to-files.sh`.

**Transition safety:** until migration 010, an image that is not yet a file is served from its old
database row. Deploying the code and copying the files can therefore happen in either order
without a broken image.

## Before you start: attach the KB app to the VPC

SFTP to `10.126.0.14` only works if the knowledge.nuvho.com App Platform app is attached to the
same VPC as the droplets (Onboarding's API already is). Without it the new version still starts,
but every image answers 502 once the database bytes are gone, and uploads fail.

1. In the DigitalOcean control panel, open **Apps** and first look at **nuvho-onboarding-api** →
   **Settings**. Find its **VPC** (network) section and note the VPC it uses. Its range should be
   `10.126.0.0/20` (Sydney).
2. Open the **knowledge.nuvho.com** app → **Settings** → the same **VPC** section → **Attach VPC**
   (or **Edit**), choose that same VPC, and save. The app must be in the same region as the VPC
   (Sydney); the egress IP `170.64.165.116` says it is.
3. Saving redeploys the app. **It also changed the app's outgoing IP** (to `170.64.220.102` on
   10 Nov 2026), which the database firewall did not allow: every database read hung for 5 s and
   pages and images answered 404 until that IP was added to ufw and `pg_hba.conf` (see below).
   Moving `DATABASE_URL` to the private address ends this for good.
4. Check it from the app's **Console** tab: `node -e "require('net').connect(2222,'10.126.0.14').on('connect',()=>{console.log('VPC OK');process.exit()}).on('error',e=>{console.log(e.message);process.exit(1)})"`.
   This works only after the server steps below (port 2222 is not open before then).

The labels in the control panel may differ slightly; if you can't find the VPC section, compare
with the Onboarding app's Settings page, which has it.

**Done 9 Nov 2026 (17:40 UTC):** the app connects from `10.126.0.23` with no login failures.
Two lessons from the switch: the value must start with `postgresql://` with no quotes (otherwise pg
connects to a host called `base`), and App Platform never shows an Encrypted value again, so keep
the password in the password manager.

**Cleanup 9 Nov 2026 (17:44 UTC):** removed the 10 `nuvho_kb_user` public-IP lines from
`pg_hba.conf` and today's ufw rule for `170.64.220.102`. `nuvho_kb_user` is now allowed only
from `10.0.0.0/8` and the MCP server (`209.38.84.236`). Backups: `pg_hba.conf.bak-20261109-kb-public`,
`/root/backups/ufw-user.rules-20261109-kb-public`, `/root/backups/ufw-status-20261109-kb-public.txt`.
**Kept on purpose:** the 9 other App Platform ufw rules (`170.64.*`, `134.199.158.105`,
`134.199.162.177`, `168.144.168.142`) and their 54 pg_hba lines for the five vector-tier accounts
(`nuvho_internal`, `_domain`, `_clients`, `_confidential`, `_support`). Something on App Platform
that is not this KB code used those accounts from those IPs, most recently on 6 Nov 2026. Find that
app, move it to the VPC, then remove them.

With the app in the VPC, set `DATABASE_URL`'s host to `10.126.0.14` instead of
`209.38.90.132` (same user, password, database and options). ufw and `pg_hba.conf` already allow
`nuvho_kb_user` from `10.0.0.0/8`, so no server change is needed, and App Platform's changing
egress IPs stop mattering. Afterwards the `170.64.*` / `134.199.*` / `168.144.*` KB egress entries
in ufw and `pg_hba.conf` can be removed (confirm the app holds connections from a `10.126.*`
address in `pg_stat_activity` first).

Incident 10 Nov 2026: after the VPC attach the app's egress became `170.64.220.102`. Added
`ufw allow from 170.64.220.102 to any port 5432 proto tcp` and a `pg_hba.conf` line for it
(backup `pg_hba.conf.bak-20261110-vpc`), then `SELECT pg_reload_conf()`. The site recovered at once.

## Rollout

Each step that touches the server or database is confirmed before it runs.

Status on 10 Nov 2026: steps 1 (pg_dump only), 2, 3 and 4 are **done**, and the app is attached
to the VPC; 5–7 are still to do.

- Step 3 ran 9 Nov 2026 (from `/root/kb-migrate/` on the server): `data` now nullable,
  `file_verified_at` added.
- Step 4 ran 9 Nov 2026: 461 copied, 0 conflicts, 0 failed (log
  `/root/kb-migrate/copy-20261109.log`); `--verify` gives 461 ok, 0 missing, 0 mismatched;
  129 MB, all owned by `kb-files`, mode 640. Images uploaded by the old code before step 6 have
  bytes but no file: re-run `--yes` after the deploy and before step 7 (010 refuses otherwise).

1. **Back up:** droplet snapshot of nuvho-vectordb (DigitalOcean → Droplets → Snapshots) and
   `pg_dump -Fc nuvho_kb` to `/root/backups/`.
2. **Server: SFTP store** (nuvho-vectordb, as root). This is additive: port 22 and Postgres are untouched.
   ```bash
   useradd --system --no-create-home --shell /usr/sbin/nologin kb-files
   mkdir -p /srv/kb-uploads/files /etc/ssh/authorized_keys
   chown root:root /srv/kb-uploads && chmod 755 /srv/kb-uploads          # chroot must be root-owned
   chown kb-files:kb-files /srv/kb-uploads/files && chmod 750 /srv/kb-uploads/files
   # public key of the app's key pair; usable from the private network only
   echo 'from="10.0.0.0/8",restrict ssh-ed25519 AAAA… kb-files' > /etc/ssh/authorized_keys/kb-files
   chmod 644 /etc/ssh/authorized_keys/kb-files
   ```
   `/etc/ssh/sshd_config_kb_sftp`:
   ```
   Port 2222
   ListenAddress 10.126.0.14
   HostKey /etc/ssh/ssh_host_ed25519_key
   PidFile /run/sshd-kb-sftp.pid
   PermitRootLogin no
   PasswordAuthentication no
   KbdInteractiveAuthentication no
   PubkeyAuthentication yes
   UsePAM yes
   AllowUsers kb-files
   AuthorizedKeysFile /etc/ssh/authorized_keys/%u
   Subsystem sftp internal-sftp
   Match User kb-files
       ChrootDirectory /srv/kb-uploads
       ForceCommand internal-sftp -d /files
       AllowTcpForwarding no
       X11Forwarding no
       PermitTTY no
   ```
   `/etc/systemd/system/kb-sftp.service`:
   ```ini
   [Unit]
   Description=SFTP for knowledge base image files (VPC only, port 2222)
   After=network-online.target ssh.service
   Wants=network-online.target

   [Service]
   ExecStartPre=/usr/sbin/sshd -t -f /etc/ssh/sshd_config_kb_sftp
   ExecStart=/usr/sbin/sshd -D -f /etc/ssh/sshd_config_kb_sftp
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   systemctl daemon-reload && systemctl enable --now kb-sftp
   ufw allow from 10.0.0.0/8 to any port 2222 proto tcp comment 'KB image files SFTP (VPC only)'
   ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub      # → SFTP_HOST_KEY_SHA256
   ```
   Done 9 Nov 2026. Host key: `SHA256:w8kbf7jQ7lfgqV1xnmzNAyEShcUtNRkQrGFYj5e9QlA`. Backup:
   `/root/backups/nuvho_kb_20261109_pre_image_files.dump` (149 MB).
3. **Database:** `psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f scripts/009_uploads_files.sql`
   (makes `data` optional and adds `file_verified_at`; non-destructive).
4. **Copy the existing images** (on nuvho-vectordb, as root):
   ```bash
   # copy scripts/migrate-uploads-to-files.sh to /root on the server first
   bash migrate-uploads-to-files.sh            # dry run
   bash migrate-uploads-to-files.sh --yes      # copy, check SHA-256, mark rows
   bash migrate-uploads-to-files.sh --verify   # every row has its file: 0 missing, 0 mismatched
   ```
5. **App settings** (App Platform → the KB app → Settings → Environment Variables), with the
   app attached to the VPC:
   ```
   UPLOAD_STORAGE=sftp
   SFTP_HOST=10.126.0.14
   SFTP_PORT=2222
   SFTP_USER=kb-files
   SFTP_ROOT=/files
   SFTP_HOST_KEY_SHA256=SHA256:…            # from step 2
   SFTP_PRIVATE_KEY_B64=…                   # Encrypt ticked
   ```
6. **Deploy** the branch (merge the PR). Check: the deploy log shows `[startup] image storage: sftp`;
   an old image and a library photo load; upload one image on an Edit page and the response says
   `"backend":"sftp"`; the new file appears in `/srv/kb-uploads/files`.
7. **Drop the old bytes** (after a fresh `pg_dump`, with step 6 verified):
   `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/010_uploads_drop_data.sql`. It refuses to run
   while any row with bytes is unverified, then runs `VACUUM FULL` to give the ~130 MB back.

**Rollback** before step 7: set `UPLOAD_STORAGE` back and redeploy the previous commit. All
images are still in Postgres. After step 7, restore `data` from the backup dump.

## Running the image library import after this change

The import (`scripts/import-image-library.mjs`) now writes files through the same store, so it
needs the SFTP settings too. Port 2222 is private, so from a laptop tunnel through SSH:

```bash
ssh -N -L 12222:10.126.0.14:2222 root@209.38.90.132
```

In `.env.local` (or the shell): `UPLOAD_STORAGE=sftp`, `SFTP_HOST=127.0.0.1`, `SFTP_PORT=12222`,
`SFTP_USER=kb-files`, `SFTP_ROOT=/files`, `SFTP_HOST_KEY_SHA256`, `SFTP_PRIVATE_KEY_B64`. The host key
check still works through the tunnel. The script refuses to run without `UPLOAD_STORAGE` set, and
prints both the database and the file target before `--yes`.

## Backups

After step 7 the images are no longer inside `pg_dump`. Today only a droplet snapshot would cover
`/srv/kb-uploads/files`: there is no standing backup job on nuvho-vectordb, and the same gap is
open for Onboarding's files. Recommended next step: enable DigitalOcean droplet backups on
nuvho-vectordb, or add a nightly copy of `/srv/kb-uploads/files` to the backup server or B2.

## Checks

| Task | Where | Command |
|---|---|---|
| SFTP service running? | nuvho-vectordb | `systemctl is-active kb-sftp` |
| Free disk | nuvho-vectordb | `df -h /srv` |
| Every row has its file | nuvho-vectordb | `bash migrate-uploads-to-files.sh --verify` |
| Files on disk | nuvho-vectordb | `ls /srv/kb-uploads/files \| wc -l` |
| Rollback the service | nuvho-vectordb | `systemctl disable --now kb-sftp` and remove the ufw rule |

## Checked (9 Nov 2026)

- **Unit tests** (`lib/fileStore.test.ts`): key safety, URL→key mapping, settings validation (production refuses
  `local`, unset and `db`), fingerprint formats, error → HTTP status, and the local driver.
- **Real server**: the same suite against `kb-files` on nuvho-vectordb through a temporary forward-only tunnel
  (18/18): put/get/remove, no overwrite, wrong host key refused, the free-space floor, an unreachable server
  reported as unavailable, and parallel reads sharing one connection. Run it again with
  `SFTP_TEST_HOST=127.0.0.1 SFTP_TEST_PORT=12222 SFTP_TEST_KEY_FILE=<key> SFTP_TEST_HOST_KEY_SHA256=<fp> npx vitest run lib/fileStore.test.ts --testTimeout=120000`.
- **Server account**: login only from the private network; chrooted to `/files` (`/etc` invisible); no shell;
  port 2222 closed from the internet; files written `640` owned by `kb-files`.
- **App, local database + local files**: existing images served from the database fallback; uploads saved as
  files with metadata rows (no bytes); 304, 404 (`no-store`), 415 and 403; hero and library picker load;
  the import script writes files and refuses to run without `UPLOAD_STORAGE`; migration 010 refuses while a row
  is unverified, then drops `data`, after which images are served from files with identical bytes.
- **App, real SFTP**: `[startup] image storage: sftp`; an upload returned `"backend":"sftp"` and read back
  byte-identical. Production build: the app refuses to start with an unset, `local`, `db` or incomplete `sftp`
  setting (exit 1).
- **Not yet tested:** `migrate-uploads-to-files.sh` against the real database (runs in rollout step 4), and the app
  inside App Platform's VPC (rollout step 6).
- Downloads through an SSH tunnel from a laptop are slow (~30 KB/s; OpenSSH's own client is equally slow). The
  app talks to the server inside the VPC; the import only uploads, which is fast through the tunnel.
