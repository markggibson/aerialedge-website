#!/usr/bin/env bash
#
# cutover.sh — Phase 7b apex cutover. THE FINISH LINE.
#
# Switches https://aerialedge.co.uk/ from v1 Jekyll to the new Astro
# build currently living at https://aerialedge.co.uk/v2/. v1 is moved
# into public_html/v1-archive/ for a 30-day hot-rollback window. v2's
# contents move UP to public_html/ root.
#
# `assets/` (5.8 GB) STAYS at public_html/assets/ — both v1 and v2
# reference root-relative /assets/... paths. NEVER MOVED. NEVER TOUCHED.
#
# This script is:
#   - idempotent (running twice after success fails loudly)
#   - reversible (--rollback puts v1 back at root)
#   - dry-runnable (--dry-run prints operations, performs nothing)
#
# Mark runs this locally from his terminal. Wynn ships it; Wynn does
# not run it. Brief: BKM/Projects/website-redev/notes/2026-05-16-wynn-phase-7b-brief.md
#
# Usage:
#   export AE_SFTP_HOST=ftp.circushost.com
#   export AE_SFTP_USER=<rochen-ftp-user>
#   export AE_SFTP_PASS=<rochen-ftp-password>
#   # Optional: export AE_SFTP_PORT=21
#
#   ./astro/scripts/cutover.sh --dry-run    # read what would happen
#   ./astro/scripts/cutover.sh              # run the cutover
#   ./astro/scripts/cutover.sh --rollback   # undo (v1-archive → root, root → v2)
#   ./astro/scripts/cutover.sh --rollback --dry-run

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# UNTOUCHABLE PATHS — never moved, never copied, never deleted.
# Hard-coded at the top of the script per Phase 7b brief guardrail.
# If you find yourself adding to this list, STOP and check the brief.
# ──────────────────────────────────────────────────────────────────────────
readonly UNTOUCHABLE_PATHS=(
  "assets"          # 5.8 GB shared between v1 and v2 (root-relative URLs)
  ".well-known"     # Let's Encrypt ACME challenge dir, Rochen-managed
  ".ftpquota"       # Rochen auto-regenerates this
)

# ──────────────────────────────────────────────────────────────────────────
# V1 ROOT ITEMS — what moves from public_html/ → public_html/v1-archive/.
#
# Defense-in-depth: hard-coded allowlist, NOT a wildcard. Anything on the
# Rochen webroot not listed here is left alone. Verified against the v1
# Jekyll source tree at BKM/Product/Website/aerialedge-jekyll/ (the
# Dropbox-synced working copy).
#
# Files first (top-level files), then directories. Both `.html` pages
# and the misc top-level files v1 ships at root.
# ──────────────────────────────────────────────────────────────────────────
readonly V1_ROOT_FILES=(
  # v1 pages — every top-level *.html that ships
  "1-year-pdc.html"
  "404.html"
  "Safeguarding.html"
  "archives.html"
  "browserconfig.xml"
  "categories.html"
  "circus-holidays.html"
  "easter-edge.html"
  "favicon.ico"
  "feed.xml"
  "foundation-course.html"
  "four-week-intensive.html"
  "index.html"
  "index20230211.html"
  "index_OLD.html"
  "little-circus-stars.html"
  "manifest.json"
  "news.html"
  "our-team.html"
  "privacy.html"
  "protrack.html"
  "shows.html"
  "sponsored-places.html"
  "tags.html"
  "terms.html"
  "videos.html"
  "youth-performance.html"
  # v1 misc
  "_config.yml"
  "Favicon Head text"
  # v1 .htaccess family (LiteSpeed cache leftovers + Jekyll-era rules)
  ".htaccess"
  ".litespeed_flag"
)

readonly V1_ROOT_DIRS=(
  # v1 Jekyll content / template subtrees
  "_data"
  "_includes"
  "_layouts"
  "_posts"
  "_posts-templates"
  "_sass"
  "_site"
  "_works"
  "blog"
  "bower_components"
  "shows"
  # Stray empty directory (Phase 6 first-deploy residue, brief 7b-F)
  "public_html"
)

# Optional v1 root items — present on the v1 working copy but may or may
# not be on the live Rochen webroot. Move only if they exist.
readonly V1_ROOT_OPTIONAL=(
  # Old / dated index variants — may not have been deployed
  # (handled via *.bk* glob below)
  # v1 page directories (under directory-permalinks if Jekyll was set
  # that way at any point; safe to archive if present)
  "circus shows"
  "circus ability"
  "circus-holidays"
  "easter-edge"
  "foundation-course"
  "four-week-intensive"
  "little-circus-stars"
  "1-year-pdc"
  "our-team"
  "philosophy"
  "portfolio"
  "programmes"
  "protrack"
  "safeguarding"
  "sponsored-places"
  "terms"
  "videos"
  "youth-performance"
  "services"
  "events"
  "news"
  "classes"
  "circus-holidays"
  "misc"
  "zArchive"
)

# v1 .htaccess backup family — moved with a remote glob. lftp supports
# globs in mv via wildcard expansion; we enumerate via `ls` first to
# verify each exists before moving, so dry-run is accurate.
readonly V1_HTACCESS_BACKUPS_GLOB=".htaccess.bk*"
readonly V1_LSCACHE_BACKUPS_GLOB=".htaccess_lscachebak*"

# ──────────────────────────────────────────────────────────────────────────
# Script config
# ──────────────────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ASTRO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_DIR="$(cd "${ASTRO_DIR}/.." && pwd)"
readonly SNAPSHOT_DIR="$(cd "${REPO_DIR}/.." && pwd)/v1-snapshot-2026-05-16"

readonly APEX_URL="https://aerialedge.co.uk/"
readonly STAGING_URL="https://aerialedge.co.uk/v2/"
readonly APEX_ADMIN_URL="https://aerialedge.co.uk/admin/"

readonly REMOTE_ROOT=""        # FTP user lands inside public_html/ → root is ""
readonly REMOTE_ARCHIVE="v1-archive"
readonly REMOTE_V2="v2"

# Tracked across the run for the dry-run summary.
declare -i OPS_PLANNED=0
declare -i OPS_RUN=0

# ──────────────────────────────────────────────────────────────────────────
# CLI parse
# ──────────────────────────────────────────────────────────────────────────
MODE="cutover"
DRY_RUN=0
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    --rollback) MODE="rollback" ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "FATAL: unknown argument: ${arg}" >&2
      echo "Usage: $0 [--dry-run] [--rollback]" >&2
      exit 2
      ;;
  esac
done

# ──────────────────────────────────────────────────────────────────────────
# Logging helpers
# ──────────────────────────────────────────────────────────────────────────
log()  { echo "==> $*"; }
warn() { echo "WARN: $*" >&2; }
fail() { echo "FATAL: $*" >&2; exit 1; }
section() { echo ""; echo "── $* ───────────────────────────────────"; }

dry_or_run() {
  # First arg: human-readable label. Remaining args: lftp commands to run
  # if not in dry-run mode, sent as stdin to a single lftp connection
  # (the caller pipes via subshell).
  local label="$1"; shift
  OPS_PLANNED+=1
  if (( DRY_RUN )); then
    echo "  [dry-run] ${label}"
  else
    echo "  ${label}"
    OPS_RUN+=1
  fi
}

# ──────────────────────────────────────────────────────────────────────────
# Env vars + toolchain
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
  *) fail "AE_SFTP_PROTO must be 'ftp' or 'sftp', got '${AE_SFTP_PROTO}'" ;;
esac
if [[ -z "${AE_SFTP_PORT:-}" ]]; then
  if [[ "${AE_SFTP_PROTO}" == "sftp" ]]; then AE_SFTP_PORT=22; else AE_SFTP_PORT=21; fi
fi
readonly AE_SFTP_PORT

for tool in lftp curl; do
  if ! command -v "${tool}" >/dev/null 2>&1; then
    fail "${tool} not on PATH"
  fi
done

# ──────────────────────────────────────────────────────────────────────────
# lftp wrappers
#
# lftp_script: pipe a here-doc of lftp commands and execute them in one
# connection. Reduces login overhead and prevents Rochen's CSF firewall
# from interpreting many short-lived sessions as a brute-force pattern.
#
# lftp_query: same but used to read state (e.g., directory listings)
# and capture stdout.
# ──────────────────────────────────────────────────────────────────────────
lftp_script() {
  # Reads lftp commands from stdin, executes them. Caller pipes the
  # commands in. Hard exit on any per-command failure (lftp `set
  # cmd:fail-exit yes`).
  lftp -p "${AE_SFTP_PORT}" "${AE_SFTP_PROTO}://${AE_SFTP_HOST}" <<LFTP
set ftp:ssl-allow yes
set ftp:ssl-force yes
set ftp:ssl-protect-data yes
set ssl:verify-certificate no
set sftp:auto-confirm yes
set net:max-retries 1
set net:reconnect-interval-base 5
set net:timeout 30
set cmd:fail-exit yes
user "${AE_SFTP_USER}" "${AE_SFTP_PASS}"
$(cat)
bye
LFTP
}

lftp_query() {
  # Read-only. Returns the stdout of the piped lftp commands.
  lftp -p "${AE_SFTP_PORT}" "${AE_SFTP_PROTO}://${AE_SFTP_HOST}" 2>/dev/null <<LFTP
set ftp:ssl-allow yes
set ftp:ssl-force yes
set ftp:ssl-protect-data yes
set ssl:verify-certificate no
set sftp:auto-confirm yes
set net:max-retries 1
set net:reconnect-interval-base 5
set net:timeout 30
user "${AE_SFTP_USER}" "${AE_SFTP_PASS}"
$(cat)
bye
LFTP
}

# ──────────────────────────────────────────────────────────────────────────
# Remote-state probes
# ──────────────────────────────────────────────────────────────────────────
remote_list_root() {
  # Returns a newline-separated list of names at the FTP root.
  lftp_query <<'LFTP'
cls -1
LFTP
}

# ──────────────────────────────────────────────────────────────────────────
# Untouchable assertion — runs in every mode.
# ──────────────────────────────────────────────────────────────────────────
assert_untouchable_safe() {
  for p in "${UNTOUCHABLE_PATHS[@]}"; do
    if [[ " ${V1_ROOT_FILES[*]} ${V1_ROOT_DIRS[*]} ${V1_ROOT_OPTIONAL[*]} " == *" ${p} "* ]]; then
      fail "internal-consistency: untouchable path '${p}' appears in a move list. Aborting."
    fi
  done
}
assert_untouchable_safe

# ══════════════════════════════════════════════════════════════════════════
# CUTOVER MODE
# ══════════════════════════════════════════════════════════════════════════
do_cutover() {
  section "Phase 7b cutover — apex flip from v1 → Astro"

  if (( DRY_RUN )); then
    log "DRY-RUN mode. No files will be moved on Rochen."
  fi

  # ── Pre-flight assertions ────────────────────────────────────────────
  section "Pre-flight"

  log "Snapshot exists at ${SNAPSHOT_DIR}/?"
  if [[ ! -d "${SNAPSHOT_DIR}" ]]; then
    fail "snapshot dir missing: ${SNAPSHOT_DIR}. Run ./scripts/snapshot-v1.sh first."
  fi
  for s in index.html _config.yml _layouts _posts; do
    if [[ ! -e "${SNAPSHOT_DIR}/${s}" ]]; then
      fail "snapshot incomplete — missing ${SNAPSHOT_DIR}/${s}. Re-run snapshot-v1.sh."
    fi
  done
  echo "    OK — snapshot has sentinel files."

  log "https://aerialedge.co.uk/v2/ currently 200?"
  local v2_status
  v2_status="$(curl -sIL -o /dev/null -w '%{http_code}' "${STAGING_URL}")"
  if [[ "${v2_status}" != "200" ]]; then
    fail "${STAGING_URL} returned HTTP ${v2_status}. Don't cut over if staging is broken."
  fi
  echo "    OK — /v2/ → 200."

  log "Reading Rochen webroot listing..."
  local root_listing
  root_listing="$(remote_list_root)" || fail "couldn't list FTP root."

  # v1-archive must NOT exist (else cutover already ran).
  if echo "${root_listing}" | grep -qE "^v1-archive$|^v1-archive/$"; then
    fail "public_html/v1-archive/ ALREADY EXISTS. Cutover has already run. To re-run, --rollback first."
  fi
  # v2/ must exist with content.
  if ! echo "${root_listing}" | grep -qE "^v2$|^v2/$"; then
    fail "public_html/v2/ does NOT exist on Rochen. Nothing to cut over from."
  fi
  echo "    OK — v1-archive/ absent, v2/ present."

  # Verify untouchables exist where expected (defence-in-depth).
  if ! echo "${root_listing}" | grep -qE "^assets$|^assets/$"; then
    fail "public_html/assets/ does NOT exist on Rochen. Aborting — assets must stay at root post-cutover."
  fi
  echo "    OK — assets/ at root (will NOT be touched)."

  # ── Step 1: create archive dir ───────────────────────────────────────
  section "Step 1 — Create public_html/${REMOTE_ARCHIVE}/"
  dry_or_run "mkdir ${REMOTE_ARCHIVE}/"
  if (( !DRY_RUN )); then
    lftp_script <<LFTP
mkdir -p "${REMOTE_ARCHIVE}"
LFTP
  fi

  # ── Step 2: move v1 root files + dirs into archive ───────────────────
  section "Step 2 — Move v1 → ${REMOTE_ARCHIVE}/"

  # Build the actual move list from V1_ROOT_FILES, V1_ROOT_DIRS, V1_ROOT_OPTIONAL.
  # Only items present in root_listing are moved (idempotent — re-running
  # is a no-op for items already archived).
  local moves=()

  for f in "${V1_ROOT_FILES[@]}"; do
    # Strip leading dot for grep — match against listing.
    if echo "${root_listing}" | grep -Fxq "${f}"; then
      moves+=("${f}")
    fi
  done
  for d in "${V1_ROOT_DIRS[@]}" "${V1_ROOT_OPTIONAL[@]}"; do
    if echo "${root_listing}" | grep -Fxq "${d}"; then
      moves+=("${d}")
    fi
  done

  # Also pick up .htaccess.bk* and .htaccess_lscachebak* via glob.
  # lftp cls -1 emits one name per line so we scan with grep.
  local htbk lscb
  while IFS= read -r htbk; do
    [[ -z "${htbk}" ]] && continue
    moves+=("${htbk}")
  done < <(echo "${root_listing}" | grep -E '^\.htaccess\.bk' || true)
  while IFS= read -r lscb; do
    [[ -z "${lscb}" ]] && continue
    moves+=("${lscb}")
  done < <(echo "${root_listing}" | grep -E '^\.htaccess_lscachebak' || true)

  # Final defence: assert none of the moves are in UNTOUCHABLE_PATHS.
  for m in "${moves[@]}"; do
    for u in "${UNTOUCHABLE_PATHS[@]}"; do
      if [[ "${m}" == "${u}" ]]; then
        fail "internal-consistency: ${m} is in UNTOUCHABLE_PATHS but appears in move list. ABORT."
      fi
    done
    if [[ "${m}" == "${REMOTE_V2}" || "${m}" == "${REMOTE_ARCHIVE}" ]]; then
      fail "internal-consistency: ${m} appeared in move list. ABORT."
    fi
  done

  if (( ${#moves[@]} == 0 )); then
    warn "no v1 items detected at root. Either cutover already ran or v1 is empty. Continuing."
  else
    log "Moving ${#moves[@]} v1 items into ${REMOTE_ARCHIVE}/:"
    for m in "${moves[@]}"; do
      dry_or_run "mv \"${m}\" \"${REMOTE_ARCHIVE}/${m}\""
    done

    if (( !DRY_RUN )); then
      {
        for m in "${moves[@]}"; do
          # lftp `mv` does rename — atomic per-item on the server.
          printf 'mv "%s" "%s/%s"\n' "${m}" "${REMOTE_ARCHIVE}" "${m}"
        done
      } | lftp_script
    fi
  fi

  # ── Step 3: move v2 contents UP to root ──────────────────────────────
  section "Step 3 — Move ${REMOTE_V2}/* → root"

  # We don't enumerate v2 contents from a local mirror — we read what
  # the server actually has, so the script tracks the build that's
  # currently deployed, not the build that was deployed when this
  # script was written.
  local v2_listing
  v2_listing="$(lftp_query <<LFTP
cls -1 "${REMOTE_V2}/"
LFTP
)" || fail "couldn't list ${REMOTE_V2}/."

  local v2_items=()
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    # Skip stray '.' and '..' if lftp emits them.
    [[ "${line}" == "." || "${line}" == ".." ]] && continue
    v2_items+=("${line}")
  done <<<"${v2_listing}"

  if (( ${#v2_items[@]} == 0 )); then
    fail "${REMOTE_V2}/ is empty. Nothing to promote. ABORT."
  fi

  # Final defence: v2/* should never include anything from UNTOUCHABLE_PATHS,
  # AND should never overwrite an UNTOUCHABLE at root (e.g., assets/).
  for item in "${v2_items[@]}"; do
    for u in "${UNTOUCHABLE_PATHS[@]}"; do
      if [[ "${item}" == "${u}" ]]; then
        fail "v2/${item} would overwrite the untouchable root ${u}/. ABORT — investigate why v2 build contains ${u}/."
      fi
    done
  done

  log "Promoting ${#v2_items[@]} items from ${REMOTE_V2}/ to root:"
  for item in "${v2_items[@]}"; do
    dry_or_run "mv \"${REMOTE_V2}/${item}\" \"${item}\""
  done

  if (( !DRY_RUN )); then
    {
      for item in "${v2_items[@]}"; do
        printf 'mv "%s/%s" "%s"\n' "${REMOTE_V2}" "${item}" "${item}"
      done
    } | lftp_script
  fi

  # ── Step 4: remove empty v2/ ─────────────────────────────────────────
  section "Step 4 — Remove empty ${REMOTE_V2}/"
  dry_or_run "rmdir ${REMOTE_V2}/"
  if (( !DRY_RUN )); then
    lftp_script <<LFTP || warn "rmdir ${REMOTE_V2}/ failed — directory may not be empty. Investigate."
rmdir "${REMOTE_V2}"
LFTP
  fi

  # ── Step 5: smoke ────────────────────────────────────────────────────
  section "Step 5 — Smoke test https://aerialedge.co.uk/"

  if (( DRY_RUN )); then
    log "[dry-run] would curl ${APEX_URL} and assert 200 + Astro markers."
  else
    log "GET ${APEX_URL}"
    local apex_status apex_body
    apex_status="$(curl -sIL -o /dev/null -w '%{http_code}' "${APEX_URL}")"
    if [[ "${apex_status}" != "200" ]]; then
      warn "${APEX_URL} returned HTTP ${apex_status}. Cutover applied but smoke FAILED."
      warn "Investigate before running --rollback. /v2/ no longer exists."
      exit 1
    fi
    echo "    ${APEX_URL} → 200"

    apex_body="$(curl -sL "${APEX_URL}")"
    if ! echo "${apex_body}" | grep -q "<title>Aerial Edge"; then
      warn "${APEX_URL} body missing <title>Aerial Edge…</title>. Investigate."
      exit 1
    fi
    echo "    body contains <title>Aerial Edge…</title>"

    # New build must NOT contain /v2/ in any internal URL.
    if echo "${apex_body}" | grep -qE 'href="/v2/'; then
      warn "${APEX_URL} body contains '/v2/' internal links. The wrong build is serving."
      warn "Either the build was emitted with SITE_BASE=/v2/, or v2's HTML didn't get promoted."
      exit 1
    fi
    echo "    no /v2/ references in apex HTML"

    # Spot-check: a known v1-URL-shape internal link should be present
    # (foundation-course is reliably linked from the homepage).
    if ! echo "${apex_body}" | grep -qE 'href="/foundation-course/?"'; then
      warn "${APEX_URL} body missing /foundation-course/ link. Build may be wrong."
      # Soft-warn — don't hard-fail; some homepage variants don't link
      # to foundation-course directly. The /v2/ check above is the
      # load-bearing one.
    else
      echo "    /foundation-course/ link present"
    fi
  fi

  # ── Done banner ──────────────────────────────────────────────────────
  section "Cutover complete"
  if (( DRY_RUN )); then
    echo "DRY-RUN summary: ${OPS_PLANNED} ops would run."
    echo ""
    echo "When you're ready, run WITHOUT --dry-run:"
    echo "    ./scripts/cutover.sh"
  else
    echo "Cutover applied. ${OPS_RUN}/${OPS_PLANNED} ops executed."
    echo ""
    echo "    Public:  ${APEX_URL}"
    echo "    Admin:   ${APEX_ADMIN_URL}"
    echo "    Archive: public_html/${REMOTE_ARCHIVE}/  (30-day rollback window)"
    echo ""
    echo "Next steps (from the runbook):"
    echo "  1. Browser smoke test from incognito session"
    echo "  2. Flip Sveltia config.yml (separate commit) — see runbook Step 5"
    echo ""
    echo "If anything is wrong, ROLLBACK with:"
    echo "    ./scripts/cutover.sh --rollback"
  fi
}

# ══════════════════════════════════════════════════════════════════════════
# ROLLBACK MODE
# ══════════════════════════════════════════════════════════════════════════
do_rollback() {
  section "Phase 7b ROLLBACK — restore v1 to apex"

  if (( DRY_RUN )); then
    log "DRY-RUN mode. No files will be moved on Rochen."
  fi

  # ── Pre-flight ──────────────────────────────────────────────────────
  section "Pre-flight"

  log "Reading Rochen webroot listing..."
  local root_listing
  root_listing="$(remote_list_root)" || fail "couldn't list FTP root."

  # v1-archive MUST exist (else there's nothing to roll back from).
  if ! echo "${root_listing}" | grep -qE "^${REMOTE_ARCHIVE}$|^${REMOTE_ARCHIVE}/$"; then
    fail "public_html/${REMOTE_ARCHIVE}/ does NOT exist. Cutover never ran — nothing to roll back."
  fi
  echo "    OK — ${REMOTE_ARCHIVE}/ exists."

  # assets/ must still exist at root.
  if ! echo "${root_listing}" | grep -qE "^assets$|^assets/$"; then
    fail "public_html/assets/ missing. Refusing to roll back into a damaged state."
  fi

  # ── Step 1: move new-build items at root → v2/ ──────────────────────
  section "Step 1 — Restore ${REMOTE_V2}/ and move new build there"

  # The new build's items at root are: everything in root_listing that
  # is NOT in UNTOUCHABLE_PATHS and NOT REMOTE_ARCHIVE.
  local new_build_items=()
  while IFS= read -r item; do
    [[ -z "${item}" ]] && continue
    [[ "${item}" == "." || "${item}" == ".." ]] && continue
    # Skip untouchables.
    local is_untouchable=0
    for u in "${UNTOUCHABLE_PATHS[@]}"; do
      if [[ "${item}" == "${u}" ]]; then is_untouchable=1; break; fi
    done
    (( is_untouchable )) && continue
    # Skip the archive itself.
    [[ "${item}" == "${REMOTE_ARCHIVE}" ]] && continue
    # Skip any pre-existing v2/ (shouldn't exist post-cutover, but be safe).
    [[ "${item}" == "${REMOTE_V2}" ]] && continue
    new_build_items+=("${item}")
  done <<<"${root_listing}"

  if (( ${#new_build_items[@]} == 0 )); then
    warn "no new-build items at root. Already rolled back? Continuing."
  fi

  log "Creating ${REMOTE_V2}/ and moving ${#new_build_items[@]} items into it:"
  dry_or_run "mkdir -p ${REMOTE_V2}/"
  for item in "${new_build_items[@]}"; do
    dry_or_run "mv \"${item}\" \"${REMOTE_V2}/${item}\""
  done

  if (( !DRY_RUN )); then
    {
      printf 'mkdir -p "%s"\n' "${REMOTE_V2}"
      for item in "${new_build_items[@]}"; do
        printf 'mv "%s" "%s/%s"\n' "${item}" "${REMOTE_V2}" "${item}"
      done
    } | lftp_script
  fi

  # ── Step 2: move v1-archive/* back to root ──────────────────────────
  section "Step 2 — Restore v1 from ${REMOTE_ARCHIVE}/ to root"

  local archive_listing
  archive_listing="$(lftp_query <<LFTP
cls -1 "${REMOTE_ARCHIVE}/"
LFTP
)" || fail "couldn't list ${REMOTE_ARCHIVE}/."

  local archived_items=()
  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    [[ "${line}" == "." || "${line}" == ".." ]] && continue
    archived_items+=("${line}")
  done <<<"${archive_listing}"

  if (( ${#archived_items[@]} == 0 )); then
    warn "${REMOTE_ARCHIVE}/ is empty — nothing to restore."
  fi

  # Defence: archived items must not collide with untouchables.
  for item in "${archived_items[@]}"; do
    for u in "${UNTOUCHABLE_PATHS[@]}"; do
      if [[ "${item}" == "${u}" ]]; then
        fail "${REMOTE_ARCHIVE}/${item} would overwrite untouchable root ${u}/. ABORT."
      fi
    done
  done

  log "Promoting ${#archived_items[@]} items from ${REMOTE_ARCHIVE}/ → root:"
  for item in "${archived_items[@]}"; do
    dry_or_run "mv \"${REMOTE_ARCHIVE}/${item}\" \"${item}\""
  done

  if (( !DRY_RUN )); then
    {
      for item in "${archived_items[@]}"; do
        printf 'mv "%s/%s" "%s"\n' "${REMOTE_ARCHIVE}" "${item}" "${item}"
      done
    } | lftp_script
  fi

  # ── Step 3: remove empty v1-archive/ ────────────────────────────────
  section "Step 3 — Remove empty ${REMOTE_ARCHIVE}/"
  dry_or_run "rmdir ${REMOTE_ARCHIVE}/"
  if (( !DRY_RUN )); then
    lftp_script <<LFTP || warn "rmdir ${REMOTE_ARCHIVE}/ failed (may not be empty). Investigate."
rmdir "${REMOTE_ARCHIVE}"
LFTP
  fi

  # ── Step 4: smoke ───────────────────────────────────────────────────
  section "Step 4 — Smoke test apex (expect v1)"

  if (( DRY_RUN )); then
    log "[dry-run] would curl ${APEX_URL} and confirm v1 signature."
  else
    local apex_status apex_body
    apex_status="$(curl -sIL -o /dev/null -w '%{http_code}' "${APEX_URL}")"
    if [[ "${apex_status}" != "200" ]]; then
      warn "${APEX_URL} returned HTTP ${apex_status}. Rollback applied but smoke FAILED."
      exit 1
    fi
    echo "    ${APEX_URL} → 200"

    apex_body="$(curl -sL "${APEX_URL}")"
    # v1 signature: bower_components reference, or Jekyll-typical
    # asset path. The reliable one is `bower_components` (v1 only).
    if echo "${apex_body}" | grep -q "bower_components"; then
      echo "    v1 signature found (bower_components reference)"
    else
      warn "${APEX_URL} body missing v1 signature (bower_components). Verify in browser."
    fi

    # Restored v2/ should now serve 200 again.
    local v2_status_post
    v2_status_post="$(curl -sIL -o /dev/null -w '%{http_code}' "${STAGING_URL}")"
    echo "    ${STAGING_URL} → ${v2_status_post}"
  fi

  section "Rollback complete"
  if (( DRY_RUN )); then
    echo "DRY-RUN summary: ${OPS_PLANNED} ops would run."
    echo ""
    echo "When you're ready: ./scripts/cutover.sh --rollback"
  else
    echo "v1 restored to apex. ${OPS_RUN}/${OPS_PLANNED} ops executed."
    echo "    Public:  ${APEX_URL}  (now serving v1)"
    echo "    Staging: ${STAGING_URL}  (new build restored here)"
    echo ""
    echo "Re-run cutover with: ./scripts/cutover.sh"
  fi
}

# ══════════════════════════════════════════════════════════════════════════
# Main
# ══════════════════════════════════════════════════════════════════════════
case "${MODE}" in
  cutover)  do_cutover  ;;
  rollback) do_rollback ;;
esac
