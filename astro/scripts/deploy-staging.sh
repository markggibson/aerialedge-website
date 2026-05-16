#!/usr/bin/env bash
#
# deploy-staging.sh — Phase 6 manual SFTP deploy to aerialedge.co.uk/v2/.
#
# Wynn writes this; Mark runs it. Credentials are read from env vars Mark
# sets locally — they never enter the repo and never enter chat.
#
# Usage (from Mark's terminal):
#
#   export AE_SFTP_HOST=<rochen-hostname>
#   export AE_SFTP_USER=<username>
#   export AE_SFTP_PASS=<password>
#   # Optional. Default proto is `ftp` (FTPES — explicit FTP over TLS, port 21).
#   # Rochen shared hosting uses FTPES out of the box; SFTP (port 22) requires
#   # per-account SSH enablement via support ticket.
#   # export AE_SFTP_PROTO=ftp        # ftp (FTPES) or sftp
#   # export AE_SFTP_PORT=21          # default: 21 for ftp, 22 for sftp
#   ./scripts/deploy-staging.sh
#
# What it does (in order):
#   1. Sanity-checks the env vars are set.
#   2. Sanity-checks `lftp` is on PATH (`brew install lftp` if not).
#   3. Cleans dist/ and runs a fresh STAGING build (SITE_BASE=/v2/).
#   4. Sanity-checks dist/index.html and dist/admin/index.html exist.
#   5. Uploads dist/* to public_html/v2/ on Rochen via lftp `mirror -R`
#      (reverse mirror = upload). public_html/ root is NEVER touched.
#   6. Fetches https://aerialedge.co.uk/v2/ post-deploy and asserts 200.
#
# Guardrails:
#   - Hard-coded remote path is `public_html/v2/`. The script will refuse
#     to upload to anything outside `/v2/` (defense-in-depth — even if
#     someone edits REMOTE_DIR, the trailing path component is asserted).
#   - `set -euo pipefail` so any step's failure stops the deploy.
#   - lftp's `mirror -R --delete` only deletes inside REMOTE_DIR; it
#     cannot touch v1 at the public_html/ root.
#
# Rollback: nothing to roll back. v1 stays at public_html/ root throughout
# Phase 6. If staging is broken, just don't browse to /v2/.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Configuration — adjust only the REMOTE_DIR if Rochen's layout differs.
# DO NOT change REMOTE_DIR to anything outside `public_html/v2/` without
# explicit sign-off from Mark (see Phase 6 brief P6-D guardrail).
# ──────────────────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ASTRO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly DIST_DIR="${ASTRO_DIR}/dist"
# Rochen FTP user lands INSIDE public_html/ (the FTP root IS the webroot).
# So REMOTE_DIR is just `v2`, not `public_html/v2`. Verified 2026-05-16
# (Cord cleanup hotfix). If a future Rochen account lands at the home dir
# instead, override with: export AE_REMOTE_DIR=public_html/v2 before running.
readonly REMOTE_DIR="${AE_REMOTE_DIR:-v2}"
readonly STAGING_URL="https://aerialedge.co.uk/v2/"
readonly STAGING_ADMIN_URL="https://aerialedge.co.uk/v2/admin/"

# ──────────────────────────────────────────────────────────────────────────
# Step 0 — guardrail: REMOTE_DIR must end with /v2 (P6-D).
# ──────────────────────────────────────────────────────────────────────────
case "${REMOTE_DIR}" in
  v2|v2/|*/v2|*/v2/) ;;
  *)
    echo "FATAL: REMOTE_DIR (${REMOTE_DIR}) is not a v2 path." >&2
    echo "Phase 6 deploy refuses to write outside a v2/ directory." >&2
    exit 2
    ;;
esac

# ──────────────────────────────────────────────────────────────────────────
# Step 1 — env vars.
# ──────────────────────────────────────────────────────────────────────────
missing=()
for var in AE_SFTP_HOST AE_SFTP_USER AE_SFTP_PASS; do
  if [[ -z "${!var:-}" ]]; then
    missing+=("${var}")
  fi
done
if (( ${#missing[@]} > 0 )); then
  echo "FATAL: required env vars missing: ${missing[*]}" >&2
  echo "" >&2
  echo "Set them in your shell first, e.g.:" >&2
  echo "  export AE_SFTP_HOST=<rochen-hostname>" >&2
  echo "  export AE_SFTP_USER=<username>" >&2
  echo "  export AE_SFTP_PASS=<password>" >&2
  echo "  # Optional: export AE_SFTP_PROTO=ftp (default) or sftp" >&2
  echo "  # Optional: export AE_SFTP_PORT=21 (auto: 21 for ftp, 22 for sftp)" >&2
  exit 1
fi

# Protocol — `ftp` (FTPES, explicit TLS on port 21) is the Rochen default.
# `sftp` (port 22) requires SSH access enabled per-account on Rochen.
readonly AE_SFTP_PROTO="${AE_SFTP_PROTO:-ftp}"
case "${AE_SFTP_PROTO}" in
  ftp|sftp) ;;
  *)
    echo "FATAL: AE_SFTP_PROTO must be 'ftp' or 'sftp', got '${AE_SFTP_PROTO}'" >&2
    exit 2
    ;;
esac

# Port — defaults from proto unless explicitly overridden.
if [[ -z "${AE_SFTP_PORT:-}" ]]; then
  if [[ "${AE_SFTP_PROTO}" == "sftp" ]]; then
    AE_SFTP_PORT=22
  else
    AE_SFTP_PORT=21
  fi
fi
readonly AE_SFTP_PORT

# ──────────────────────────────────────────────────────────────────────────
# Step 2 — toolchain.
# ──────────────────────────────────────────────────────────────────────────
if ! command -v lftp >/dev/null 2>&1; then
  echo "FATAL: lftp not on PATH." >&2
  echo "Install with: brew install lftp" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "FATAL: npm not on PATH." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "FATAL: curl not on PATH." >&2
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────
# Step 3 — build with staging base.
# ──────────────────────────────────────────────────────────────────────────
echo "==> Cleaning ${DIST_DIR}"
rm -rf "${DIST_DIR}"

echo "==> Building (SITE_BASE=/v2/)"
( cd "${ASTRO_DIR}" && SITE_BASE=/v2/ npm run build )

# ──────────────────────────────────────────────────────────────────────────
# Step 4 — sanity-check dist.
# ──────────────────────────────────────────────────────────────────────────
if [[ ! -f "${DIST_DIR}/index.html" ]]; then
  echo "FATAL: ${DIST_DIR}/index.html missing after build. Aborting." >&2
  exit 1
fi
if [[ ! -f "${DIST_DIR}/admin/index.html" ]]; then
  echo "FATAL: ${DIST_DIR}/admin/index.html missing after build. Aborting." >&2
  exit 1
fi
if [[ ! -f "${DIST_DIR}/admin/config.yml" ]]; then
  echo "FATAL: ${DIST_DIR}/admin/config.yml missing after build. Aborting." >&2
  exit 1
fi
dist_size="$(du -sh "${DIST_DIR}" | awk '{print $1}')"
dist_pages="$(find "${DIST_DIR}" -name '*.html' | wc -l | tr -d ' ')"
echo "==> Build OK: ${dist_pages} HTML pages, ${dist_size} total."

# ──────────────────────────────────────────────────────────────────────────
# Step 5 — upload via lftp.
#   `mirror -R` = reverse mirror, upload local → remote.
#   `--delete` removes orphaned remote files inside REMOTE_DIR only.
#   `--parallel=4` modest concurrency (Rochen shared host).
#   `--verbose=1` summarises transferred files without dumping every byte.
# ──────────────────────────────────────────────────────────────────────────
echo "==> Uploading ${DIST_DIR}/ → ${AE_SFTP_HOST}:${REMOTE_DIR}/ (${AE_SFTP_PROTO}, port ${AE_SFTP_PORT})"
# Heredoc (NOT quoted) lets bash interpolate "${AE_SFTP_PASS}" into the
# lftp script. The password never appears on the lftp command line and
# is therefore not visible via `ps` — only inside the heredoc stream
# this shell pipes to lftp's stdin.
#
# net:max-retries=1 deliberately: a wrong-creds run should fail FAST rather
# than retry-and-trigger the Rochen CSF firewall's repeat-failure block.
lftp -p "${AE_SFTP_PORT}" "${AE_SFTP_PROTO}://${AE_SFTP_HOST}" <<LFTP
set ftp:ssl-allow yes
set ftp:ssl-force yes
set ftp:ssl-protect-data yes
set ssl:verify-certificate no
set sftp:auto-confirm yes
set net:max-retries 1
set net:reconnect-interval-base 5
set net:timeout 30
user "${AE_SFTP_USER}" "${AE_SFTP_PASS}"
mkdir -p -f "${REMOTE_DIR}"
mirror --reverse \
       --delete \
       --parallel=4 \
       --verbose=1 \
       --exclude-glob=.DS_Store \
       --exclude-glob=._* \
       "${DIST_DIR}/" "${REMOTE_DIR}/"
bye
LFTP

# ──────────────────────────────────────────────────────────────────────────
# Step 6 — post-deploy smoke.
# ──────────────────────────────────────────────────────────────────────────
echo "==> Smoke-testing ${STAGING_URL}"
status="$(curl -sIL -o /dev/null -w '%{http_code}' "${STAGING_URL}")"
if [[ "${status}" != "200" ]]; then
  echo "FATAL: ${STAGING_URL} returned HTTP ${status} (expected 200)." >&2
  exit 1
fi
echo "    ${STAGING_URL} -> 200 OK"

admin_status="$(curl -sIL -o /dev/null -w '%{http_code}' "${STAGING_ADMIN_URL}")"
if [[ "${admin_status}" != "200" ]]; then
  echo "WARN: ${STAGING_ADMIN_URL} returned HTTP ${admin_status} (expected 200)." >&2
  # Don't fail — admin loads JS that may or may not show 200 depending on
  # OAuth state. Mark to verify in-browser.
else
  echo "    ${STAGING_ADMIN_URL} -> 200 OK"
fi

echo ""
echo "==> Deploy complete."
echo "    Public:  ${STAGING_URL}"
echo "    Admin:   ${STAGING_ADMIN_URL}"
echo "    Pages:   ${dist_pages}"
echo "    Size:    ${dist_size}"
