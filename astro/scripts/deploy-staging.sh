#!/usr/bin/env bash
#
# deploy-staging.sh — manual SFTP deploy to aerialedge.co.uk/preview/ (staging).
#
# Clone of `deploy-prod.sh` with the same FTPES plumbing, but writes to the
# STAGING subtree at public_html/preview/ instead of the apex webroot. Use
# this to push a build to /preview/ for review before promoting it to apex
# with `deploy-prod.sh`.
#
# Wynn writes this; Mark runs it as the one-command staging push. Credentials
# are read from env vars Mark sets locally — they never enter the repo and
# never enter chat.
#
# Usage (from Mark's terminal):
#
#   export AE_SFTP_HOST=ftp.circushost.com
#   export AE_SFTP_USER=<rochen-ftp-user>
#   export AE_SFTP_PASS=<rochen-ftp-password>
#   # Optional. Default proto is `ftp` (FTPES — explicit FTP over TLS, port 21).
#   # export AE_SFTP_PROTO=ftp        # ftp (FTPES) or sftp
#   # export AE_SFTP_PORT=21          # default: 21 for ftp, 22 for sftp
#   ./scripts/deploy-staging.sh
#
# What it does (in order):
#   1. Sanity-checks the env vars are set.
#   2. Sanity-checks `lftp` is on PATH.
#   3. Cleans dist/ and runs a fresh STAGING build (SITE_BASE=/preview/).
#   4. Sanity-checks dist/index.html + admin + vendored JS + the PDP page.
#   5. Uploads dist/* to public_html/preview/ on Rochen via lftp `mirror -R`
#      with explicit excludes for `v1-archive/` and `assets/`.
#   5b. Uploads the vendored-JS allowlist to public_html/assets/javascripts/.
#       (Shared root asset tree — same path as prod; /preview/ HTML references
#       these root-relative.)
#   6. Fetches https://aerialedge.co.uk/preview/ AND the PDP page post-deploy
#      and asserts 200 on both.
#
# Note on the apex 301: the redirect `1-year-pdc → ...` lives in `.htaccess`
# at the apex webroot and does NOT fire under `/preview/`. That is expected —
# staging serves the raw Astro build without the apex rewrite rules.
#
# Guardrails:
#   - REMOTE_DIR defaults to "preview" (public_html/preview/). The script
#     refuses to run if REMOTE_DIR looks like a subfolder we shouldn't be
#     touching (v1-archive, shared assets/, retired /v2/), is empty, or
#     escapes the preview/ subtree. A positive containment guard requires
#     REMOTE_DIR to be `preview` or a path strictly inside it (no `..`).
#   - lftp `mirror -R --delete` only deletes inside REMOTE_DIR (preview/). As
#     belt-and-braces it ALSO carries the full PROTECTED_PATHS exclude list
#     (mirrors deploy-prod.sh, shared-webroot co-tenants) so even an
#     AE_REMOTE_DIR override can't let --delete reach a co-tenant.
#   - `set -euo pipefail` so any step's failure stops the deploy.
#
# Rollback: re-run with the previous build, or just promote-then-rebuild.
# /preview/ has no rollback window — it is a disposable staging surface.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Configuration — REMOTE_DIR defaults to "preview" (public_html/preview/).
# Override via AE_REMOTE_DIR only if the staging subtree ever moves.
# ──────────────────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ASTRO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly DIST_DIR="${ASTRO_DIR}/dist"
# Rochen FTP user lands INSIDE public_html/. So REMOTE_DIR for a staging
# deploy is "preview" (the FTP root IS the webroot; preview/ is below it).
readonly REMOTE_DIR="${AE_REMOTE_DIR:-preview}"
readonly STAGING_URL="https://aerialedge.co.uk/preview/"
readonly STAGING_ADMIN_URL="https://aerialedge.co.uk/preview/admin/"
readonly STAGING_PDP_URL="https://aerialedge.co.uk/preview/professional-development-programme/"

# Carried forward from prod — vendored-JS root-asset sync.
# These three files were added to Astro in Phase 3 and don't exist in
# v1's asset tree. They live at public_html/assets/javascripts/ and the
# Astro build references them root-relative (NOT under /preview/). The
# allowlist sync ensures they exist for the staging HTML to resolve.
readonly ROOT_ASSETS_REMOTE_DIR="assets/javascripts"
VENDORED_JS_ALLOWLIST=(
  "imagesloaded.pkgd.js"
  "masonry.pkgd.min.js"
  "menu-toggler.js"
)

# ──────────────────────────────────────────────────────────────────────────
# PROTECTED_PATHS — shared-webroot co-tenant list (mirrors deploy-prod.sh).
#
# Staging's --delete is scoped to preview/ and CANNOT reach these in normal
# operation. This list is belt-and-braces: if AE_REMOTE_DIR is ever
# overridden to something broader (or a bug widens the target), --delete
# still cannot touch any co-tenant. Keep in sync with deploy-prod.sh's copy.
# ──────────────────────────────────────────────────────────────────────────
PROTECTED_PATHS=(
  "v2"                    # retired staging path.
  "v1-archive"            # Mark's 30-day rollback window.
  "assets"                # 5.8 GB shared tree (vendored-JS sync writes it).
  "aewiki"                # disposable per Mark, do not touch.
  "sites"                 # Drupal.
  "settings.php"          # Drupal config.
  "default.settings.php"  # Drupal default config.
  # NOTE: "newsletter" is intentionally NOT excluded here. The Astro build
  # now EMITS dist/newsletter/ (src/pages/newsletter/), so it is a
  # build-owned path that must land at preview/newsletter/. Adding it to the
  # --exclude-glob block would make a break-glass staging run silently skip
  # the newsletter section. The preview/ --delete scope already keeps the
  # blast radius inside staging, so newsletter does not need co-tenant
  # protection here. Mirrors the deploy-prod.sh side. (Task #886 / from
  # #745 / follow-up #815.)
  "zArchive"              # archived content.
  "_includes" "_layouts" "_posts" "_sass" "_site" "_data" "_works"
  "bower_components"
  # v1-leftover ROOT files moved to PROTECTED_ROOT_FILES below (task #1449).
  # Do NOT put feed.xml / manifest.json / favicon.ico / browserconfig.xml
  # back here: --exclude-glob matches the BASENAME at any depth, so a bare
  # "feed.xml" also blocked dist/newsletter/feed.xml from every run.
  "cgi-bin"
  ".well-known"           # Let's Encrypt / ACME — Rochen-managed.
  ".ftpquota"             # auto-regenerated by Rochen.
  ".DS_Store"
)
# NOTE: `preview` is deliberately NOT in this list — preview/ IS the staging
# deploy target, so --delete must be free to prune stale files inside it.

# ──────────────────────────────────────────────────────────────────────────
# PROTECTED_ROOT_FILES — v1-leftover files that exist ONLY at the webroot
# top level and are not emitted by the Astro build. Split out 2026-07-20
# (task #1449), mirroring deploy-prod.sh.
#
# Emitted as anchored REGEX excludes (`--exclude '^feed\.xml$'`) rather than
# globs, because lftp's --exclude-glob matches the basename at ANY depth
# (verified with a local lftp 4.9.3 mirror). The anchor pins them to the root
# so nested same-named build output — newsletter/feed.xml — deploys normally.
# Keep in sync with deploy-prod.sh and with the CI workflows, which achieve
# the same result via a negated re-include because multimatch cannot anchor.
# ──────────────────────────────────────────────────────────────────────────
PROTECTED_ROOT_FILES=(
  "feed.xml" "manifest.json" "favicon.ico" "browserconfig.xml"
)

# ──────────────────────────────────────────────────────────────────────────
# Step 0 — guardrail: REMOTE_DIR must not target a subfolder we don't own.
#
# Our staging lane on Rochen is public_html/preview/ ONLY. We must never
# touch:
#   - v1-archive/  (Mark's 30-day rollback window — never touch from here)
#   - assets/      (5.8 GB Rochen-resident shared tree — never touch from
#                   here; the narrow vendored-JS sync below is the only
#                   path that writes inside assets/)
#   - v2/          (retired staging path — superseded by preview/)
#
# Refuse to run if REMOTE_DIR looks like any of those, or is empty (which
# would aim the deploy at the apex webroot — that's deploy-prod.sh's job).
# ──────────────────────────────────────────────────────────────────────────
case "${REMOTE_DIR}" in
  ""|/)
    echo "FATAL: REMOTE_DIR is empty — that targets the apex webroot." >&2
    echo "       This is the STAGING deploy. Use deploy-prod.sh for apex," >&2
    echo "       or set AE_REMOTE_DIR=preview." >&2
    exit 2
    ;;
  *v1-archive*|*v1_archive*)
    echo "FATAL: REMOTE_DIR (${REMOTE_DIR}) looks like a v1-archive path." >&2
    echo "       Staging deploy refuses to write into the rollback window." >&2
    exit 2
    ;;
  assets|assets/|*/assets|*/assets/*)
    echo "FATAL: REMOTE_DIR (${REMOTE_DIR}) targets the shared assets/ tree." >&2
    echo "       Staging deploy refuses — only the vendored-JS allowlist" >&2
    echo "       step (5b) writes inside assets/." >&2
    exit 2
    ;;
  v2|v2/|*/v2|*/v2/)
    echo "FATAL: REMOTE_DIR (${REMOTE_DIR}) still targets the retired /v2/ path." >&2
    echo "       Staging now lives at preview/. Unset AE_REMOTE_DIR and re-run," >&2
    echo "       or set it to 'preview' explicitly." >&2
    exit 2
    ;;
esac

# Positive containment guard: REMOTE_DIR must be exactly `preview` (optionally
# with a trailing slash) or a path strictly INSIDE preview/. Anything else —
# an absolute path, a parent-escape (`..`), or a sibling dir — is rejected so
# --delete can never escape the staging subtree onto the shared webroot.
case "${REMOTE_DIR}" in
  preview|preview/|preview/*) ;;
  *)
    echo "FATAL: REMOTE_DIR (${REMOTE_DIR}) is outside the preview/ staging" >&2
    echo "       subtree. Staging deploy refuses to target anything but" >&2
    echo "       preview/ or a path inside it." >&2
    exit 2
    ;;
esac
case "${REMOTE_DIR}" in
  *..*)
    echo "FATAL: REMOTE_DIR (${REMOTE_DIR}) contains '..' — refusing to" >&2
    echo "       allow a parent-directory escape from preview/." >&2
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
  echo "Set them in your shell first (zsh-compatible):" >&2
  echo "  export AE_SFTP_HOST=ftp.circushost.com" >&2
  echo "  read -s 'AE_SFTP_USER?Rochen FTP user: ' AE_SFTP_USER; export AE_SFTP_USER" >&2
  echo "  read -s 'AE_SFTP_PASS?Rochen FTP password: ' AE_SFTP_PASS; export AE_SFTP_PASS" >&2
  exit 1
fi

readonly AE_SFTP_PROTO="${AE_SFTP_PROTO:-ftp}"
case "${AE_SFTP_PROTO}" in
  ftp|sftp) ;;
  *)
    echo "FATAL: AE_SFTP_PROTO must be 'ftp' or 'sftp', got '${AE_SFTP_PROTO}'" >&2
    exit 2
    ;;
esac
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
for tool in lftp npm curl; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    echo "FATAL: ${tool} not on PATH." >&2
    [[ "${tool}" == "lftp" ]] && echo "Install with: brew install lftp" >&2
    exit 1
  fi
done

# ──────────────────────────────────────────────────────────────────────────
# Step 3 — build with the staging (/preview/) base.
#
# `npm run build:staging` sets SITE_BASE=/preview/ so every internal href
# and asset path is prefixed with /preview/. We pass SITE_BASE explicitly
# here too, to make the intent unambiguous regardless of which npm script
# resolves it.
# ──────────────────────────────────────────────────────────────────────────
echo "==> Cleaning ${DIST_DIR}"
rm -rf "${DIST_DIR}"

echo "==> Building (SITE_BASE=/preview/, staging base)"
( cd "${ASTRO_DIR}" && SITE_BASE='/preview/' npm run build )

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
# The PDP page is the thing being shipped to /preview/ for review — assert it.
if [[ ! -f "${DIST_DIR}/professional-development-programme/index.html" ]]; then
  echo "FATAL: ${DIST_DIR}/professional-development-programme/index.html missing" >&2
  echo "       after build. The PDP page is the deploy target. Aborting." >&2
  exit 1
fi
# Confirm we built staging-shape, not apex-shape — /preview/ hrefs required.
if ! grep -q 'href="/preview/' "${DIST_DIR}/index.html"; then
  echo "FATAL: ${DIST_DIR}/index.html has no /preview/ hrefs." >&2
  echo "       SITE_BASE did not apply to the staging build. Aborting." >&2
  exit 1
fi
dist_size="$(du -sh "${DIST_DIR}" | awk '{print $1}')"
dist_pages="$(find "${DIST_DIR}" -name '*.html' | wc -l | tr -d ' ')"
echo "==> Build OK: ${dist_pages} HTML pages, ${dist_size} total."

# ──────────────────────────────────────────────────────────────────────────
# Step 5 — upload via lftp.
#
# `mirror -R` = reverse mirror, upload local → remote. With --delete it
# removes orphaned remote files inside REMOTE_DIR only. Critical excludes:
#
#   --exclude-glob 'v1-archive/' — Mark's 30-day rollback window.
#   --exclude-glob 'assets/'     — 5.8 GB shared tree.
#   --exclude-glob '.well-known/' — Let's Encrypt; Rochen-managed.
#   --exclude-glob '.ftpquota'    — auto-regenerated by Rochen.
#
# Because REMOTE_DIR is preview/, --delete is scoped to public_html/preview/
# and cannot touch the apex webroot. The excludes are belt-and-braces in case
# AE_REMOTE_DIR is ever overridden to something broader.
# ──────────────────────────────────────────────────────────────────────────
# Sanity-check vendored-JS allowlist exists in dist before uploading.
for f in "${VENDORED_JS_ALLOWLIST[@]}"; do
  if [[ ! -f "${DIST_DIR}/assets/javascripts/${f}" ]]; then
    echo "FATAL: vendored-JS allowlist file missing from dist: ${f}" >&2
    echo "       Expected at ${DIST_DIR}/assets/javascripts/${f}" >&2
    exit 1
  fi
done

# Build the --exclude-glob block from PROTECTED_PATHS (each entry bare and
# with a trailing slash), single-sourced from the commented array above.
# Belt-and-braces: --delete is already scoped to preview/, these excludes
# guard against an AE_REMOTE_DIR override widening the blast radius.
exclude_block=""
for p in "${PROTECTED_PATHS[@]}"; do
  exclude_block+="       --exclude-glob ${p} \\"$'\n'
  exclude_block+="       --exclude-glob ${p}/ \\"$'\n'
done
exclude_block+="       --exclude-glob ._* \\"$'\n'

# Root-only v1 leftovers: anchored REGEX excludes, not globs (task #1449),
# so nested same-named build output (newsletter/feed.xml) still deploys.
for p in "${PROTECTED_ROOT_FILES[@]}"; do
  escaped="${p//./\\.}"
  exclude_block+="       --exclude ^${escaped}\$ \\"$'\n'
done

target_label="${REMOTE_DIR}"
echo "==> Uploading ${DIST_DIR}/ → ${AE_SFTP_HOST}:${target_label} (${AE_SFTP_PROTO}, port ${AE_SFTP_PORT})"
# Heredoc unquoted so bash interpolates passwords/paths AND ${exclude_block}.
# Trailing slash on source means "contents of DIST_DIR into REMOTE_DIR".
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
mirror --reverse \
       --delete \
       --parallel=4 \
       --verbose=1 \
${exclude_block}       "${DIST_DIR}/" "${REMOTE_DIR}"
bye
LFTP

# ──────────────────────────────────────────────────────────────────────────
# Step 5b — vendored-JS root-asset sync.
#
# Same as prod: these files live at public_html/assets/javascripts/ (NOT
# under /preview/) and the build references them root-relative. This step
# keeps the staging deploy self-sufficient so /preview/ HTML resolves its
# vendored JS even on a fresh account state.
#
# `put -O <dir>` overwrites if-different, no --delete, no mirror — we
# cannot accidentally remove anything from assets/javascripts/ even if
# the allowlist shrinks.
# ──────────────────────────────────────────────────────────────────────────
echo "==> Syncing vendored JS allowlist → ${AE_SFTP_HOST}:${ROOT_ASSETS_REMOTE_DIR}/"
{
  echo "set ftp:ssl-allow yes"
  echo "set ftp:ssl-force yes"
  echo "set ftp:ssl-protect-data yes"
  echo "set ssl:verify-certificate no"
  echo "set sftp:auto-confirm yes"
  echo "set net:max-retries 1"
  echo "set net:reconnect-interval-base 5"
  echo "set net:timeout 30"
  echo "user \"${AE_SFTP_USER}\" \"${AE_SFTP_PASS}\""
  echo "mkdir -p -f \"${ROOT_ASSETS_REMOTE_DIR}\""
  for f in "${VENDORED_JS_ALLOWLIST[@]}"; do
    echo "put -O \"${ROOT_ASSETS_REMOTE_DIR}\" \"${DIST_DIR}/assets/javascripts/${f}\""
  done
  echo "bye"
} | lftp -p "${AE_SFTP_PORT}" "${AE_SFTP_PROTO}://${AE_SFTP_HOST}"
echo "    Uploaded ${#VENDORED_JS_ALLOWLIST[@]} vendored JS file(s) to ${ROOT_ASSETS_REMOTE_DIR}/"

# ──────────────────────────────────────────────────────────────────────────
# Step 6 — post-deploy smoke.
#
# Fetch the staging home AND the PDP page (the thing being shipped) and
# assert 200 on both.
#
# Note: the apex 301 (`1-year-pdc → ...`) lives in .htaccess at the apex
# webroot and does NOT fire under /preview/. Don't expect a redirect here.
# ──────────────────────────────────────────────────────────────────────────
echo "==> Smoke-testing ${STAGING_URL}"
status="$(curl -sIL -o /dev/null -w '%{http_code}' "${STAGING_URL}")"
if [[ "${status}" != "200" ]]; then
  echo "FATAL: ${STAGING_URL} returned HTTP ${status} (expected 200)." >&2
  exit 1
fi
echo "    ${STAGING_URL} -> 200 OK"

echo "==> Smoke-testing ${STAGING_PDP_URL}"
pdp_status="$(curl -sIL -o /dev/null -w '%{http_code}' "${STAGING_PDP_URL}")"
if [[ "${pdp_status}" != "200" ]]; then
  echo "FATAL: ${STAGING_PDP_URL} returned HTTP ${pdp_status} (expected 200)." >&2
  exit 1
fi
echo "    ${STAGING_PDP_URL} -> 200 OK"

# Confirm we shipped staging-shape — /preview/ hrefs present in served HTML.
if ! curl -sL "${STAGING_URL}" | grep -qE 'href="/preview/'; then
  echo "FATAL: ${STAGING_URL} HTML has no /preview/ hrefs. Wrong build shipped." >&2
  exit 1
fi
echo "    /preview/ references present in staging HTML"

admin_status="$(curl -sIL -o /dev/null -w '%{http_code}' "${STAGING_ADMIN_URL}")"
if [[ "${admin_status}" != "200" ]]; then
  echo "WARN: ${STAGING_ADMIN_URL} returned HTTP ${admin_status} (expected 200)." >&2
  # Don't fail — admin can return non-200 depending on Sveltia JS init state.
else
  echo "    ${STAGING_ADMIN_URL} -> 200 OK"
fi

echo ""
echo "==> Staging deploy complete."
echo "    Preview: ${STAGING_URL}"
echo "    PDP:     ${STAGING_PDP_URL}"
echo "    Admin:   ${STAGING_ADMIN_URL}"
echo "    Pages:   ${dist_pages}"
echo "    Size:    ${dist_size}"
