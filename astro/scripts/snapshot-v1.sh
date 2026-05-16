#!/usr/bin/env bash
#
# snapshot-v1.sh — Phase 7b pre-cutover disaster-recovery snapshot.
#
# Downloads the v1 Jekyll site from Rochen (public_html/*) to a LOCAL
# directory outside any git repo, so we have a known-good copy of what
# the apex was serving the moment before cutover. Mark runs this BEFORE
# running cutover.sh.
#
# Excludes:
#   - assets/  (5.8 GB; Mark already has the full tree in his Dropbox-
#     synced working copy at BKM/Product/Website/aerialedge-jekyll/assets/).
#   - v2/      (we're cutting over FROM /v2/ TO root — no need to
#     snapshot the staging build).
#
# Target: BKM/Product/Website/v1-snapshot-2026-05-16/ (relative to AE
# team-root). NOT inside any git repo. Per Phase 7b brief 7b-E.
#
# Usage:
#   export AE_SFTP_HOST=ftp.circushost.com
#   export AE_SFTP_USER=<rochen-ftp-user>
#   export AE_SFTP_PASS=<rochen-ftp-password>
#   # Optional. Default: 21 (FTPES).
#   # export AE_SFTP_PORT=21
#   ./astro/scripts/snapshot-v1.sh
#
# Idempotent: re-running re-downloads into the same dir (lftp mirror
# without --reverse / without --delete only fetches changed files). If
# the target dir already exists with content from a prior run, that's
# fine — the script confirms and continues.
#
# At end, the script asserts the snapshot looks plausible:
#   - >50 files total (v1 root has ~80 files/dirs)
#   - total size between 5 MB and 500 MB (sanity bounds — without the
#     assets/ tree, v1 source is around 30-60 MB)
#   - sentinel files present: index.html, _config.yml, _layouts/, _posts/

set -euo pipefail

# ──────────────────────────────────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ASTRO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
readonly REPO_DIR="$(cd "${ASTRO_DIR}/.." && pwd)"
# REPO_DIR is BKM/Product/Website/aerialedge-jekyll. We want
# BKM/Product/Website/v1-snapshot-2026-05-16, one level up + sibling.
readonly SNAPSHOT_DIR="$(cd "${REPO_DIR}/.." && pwd)/v1-snapshot-2026-05-16"

# Rochen FTP user lands INSIDE public_html/ (matches deploy-staging.sh).
# So the REMOTE source is "/" (FTP root = webroot).
readonly REMOTE_DIR="${AE_REMOTE_SOURCE:-/}"

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
if ! command -v lftp >/dev/null 2>&1; then
  echo "FATAL: lftp not on PATH. brew install lftp" >&2
  exit 1
fi

# ──────────────────────────────────────────────────────────────────────────
# Step 3 — prepare target dir.
# ──────────────────────────────────────────────────────────────────────────
if [[ -e "${SNAPSHOT_DIR}" && ! -d "${SNAPSHOT_DIR}" ]]; then
  echo "FATAL: ${SNAPSHOT_DIR} exists but is not a directory." >&2
  exit 1
fi

mkdir -p "${SNAPSHOT_DIR}"
echo "==> Snapshot target: ${SNAPSHOT_DIR}"

# ──────────────────────────────────────────────────────────────────────────
# Step 4 — mirror v1 from Rochen.
#
# lftp `mirror` (no --reverse) = remote-to-local download.
# --exclude-glob 'assets/' skips the 5.8 GB asset tree at root.
# --exclude-glob 'v2/' skips the staging build.
# --exclude-glob 'v1-archive/' skips any prior cutover residue.
# We're NOT using --delete — this is a download, missing locally is fine.
# --parallel modest; Rochen is shared hosting.
# net:max-retries 1 — fail fast (same as deploy-staging.sh).
# ──────────────────────────────────────────────────────────────────────────
echo "==> Downloading v1 from ${AE_SFTP_HOST}:${REMOTE_DIR} → ${SNAPSHOT_DIR}/"
echo "    Excluding: assets/, v2/, v1-archive/"
echo "    (this can take several minutes; v1 source minus assets is ~30-60 MB)"

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
mirror --parallel=4 \
       --verbose=1 \
       --exclude-glob assets/ \
       --exclude-glob assets \
       --exclude-glob v2/ \
       --exclude-glob v2 \
       --exclude-glob v1-archive/ \
       --exclude-glob v1-archive \
       --exclude-glob .DS_Store \
       --exclude-glob ._* \
       "${REMOTE_DIR}" "${SNAPSHOT_DIR}/"
bye
LFTP

# ──────────────────────────────────────────────────────────────────────────
# Step 5 — plausibility checks.
# ──────────────────────────────────────────────────────────────────────────
echo ""
echo "==> Verifying snapshot..."

file_count="$(find "${SNAPSHOT_DIR}" -type f | wc -l | tr -d ' ')"
total_size_bytes="$(du -sk "${SNAPSHOT_DIR}" | awk '{print $1}')"
total_size_human="$(du -sh "${SNAPSHOT_DIR}" | awk '{print $1}')"

echo "    Files:  ${file_count}"
echo "    Size:   ${total_size_human} (${total_size_bytes} KB)"

if (( file_count < 50 )); then
  echo "FATAL: only ${file_count} files in snapshot. v1 should have >50." >&2
  echo "       Snapshot looks empty or partial. Check FTP creds / connection." >&2
  exit 1
fi

# 5 MB to 500 MB sanity bound (no assets/, no v2/).
if (( total_size_bytes < 5000 )); then
  echo "FATAL: snapshot only ${total_size_human}. Expected at least 5 MB." >&2
  exit 1
fi
if (( total_size_bytes > 500000 )); then
  echo "FATAL: snapshot is ${total_size_human}. Expected under 500 MB." >&2
  echo "       Did the assets/ exclude fire correctly?" >&2
  exit 1
fi

# Sentinel files.
sentinels=(
  "index.html"
  "_config.yml"
  "_layouts"
  "_posts"
)
missing_sentinels=()
for s in "${sentinels[@]}"; do
  if [[ ! -e "${SNAPSHOT_DIR}/${s}" ]]; then
    missing_sentinels+=("${s}")
  fi
done
if (( ${#missing_sentinels[@]} > 0 )); then
  echo "FATAL: snapshot missing v1 sentinel files: ${missing_sentinels[*]}" >&2
  exit 1
fi

# Confirm assets/ was NOT pulled.
if [[ -d "${SNAPSHOT_DIR}/assets" ]]; then
  asset_size_bytes="$(du -sk "${SNAPSHOT_DIR}/assets" | awk '{print $1}')"
  if (( asset_size_bytes > 100000 )); then
    echo "FATAL: ${SNAPSHOT_DIR}/assets is ${asset_size_bytes} KB." >&2
    echo "       The assets/ exclude FAILED. Aborting before snapshot is" >&2
    echo "       mistaken for complete." >&2
    exit 1
  fi
fi

# Confirm v2/ was NOT pulled.
if [[ -d "${SNAPSHOT_DIR}/v2" ]]; then
  v2_files="$(find "${SNAPSHOT_DIR}/v2" -type f | wc -l | tr -d ' ')"
  if (( v2_files > 0 )); then
    echo "FATAL: ${SNAPSHOT_DIR}/v2 has ${v2_files} files." >&2
    echo "       The v2/ exclude FAILED." >&2
    exit 1
  fi
fi

echo ""
echo "==> Snapshot OK."
echo "    Location: ${SNAPSHOT_DIR}"
echo "    Files:    ${file_count}"
echo "    Size:     ${total_size_human}"
echo ""
echo "Disaster-recovery copy of v1 is now on local disk."
echo "Safe to proceed to ./scripts/cutover.sh --dry-run."
