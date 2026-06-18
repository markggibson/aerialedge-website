#!/usr/bin/env bash
#
# deploy-prod.sh — Phase 7b manual SFTP deploy to aerialedge.co.uk/ (apex).
#
# Renamed and retargeted from Phase 6/7a `deploy-staging.sh`. Same FTPES
# plumbing, but writes to the WEBROOT of public_html/ (where Astro lives
# post-cutover) instead of public_html/v2/.
#
# Wynn writes this; Mark runs it as the break-glass when the GitHub
# Actions workflow at `.github/workflows/deploy-prod.yml` is broken or
# unavailable. Credentials are read from env vars Mark sets locally —
# they never enter the repo and never enter chat.
#
# Usage (from Mark's terminal):
#
#   export AE_SFTP_HOST=ftp.circushost.com
#   export AE_SFTP_USER=<rochen-ftp-user>
#   export AE_SFTP_PASS=<rochen-ftp-password>
#   # Optional. Default proto is `ftp` (FTPES — explicit FTP over TLS, port 21).
#   # export AE_SFTP_PROTO=ftp        # ftp (FTPES) or sftp
#   # export AE_SFTP_PORT=21          # default: 21 for ftp, 22 for sftp
#   ./scripts/deploy-prod.sh
#
# ─── DELETE-STEP DESIGN (post-incident 2026-06-16, task #744) ──────────────
# CHOSEN APPROACH: keep `mirror -R --delete` but make it safe via (a) a
# COMPREHENSIVE, EXPLICIT protected-path exclude list covering every known
# co-hosted path in the shared webroot, and (b) a HARD GUARDRAIL that aborts
# the deploy if dist/ contains a top-level entry outside the Astro-owned
# allowlist (so junk can never be uploaded, and the exclude list never has
# to defend against an unexpected dist/ shape).
#
# WHY keep --delete: dist/ is the source of truth for the Astro site's OWN
# pages. When an Astro page is genuinely removed (e.g. the retired
# `1-year-pdc/`), --delete is what cleans up the stale remote copy. Dropping
# --delete entirely would leave orphaned pages live forever. A manifest-diff
# delete was considered but rejected as more moving parts for the same
# guarantee the exclude list already gives — the failure mode here was a
# missing exclude, not the lack of a manifest.
#
# WHY this is now safe: the webroot is SHARED. It co-hosts preview/ (staging),
# aewiki/, a Drupal install (sites/, settings.php, …), v1-archive/, the
# 5.8 GB assets/ tree, newsletter/, zArchive/, old Jekyll source dirs, and
# Rochen-managed dirs (cgi-bin/, .well-known/). The 2026-06-15 incident
# deleted all of these because --delete compared dist/ against the FTP root
# and the exclude list only covered v1-archive/ + assets/ + .well-known/.
# The PROTECTED_PATHS array below now enumerates EVERY co-hosted path so
# --delete can never touch anything the Astro build does not own.
# ───────────────────────────────────────────────────────────────────────────
#
# What it does (in order):
#   1. Sanity-checks the env vars are set.
#   2. Sanity-checks `lftp` is on PATH.
#   3. Cleans dist/ and runs a fresh PROD build (SITE_BASE unset → '/').
#   4. Sanity-checks dist/index.html + admin + vendored JS.
#   4b. HARD GUARDRAIL — asserts every top-level entry in dist/ is in the
#       Astro-owned allowlist. Aborts if dist/ carries anything unexpected.
#   5. Uploads dist/* to public_html/ root on Rochen via lftp `mirror -R`
#      with the full PROTECTED_PATHS exclude list (and prints what will be
#      protected before uploading).
#   5b. Uploads the vendored-JS allowlist to public_html/assets/javascripts/.
#       (Redundant once cutover lands, but harmless and protects against
#       accidental deletes.)
#   6. Fetches https://aerialedge.co.uk/ post-deploy and asserts 200.
#
# Guardrails:
#   - REMOTE_DIR defaults to "" (FTP root = webroot). The script refuses
#     to run if REMOTE_DIR contains anything that looks like a subfolder
#     we shouldn't be touching, e.g. `v1-archive` or `assets/...`.
#   - lftp `mirror -R --delete` only deletes inside REMOTE_DIR. We add an
#     explicit `--exclude-glob` for EVERY entry in PROTECTED_PATHS (see the
#     array below) so the shared webroot's co-hosted content is never
#     touched. This is the root-cause fix for the 2026-06-15 incident.
#   - HARD GUARDRAIL (step 4b): dist/ top-level entries must all be in the
#     Astro-owned allowlist, else abort.
#   - `set -euo pipefail` so any step's failure stops the deploy.
#
# Rollback: use `./scripts/cutover.sh --rollback` to swap v1 back to apex
# (within the 30-day window). After v1-archive/ is deleted, the only
# rollback is to revert the last commit and let the Actions workflow
# redeploy.

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Configuration — REMOTE_DIR defaults to "" (FTP root = webroot). Override
# via AE_REMOTE_DIR if a future Rochen account ever lands at the home dir.
# ──────────────────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ASTRO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly DIST_DIR="${ASTRO_DIR}/dist"
# Rochen FTP user lands INSIDE public_html/. So REMOTE_DIR for an apex
# deploy is "" (the FTP root IS the webroot).
readonly REMOTE_DIR="${AE_REMOTE_DIR:-}"
readonly PROD_URL="https://aerialedge.co.uk/"
readonly PROD_ADMIN_URL="https://aerialedge.co.uk/admin/"

# Carried forward from Phase 7a (#198) — vendored-JS root-asset sync.
# These three files were added to Astro in Phase 3 and don't exist in
# v1's asset tree. Post-cutover they live at public_html/assets/javascripts/
# and the Astro build references them root-relative. The allowlist sync
# ensures they survive any deploy that touches the asset side of the
# webroot.
readonly ROOT_ASSETS_REMOTE_DIR="assets/javascripts"
VENDORED_JS_ALLOWLIST=(
  "imagesloaded.pkgd.js"
  "masonry.pkgd.min.js"
  "menu-toggler.js"
)

# ──────────────────────────────────────────────────────────────────────────
# PROTECTED_PATHS — the shared-webroot co-tenant list (root-cause fix #744).
#
# The Rochen webroot (public_html/) is SHARED. It co-hosts far more than the
# Astro site. `mirror -R --delete` must NEVER touch any of these — they are
# not part of the Astro build and dist/ does not contain them, so without an
# explicit exclude --delete would remove every one of them (it did, on
# 2026-06-15).
#
# Each entry is excluded both bare and with a trailing slash, because lftp's
# --exclude-glob matches the remote entry name and a dir can present either
# way depending on listing. ADD A NEW ENTRY HERE the moment any new
# co-tenant is created in the webroot. Treat this list as load-bearing.
# ──────────────────────────────────────────────────────────────────────────
PROTECTED_PATHS=(
  # ── Our own surfaces we deploy separately (must survive a prod deploy) ──
  "preview"        # staging env — redeployed via deploy-staging.sh. CRITICAL.
  "v2"             # retired staging path; may still hold content. Do not touch.
  # ── Rollback window + shared asset tree (pre-existing protections) ──
  "v1-archive"     # Mark's 30-day rollback window.
  "assets"         # 5.8 GB Rochen-resident shared tree (vendored-JS sync is
                   # the ONLY write path into it, step 5b — never via mirror).
  # ── Other co-hosted apps / content (deleted in the incident) ──
  "aewiki"         # disposable per Mark, but must not be touched further.
  "sites"          # Drupal — site config + uploaded files (sites/default/files).
  "settings.php"   # Drupal config.
  "default.settings.php"  # Drupal default config.
  # NOTE: "newsletter" is intentionally NOT protected here. The Astro build
  # now EMITS dist/newsletter/ (src/pages/newsletter/), so it is a
  # build-owned top-level path — it lives in ASTRO_OWNED_TOPLEVEL below
  # instead. Excluding it from the mirror would block the newsletter section
  # from ever deploying (and the step-4b guardrail would abort, since dist/
  # carries newsletter/). This mirrors the CI exclude-set side in
  # deploy-prod.yml, where assets/ and newsletter/ are deliberately NOT
  # excluded for the same reason. (Reconciliation from #745 / follow-up #815.)
  "zArchive"       # archived content.
  # ── Old Jekyll source / build dirs left at root (v1 leftovers) ──
  "_includes"
  "_layouts"
  "_posts"
  "_sass"
  "_site"
  "_data"
  "_works"
  "bower_components"
  # ── v1-leftover root files the Astro build does not produce ──
  "feed.xml"
  "manifest.json"
  "favicon.ico"
  "browserconfig.xml"
  # ── Server / control dirs (Rochen- or platform-managed) ──
  "cgi-bin"
  ".well-known"    # Let's Encrypt / ACME — Rochen-managed.
  ".ftpquota"      # auto-regenerated by Rochen.
  # ── Editor / OS noise (kept from prior excludes) ──
  ".DS_Store"
)

# ──────────────────────────────────────────────────────────────────────────
# ASTRO_OWNED_TOPLEVEL — positive allowlist for the step-4b hard guardrail.
#
# Every top-level name the Astro build is allowed to emit into dist/. The
# guardrail aborts if dist/ contains a top-level entry NOT in this set, so a
# stray/junk dir can never be uploaded into the shared webroot. This list is
# the inverse safety net to PROTECTED_PATHS: PROTECTED_PATHS stops --delete
# removing co-tenants; this stops a bad build adding rogue top-level paths.
#
# Derived from the current dist/ shape. When a new Astro top-level page or
# section is added, add its built top-level name here.
# ──────────────────────────────────────────────────────────────────────────
ASTRO_OWNED_TOPLEVEL=(
  ".htaccess" "404.html" "index.html" "robots.txt"
  "sitemap-0.xml" "sitemap-index.xml"
  "_astro" "admin" "assets"
  "blog" "cgfcircusforall" "circus-challenge" "circus-holidays"
  "circus-shows" "classes" "easter-edge" "events" "foundation-course"
  "four-week-intensive" "little-circus-stars" "news" "newsletter" "our-team"
  "phase-2" "philosophy" "portfolio" "privacy"
  "professional-development-programme" "programmes" "protrack" "publish"
  "safeguarding" "scaffold-test" "services" "shows" "sponsored-places"
  "terms" "videos" "youth-performance"
)

# ──────────────────────────────────────────────────────────────────────────
# Step 0 — guardrail: REMOTE_DIR must not target a subfolder we don't own.
#
# After cutover, our "lane" on Rochen is public_html/ root EXCEPT for:
#   - v1-archive/  (Mark's 30-day rollback window — never touch from here)
#   - assets/      (5.8 GB Rochen-resident shared tree — never touch from
#                   here; the narrow vendored-JS sync below is the only
#                   path that writes inside assets/)
#
# Refuse to run if REMOTE_DIR looks like either of those.
# ──────────────────────────────────────────────────────────────────────────
case "${REMOTE_DIR}" in
  ""|/) ;;
  *v1-archive*|*v1_archive*)
    echo "FATAL: REMOTE_DIR (${REMOTE_DIR}) looks like a v1-archive path." >&2
    echo "       Phase 7b deploy refuses to write into the rollback window." >&2
    exit 2
    ;;
  assets|assets/|*/assets|*/assets/*)
    echo "FATAL: REMOTE_DIR (${REMOTE_DIR}) targets the shared assets/ tree." >&2
    echo "       Phase 7b deploy refuses — only the vendored-JS allowlist" >&2
    echo "       step (5b) writes inside assets/." >&2
    exit 2
    ;;
  v2|v2/|*/v2|*/v2/)
    echo "FATAL: REMOTE_DIR (${REMOTE_DIR}) still targets the retired /v2/ path." >&2
    echo "       Phase 7b cuts over to apex root. Unset AE_REMOTE_DIR and re-run," >&2
    echo "       or set it to '' explicitly." >&2
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
# Step 3 — build with default (apex) base.
#
# `npm run build` defaults to base: '/' per astro.config.mjs. We pass
# SITE_BASE='' explicitly to make the intent unambiguous and override
# any env var the user might have left exported from a /v2/ build.
# ──────────────────────────────────────────────────────────────────────────
echo "==> Cleaning ${DIST_DIR}"
rm -rf "${DIST_DIR}"

echo "==> Building (SITE_BASE=, default base '/')"
( cd "${ASTRO_DIR}" && SITE_BASE='' npm run build )

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
# Confirm we built apex-shape, not /v2/-shape — no /v2/ hrefs allowed.
if grep -q 'href="/v2/' "${DIST_DIR}/index.html"; then
  echo "FATAL: ${DIST_DIR}/index.html contains /v2/ hrefs." >&2
  echo "       SITE_BASE leaked into the prod build. Aborting." >&2
  exit 1
fi
dist_size="$(du -sh "${DIST_DIR}" | awk '{print $1}')"
dist_pages="$(find "${DIST_DIR}" -name '*.html' | wc -l | tr -d ' ')"
echo "==> Build OK: ${dist_pages} HTML pages, ${dist_size} total."

# ──────────────────────────────────────────────────────────────────────────
# Step 4b — HARD GUARDRAIL: dist/ must contain only Astro-owned top-level
# entries.
#
# This is the inverse safety net to PROTECTED_PATHS. The exclude list stops
# --delete removing shared co-tenants; this stops a malformed build pushing
# a rogue top-level path into the shared webroot. If dist/ ever grows a
# top-level entry not in ASTRO_OWNED_TOPLEVEL, we abort rather than upload it.
# ──────────────────────────────────────────────────────────────────────────
unexpected=()
for entry in "${DIST_DIR}"/* "${DIST_DIR}"/.[!.]*; do
  [[ -e "${entry}" ]] || continue   # globs that matched nothing
  name="$(basename "${entry}")"
  ok=0
  for allowed in "${ASTRO_OWNED_TOPLEVEL[@]}"; do
    if [[ "${name}" == "${allowed}" ]]; then ok=1; break; fi
  done
  if (( ok == 0 )); then
    unexpected+=("${name}")
  fi
done
if (( ${#unexpected[@]} > 0 )); then
  echo "FATAL: dist/ contains top-level entries not in the Astro-owned" >&2
  echo "       allowlist. Refusing to upload to the shared webroot:" >&2
  for u in "${unexpected[@]}"; do echo "         - ${u}" >&2; done
  echo "" >&2
  echo "       If these are legitimate new Astro pages, add them to" >&2
  echo "       ASTRO_OWNED_TOPLEVEL in this script. Otherwise the build" >&2
  echo "       is wrong — do not deploy." >&2
  exit 2
fi
echo "==> Guardrail OK: all dist/ top-level entries are Astro-owned."

# ──────────────────────────────────────────────────────────────────────────
# Step 5 — upload via lftp.
#
# `mirror -R` = reverse mirror, upload local → remote. With --delete it
# removes orphaned remote files inside REMOTE_DIR (here: the FTP root =
# shared webroot). Because the webroot is shared, --delete is ONLY safe with
# the full PROTECTED_PATHS exclude list below — without it, --delete deletes
# every co-tenant dist/ doesn't contain (the 2026-06-15 incident).
#
# The --exclude-glob flags are built programmatically from PROTECTED_PATHS
# (each entry both bare and with a trailing slash) into EXCLUDE_ARGS, so the
# exclude set is single-sourced from the one commented array above.
# ──────────────────────────────────────────────────────────────────────────
# Sanity-check vendored-JS allowlist exists in dist before uploading.
for f in "${VENDORED_JS_ALLOWLIST[@]}"; do
  if [[ ! -f "${DIST_DIR}/assets/javascripts/${f}" ]]; then
    echo "FATAL: vendored-JS allowlist file missing from dist: ${f}" >&2
    echo "       Expected at ${DIST_DIR}/assets/javascripts/${f}" >&2
    exit 1
  fi
done

# Build the --exclude-glob block from PROTECTED_PATHS. Each entry is excluded
# both bare and with a trailing slash. The result is a newline-delimited set
# of `--exclude-glob <pat>` continuation lines spliced into the mirror command.
exclude_block=""
for p in "${PROTECTED_PATHS[@]}"; do
  exclude_block+="       --exclude-glob ${p} \\"$'\n'
  exclude_block+="       --exclude-glob ${p}/ \\"$'\n'
done
# Keep the macOS resource-fork glob (not a single-named path, so it lives
# outside PROTECTED_PATHS).
exclude_block+="       --exclude-glob ._* \\"$'\n'

echo "==> PROTECTED (never deleted from the shared webroot):"
for p in "${PROTECTED_PATHS[@]}"; do echo "      - ${p}"; done

target_label="${REMOTE_DIR:-/ (FTP root)}"
echo "==> Uploading ${DIST_DIR}/ → ${AE_SFTP_HOST}:${target_label} (${AE_SFTP_PROTO}, port ${AE_SFTP_PORT})"
# Heredoc unquoted so bash interpolates passwords/paths AND ${exclude_block}.
# Trailing slash on source means "contents of DIST_DIR into REMOTE_DIR".
# REMOTE_DIR may be empty — lftp treats "" as cwd (FTP root).
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
${exclude_block}       "${DIST_DIR}/" "${REMOTE_DIR:-./}"
bye
LFTP

# ──────────────────────────────────────────────────────────────────────────
# Step 5b — vendored-JS root-asset sync.
#
# Carries forward from Phase 7a deploy-staging.sh. Post-cutover, these
# files already live at public_html/assets/javascripts/ from the workflow
# auto-deploy; this step keeps the local deploy script self-sufficient
# (in case Mark needs to recover from a state where the workflow has
# never run successfully against an apex build).
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
# ──────────────────────────────────────────────────────────────────────────
echo "==> Smoke-testing ${PROD_URL}"
status="$(curl -sIL -o /dev/null -w '%{http_code}' "${PROD_URL}")"
if [[ "${status}" != "200" ]]; then
  echo "FATAL: ${PROD_URL} returned HTTP ${status} (expected 200)." >&2
  exit 1
fi
echo "    ${PROD_URL} -> 200 OK"

# Confirm we shipped apex-shape, not staging-shape — no /v2/ hrefs at apex.
if curl -sL "${PROD_URL}" | grep -qE 'href="/v2/'; then
  echo "FATAL: ${PROD_URL} HTML contains /v2/ hrefs. Wrong build shipped." >&2
  exit 1
fi
echo "    no /v2/ references in apex HTML"

admin_status="$(curl -sIL -o /dev/null -w '%{http_code}' "${PROD_ADMIN_URL}")"
if [[ "${admin_status}" != "200" ]]; then
  echo "WARN: ${PROD_ADMIN_URL} returned HTTP ${admin_status} (expected 200)." >&2
  # Don't fail — admin can return non-200 depending on Sveltia JS init state.
else
  echo "    ${PROD_ADMIN_URL} -> 200 OK"
fi

echo ""
echo "==> Deploy complete."
echo "    Public:  ${PROD_URL}"
echo "    Admin:   ${PROD_ADMIN_URL}"
echo "    Pages:   ${dist_pages}"
echo "    Size:    ${dist_size}"
