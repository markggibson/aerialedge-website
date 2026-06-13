#!/usr/bin/env -S npx tsx
// rewrite-newsletter-images.ts — fix image placeholders in the backfilled
// newsletter archive bodies.
//
// Wynn task #686 (2026-06-13). Mark spotted that the backfilled archive
// shows literal text like `[image: Logo for Aerial Edge, Glasgow's Circus
// School]` instead of rendered images. The original backfill in #678
// copied image files but did not rewrite the body markdown because the
// Rochen extractor (session #36) emits `[image: alt]` placeholders rather
// than Markdown `![](url)` syntax.
//
// Strategy (after investigating the extractor + corpus):
//
//   1. Parse the bottom `## Images` manifest of each issue (the table
//      that lists `images/.../img-NN.<ext>` and the alt for each).
//      The manifest already uses the new `/assets/images/newsletter/<slug>/`
//      paths because the backfill rewrote them.
//
//   2. Walk the body's `[image: alt]` placeholders. The extractor only
//      emitted a placeholder when the HTML `<img>` had non-empty alt
//      (extract_newsletters.py L108). The manifest, conversely, only
//      stores alt text for the image that was DOWNLOADED — small/tracking
//      images are filtered out, so many manifest entries show `alt: (none)`
//      while having no body placeholder, and many body placeholders refer
//      to images that were never saved.
//
//      Reliable matches:
//        - When a body `[image: ALT]` matches a manifest alt exactly,
//          rewrite to `![ALT](/assets/.../img-NN.<ext>)`.
//        - In practice this only catches img-01 (the Logo) because the
//          extractor strips alt on most other images. That is the main
//          fix Mark called out.
//
//      Unreliable matches:
//        - For body placeholders with no manifest match, strip the line.
//          This removes the literal `[image: ...]` text from the rendered
//          article without inventing a wrong file pointer.
//
//   3. Convert the bottom `## Images` manifest from a plain bulleted list
//      of paths into a Markdown image gallery so the rest of the saved
//      images (Spring Ball poster, fly pole demo, etc. — images without
//      alt that the body never referenced) render at the end of the
//      article. Each image renders with empty alt.
//
// Usage:
//
//   npx tsx scripts/rewrite-newsletter-images.ts            # all years
//   npx tsx scripts/rewrite-newsletter-images.ts --dry-run  # preview
//
// Idempotent — bodies that have already been rewritten (no `[image: ...]`
// placeholders left and the manifest list converted) get skipped.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASTRO_ROOT = path.resolve(__dirname, '..');
const CONTENT_ROOT = path.join(ASTRO_ROOT, 'src/content/newsletter');

interface Args {
  dryRun: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let dryRun = false;
  for (const arg of args) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npx tsx scripts/rewrite-newsletter-images.ts [--dry-run]');
      process.exit(0);
    }
  }
  return { dryRun };
}

interface ManifestEntry {
  filename: string; // e.g. "img-01.png"
  url: string; // e.g. "/assets/images/newsletter/<slug>/img-01.png"
  sizeKB: number;
  alt: string; // empty string when manifest had "(none)"
}

interface RewriteStats {
  file: string;
  slug: string;
  placeholdersBefore: number;
  placeholdersMatched: number;
  placeholdersStripped: number;
  manifestImages: number;
  manifestRendered: number;
  manifestUnreferenced: number;
  status: 'rewrote' | 'skipped-no-change' | 'skipped-empty';
}

const MANIFEST_LINE_RE =
  /^- `(\/assets\/images\/newsletter\/[^`]+\/img-\d+\.[a-zA-Z]+)` \((\d+) KB\) — alt: (.+)$/;
const IMG_PLACEHOLDER_RE = /\[image: ([^\]]*)\]/g;

function parseManifest(body: string): {
  manifestStart: number;
  entries: ManifestEntry[];
  alreadyRewritten: boolean;
} {
  // Look for the `## Images` section near the end.
  const lines = body.split('\n');
  let imagesIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === '## Images') {
      imagesIdx = i;
      break;
    }
  }
  if (imagesIdx === -1) return { manifestStart: -1, entries: [], alreadyRewritten: false };

  // Idempotence guard: if the manifest section already contains rewritten
  // `![](url)` gallery lines, the body has been processed by this script
  // before. Don't try to re-parse — return alreadyRewritten=true so the
  // caller short-circuits.
  let sawGallery = false;
  let sawOldFormat = false;
  for (let i = imagesIdx + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (/^!\[[^\]]*\]\(\/assets\/images\/newsletter\//.test(trimmed)) {
      sawGallery = true;
    } else if (MANIFEST_LINE_RE.test(lines[i])) {
      sawOldFormat = true;
    } else if (trimmed.startsWith('### ')) {
      // subsection header (e.g. "### Image manifest") — keep scanning
    }
  }
  if (sawGallery && !sawOldFormat) {
    return { manifestStart: imagesIdx, entries: [], alreadyRewritten: true };
  }

  const entries: ManifestEntry[] = [];
  for (let i = imagesIdx + 1; i < lines.length; i++) {
    const m = lines[i].match(MANIFEST_LINE_RE);
    if (m) {
      const url = m[1];
      const filename = url.split('/').pop() ?? '';
      const sizeKB = parseInt(m[2], 10);
      const altRaw = m[3].trim();
      const alt = altRaw === '(none)' ? '' : altRaw;
      entries.push({ filename, url, sizeKB, alt });
    } else if (lines[i].trim() === '' && entries.length > 0) {
      // tolerate trailing blank lines
      continue;
    }
  }
  return { manifestStart: imagesIdx, entries, alreadyRewritten: false };
}

function rewriteOne(raw: string): { output: string; stats: Omit<RewriteStats, 'file' | 'slug' | 'status'> } {
  // Split frontmatter from body.
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return {
      output: raw,
      stats: {
        placeholdersBefore: 0,
        placeholdersMatched: 0,
        placeholdersStripped: 0,
        manifestImages: 0,
        manifestRendered: 0,
        manifestUnreferenced: 0,
      },
    };
  }
  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  const { manifestStart, entries, alreadyRewritten } = parseManifest(body);
  if (alreadyRewritten) {
    return {
      output: raw,
      stats: {
        placeholdersBefore: 0,
        placeholdersMatched: 0,
        placeholdersStripped: 0,
        manifestImages: 0,
        manifestRendered: 0,
        manifestUnreferenced: 0,
      },
    };
  }

  // Walk body lines (excluding manifest section), rewrite placeholders.
  const lines = body.split('\n');
  const bodyEnd = manifestStart === -1 ? lines.length : manifestStart;

  // Build alt-text lookup from manifest (only entries with non-empty alt).
  const altLookup = new Map<string, ManifestEntry>();
  for (const e of entries) {
    if (e.alt) {
      altLookup.set(e.alt, e);
    }
  }

  let placeholdersBefore = 0;
  let placeholdersMatched = 0;
  let placeholdersStripped = 0;
  const referencedFilenames = new Set<string>();

  const newBodyLines: string[] = [];
  for (let i = 0; i < bodyEnd; i++) {
    const line = lines[i];
    // Count placeholders on the line.
    const matches = [...line.matchAll(IMG_PLACEHOLDER_RE)];
    if (matches.length === 0) {
      newBodyLines.push(line);
      continue;
    }

    placeholdersBefore += matches.length;

    let rewritten = line;
    let lineHasUnmatched = false;
    for (const m of matches) {
      const fullPlaceholder = m[0];
      const altText = m[1].trim();
      const manifestEntry = altText ? altLookup.get(altText) : undefined;
      if (manifestEntry) {
        const escapedAlt = altText.replace(/]/g, '\\]');
        const replacement = `![${escapedAlt}](${manifestEntry.url})`;
        rewritten = rewritten.replace(fullPlaceholder, replacement);
        placeholdersMatched += 1;
        referencedFilenames.add(manifestEntry.filename);
      } else {
        rewritten = rewritten.replace(fullPlaceholder, '');
        placeholdersStripped += 1;
        lineHasUnmatched = true;
      }
    }

    // If after stripping the line is only whitespace, drop it.
    if (rewritten.trim() === '') {
      // Drop entirely.
      continue;
    }
    // The Rochen extractor preserves indentation from the source HTML
    // (4–14 leading spaces are common around `[image: ...]` placeholders),
    // which Markdown parses as a code block. Strip the leading indent so
    // the `![](url)` renders as an actual image. Only strip when the line
    // contains nothing but image syntax (and stripped placeholders).
    if (/^\s+!\[/.test(rewritten) && /^\s*(!\[[^\]]*\]\([^)]+\)\s*)+$/.test(rewritten)) {
      rewritten = rewritten.trimStart();
    }
    newBodyLines.push(rewritten);
  }

  // Now build the new manifest section as a gallery, marking unreferenced
  // images so they render at the bottom of the article.
  const galleryLines: string[] = [];
  let manifestRendered = 0;
  let manifestUnreferenced = 0;
  if (entries.length > 0) {
    galleryLines.push('---', '', '## Images');
    // Render every image. For ones already referenced inline, list them as a
    // small bulleted manifest; for ones NOT referenced inline, render as a
    // gallery of inline `![]()` images so they actually display.
    const unreferenced = entries.filter((e) => !referencedFilenames.has(e.filename));
    const referenced = entries.filter((e) => referencedFilenames.has(e.filename));
    manifestUnreferenced = unreferenced.length;
    manifestRendered = unreferenced.length;

    if (unreferenced.length > 0) {
      galleryLines.push('');
      for (const e of unreferenced) {
        const altEscaped = e.alt.replace(/]/g, '\\]');
        galleryLines.push(`![${altEscaped}](${e.url})`);
        galleryLines.push('');
      }
    }

    if (referenced.length > 0) {
      galleryLines.push('### Already referenced inline above');
      galleryLines.push('');
      for (const e of referenced) {
        const altLabel = e.alt || '(no alt)';
        // Use a non-manifest-shaped line so the idempotence guard doesn't
        // misread it on a second run.
        galleryLines.push(`- _Rendered inline:_ \`${e.url}\` (${e.sizeKB} KB, alt: ${altLabel})`);
      }
    }
  }

  // Trim trailing blank lines AND a trailing `---` separator from the body
  // portion. The extractor wrote `---\n\n## Images\n...` and we rebuild that
  // separator ourselves below — avoid a stray double rule.
  while (
    newBodyLines.length > 0 &&
    (newBodyLines[newBodyLines.length - 1].trim() === '' ||
      newBodyLines[newBodyLines.length - 1].trim() === '---')
  ) {
    newBodyLines.pop();
  }

  const newBody = newBodyLines.join('\n') + (galleryLines.length > 0 ? '\n\n' + galleryLines.join('\n') : '') + '\n';

  const output = `---\n${frontmatter}\n---\n${newBody}`;

  return {
    output,
    stats: {
      placeholdersBefore,
      placeholdersMatched,
      placeholdersStripped,
      manifestImages: entries.length,
      manifestRendered,
      manifestUnreferenced,
    },
  };
}

async function processIssue(filePath: string, args: Args): Promise<RewriteStats> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const slug = path.basename(filePath, '.md');
  const file = path.relative(ASTRO_ROOT, filePath);

  if (!raw.trim()) {
    return {
      file,
      slug,
      placeholdersBefore: 0,
      placeholdersMatched: 0,
      placeholdersStripped: 0,
      manifestImages: 0,
      manifestRendered: 0,
      manifestUnreferenced: 0,
      status: 'skipped-empty',
    };
  }

  const { output, stats } = rewriteOne(raw);

  if (stats.placeholdersBefore === 0 && stats.manifestImages === 0) {
    return {
      file,
      slug,
      ...stats,
      status: 'skipped-no-change',
    };
  }

  if (output === raw) {
    return {
      file,
      slug,
      ...stats,
      status: 'skipped-no-change',
    };
  }

  if (!args.dryRun) {
    await fs.writeFile(filePath, output, 'utf-8');
  }
  return {
    file,
    slug,
    ...stats,
    status: 'rewrote',
  };
}

async function listIssues(): Promise<string[]> {
  const files: string[] = [];
  const years = await fs.readdir(CONTENT_ROOT);
  for (const year of years.sort()) {
    const yearDir = path.join(CONTENT_ROOT, year);
    const stat = await fs.stat(yearDir);
    if (!stat.isDirectory()) continue;
    const issues = (await fs.readdir(yearDir)).filter((f) => f.endsWith('.md')).sort();
    for (const issue of issues) {
      files.push(path.join(yearDir, issue));
    }
  }
  return files;
}

async function main() {
  const args = parseArgs();
  const issues = await listIssues();
  console.log(`Found ${issues.length} newsletter entries`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log('');

  const results: RewriteStats[] = [];
  for (const file of issues) {
    try {
      const r = await processIssue(file, args);
      results.push(r);
      const tag = `[${r.status}]`.padEnd(22);
      const detail =
        r.status === 'rewrote'
          ? ` placeholders: ${r.placeholdersMatched} matched + ${r.placeholdersStripped} stripped, manifest: ${r.manifestImages} images (${r.manifestUnreferenced} rendered inline at bottom)`
          : '';
      console.log(`${tag} ${path.basename(file)}${detail}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[error]                ${path.basename(file)} — ${msg}`);
    }
  }

  console.log('');
  console.log('=== Summary ===');
  const tally = (s: RewriteStats['status']) => results.filter((r) => r.status === s).length;
  console.log(`Rewrote:              ${tally('rewrote')}`);
  console.log(`Skipped (no change):  ${tally('skipped-no-change')}`);
  console.log(`Skipped (empty):      ${tally('skipped-empty')}`);
  const totalPlaceholders = results.reduce((a, r) => a + r.placeholdersBefore, 0);
  const totalMatched = results.reduce((a, r) => a + r.placeholdersMatched, 0);
  const totalStripped = results.reduce((a, r) => a + r.placeholdersStripped, 0);
  const totalManifestImages = results.reduce((a, r) => a + r.manifestImages, 0);
  const totalManifestRendered = results.reduce((a, r) => a + r.manifestRendered, 0);
  console.log(`Placeholders found:        ${totalPlaceholders}`);
  console.log(`Placeholders matched:      ${totalMatched}`);
  console.log(`Placeholders stripped:     ${totalStripped}`);
  console.log(`Manifest images:           ${totalManifestImages}`);
  console.log(`Manifest images rendered:  ${totalManifestRendered} (no body reference, now visible at bottom)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
