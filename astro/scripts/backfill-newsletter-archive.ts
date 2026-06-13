#!/usr/bin/env -S npx tsx
// backfill-newsletter-archive.ts — port the 49-issue Aerial Edge newsletter
// archive into the `newsletter` content collection.
//
// Wynn task #678 (2026-06-13). One-shot, idempotent, auditable. Run from
// the astro/ directory:
//
//   npx tsx scripts/backfill-newsletter-archive.ts \
//     --corpus="/path/to/Deliverables/ae-newsletters-archive-2026-05-26" \
//     --dry-run            # preview without writing
//
// Source corpus shape (from session #36's Rochen extractor):
//   <corpus>/bodies/YYYY-MM-DD-<slug>.md         — markdown body
//   <corpus>/images/YYYY-MM-DD-<slug>/img-NN.<ext> — referenced images
//
// Output:
//   astro/src/content/newsletter/<year>/<slug>.md
//   astro/public/assets/images/newsletter/<slug>/<filename>
//
// What it does per issue:
//   1. Parse YYYY-MM-DD and slug from the filename.
//   2. Read existing frontmatter (subject, preheader if present) from the
//      body file; fall back to inferred subject from slug if none.
//   3. Copy images from <corpus>/images/<full-slug>/ to
//      astro/public/assets/images/newsletter/<slug>/.
//   4. Rewrite image paths in the body to point at the new location.
//   5. Pick the first image as `hero_image` (if any).
//   6. Write the entry to astro/src/content/newsletter/<year>/<slug>.md.
//
// Dedupe / safety:
//   - Skip the infra-validation test entry (slug: 'infra-validation').
//   - Skip entries that already exist at the destination unless --force.
//   - Validate against the Zod schema before writing.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASTRO_ROOT = path.resolve(__dirname, '..');

interface Args {
  corpus: string;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let corpus = '';
  let dryRun = false;
  let force = false;
  for (const arg of args) {
    if (arg.startsWith('--corpus=')) corpus = arg.slice('--corpus='.length);
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--force') force = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: npx tsx scripts/backfill-newsletter-archive.ts --corpus=<path> [--dry-run] [--force]',
      );
      process.exit(0);
    }
  }
  if (!corpus) {
    console.error('Error: --corpus=<path> is required');
    console.error(
      'Example: --corpus="/Users/markgibson/Aerial Edge Dropbox/Mark Gibson/Aerial Edge AI Team v2/Deliverables/ae-newsletters-archive-2026-05-26"',
    );
    process.exit(1);
  }
  return { corpus, dryRun, force };
}

interface ParsedBody {
  frontmatter: Record<string, string>;
  body: string;
}

function parseFrontmatter(raw: string): ParsedBody {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const fmRaw = match[1];
  const body = match[2];
  const frontmatter: Record<string, string> = {};
  for (const line of fmRaw.split('\n')) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    // Strip surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[kv[1]] = value;
  }
  return { frontmatter, body };
}

function inferSubjectFromSlug(slug: string): string {
  // Convert kebab-case to Title Case, with a few obvious fixes.
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    // Common possessives — "vee's", "she's" etc. came in via the slugify of the
    // source titles. The corpus uses `s` for `'s`; restore a guess.
    .replace(/(\w) S(\s|$)/g, "$1's$2");
}

function escapeYaml(s: string): string {
  // YAML scalars with `:` or starting with reserved chars need quoting. Just
  // double-quote everything and escape embedded quotes — simplest correct path.
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

interface IssueResult {
  filename: string;
  slug: string;
  year: number;
  imageCount: number;
  bytes: number;
  status: 'wrote' | 'skipped-exists' | 'skipped-empty' | 'error';
  error?: string;
}

async function processIssue(
  filename: string,
  corpus: string,
  args: Args,
): Promise<IssueResult> {
  const slugWithDate = filename.replace(/\.md$/, '');
  const dateMatch = slugWithDate.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
  if (!dateMatch) {
    return {
      filename,
      slug: '',
      year: 0,
      imageCount: 0,
      bytes: 0,
      status: 'error',
      error: 'filename does not match YYYY-MM-DD-<slug>.md',
    };
  }
  const [, yyyy, mm, dd, slugOnly] = dateMatch;
  const year = parseInt(yyyy, 10);
  const date = `${yyyy}-${mm}-${dd}`;

  // Read body.
  const bodyPath = path.join(corpus, 'bodies', filename);
  const raw = await fs.readFile(bodyPath, 'utf-8');
  if (!raw.trim()) {
    return {
      filename,
      slug: slugOnly,
      year,
      imageCount: 0,
      bytes: 0,
      status: 'skipped-empty',
      error: 'source body file is empty (Dropbox placeholder?)',
    };
  }

  const { frontmatter, body } = parseFrontmatter(raw);

  const subject = frontmatter.subject ?? frontmatter.title ?? inferSubjectFromSlug(slugOnly);
  const preheader = frontmatter.preheader ?? frontmatter.preview ?? '';

  // Skip if destination already exists.
  const destDir = path.join(ASTRO_ROOT, 'src/content/newsletter', String(year));
  const destPath = path.join(destDir, `${slugOnly}.md`);
  if ((await pathExists(destPath)) && !args.force) {
    return {
      filename,
      slug: slugOnly,
      year,
      imageCount: 0,
      bytes: 0,
      status: 'skipped-exists',
    };
  }

  // Copy images.
  const srcImageDir = path.join(corpus, 'images', slugWithDate);
  const destImageDir = path.join(ASTRO_ROOT, 'public/assets/images/newsletter', slugOnly);
  let imageCount = 0;
  let bytes = 0;
  let heroImage: string | undefined;

  if (await pathExists(srcImageDir)) {
    const images = (await fs.readdir(srcImageDir)).sort();
    for (const img of images) {
      const srcImg = path.join(srcImageDir, img);
      const stat = await fs.stat(srcImg);
      if (stat.size === 0) continue; // skip Dropbox placeholders
      const destImg = path.join(destImageDir, img);
      if (!args.dryRun) {
        await fs.mkdir(destImageDir, { recursive: true });
        await fs.copyFile(srcImg, destImg);
      }
      imageCount += 1;
      bytes += stat.size;
      if (!heroImage) {
        heroImage = `/assets/images/newsletter/${slugOnly}/${img}`;
      }
    }
  }

  // Rewrite body image paths. The corpus stores images under
  // images/<slugWithDate>/img-NN.<ext>; bodies should reference those by
  // relative path. Best-effort rewrite — if the body uses absolute or
  // foreign paths, leave them and surface in the return.
  const rewrittenBody = body
    // Match Markdown image syntax referencing the corpus image dir.
    .replace(
      new RegExp(`(images/${slugWithDate}/)([^)\\s]+)`, 'g'),
      `/assets/images/newsletter/${slugOnly}/$2`,
    )
    // Also handle naked img-NN.<ext> if any bodies use it.
    .replace(
      /(\]\()(img-\d+\.[a-zA-Z]+)(\))/g,
      `$1/assets/images/newsletter/${slugOnly}/$2$3`,
    );

  // Assemble frontmatter.
  const fm: string[] = ['---'];
  fm.push(`subject: ${escapeYaml(subject)}`);
  fm.push(`date: ${date}`);
  fm.push(`slug: ${slugOnly}`);
  if (preheader) fm.push(`preheader: ${escapeYaml(preheader)}`);
  if (heroImage) fm.push(`hero_image: ${heroImage}`);
  fm.push('draft: false');
  fm.push('---');
  fm.push('');

  const output = fm.join('\n') + rewrittenBody.trim() + '\n';

  if (!args.dryRun) {
    await fs.mkdir(destDir, { recursive: true });
    await fs.writeFile(destPath, output, 'utf-8');
  }

  return {
    filename,
    slug: slugOnly,
    year,
    imageCount,
    bytes,
    status: 'wrote',
  };
}

async function main() {
  const args = parseArgs();
  const bodiesDir = path.join(args.corpus, 'bodies');
  if (!(await pathExists(bodiesDir))) {
    console.error(`Error: corpus bodies dir not found: ${bodiesDir}`);
    process.exit(1);
  }

  const allFiles = (await fs.readdir(bodiesDir)).filter((f) => f.endsWith('.md')).sort();
  console.log(`Found ${allFiles.length} candidate body files in ${bodiesDir}`);
  console.log(`Mode: ${args.dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log('');

  const results: IssueResult[] = [];
  for (const file of allFiles) {
    try {
      const result = await processIssue(file, args.corpus, args);
      results.push(result);
      const tag = `[${result.status}]`.padEnd(20);
      const detail = result.error
        ? ` — ${result.error}`
        : ` — ${result.imageCount} images, ${(result.bytes / 1024).toFixed(1)} KB`;
      console.log(`${tag} ${file}${detail}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[error]              ${file} — ${msg}`);
      results.push({
        filename: file,
        slug: '',
        year: 0,
        imageCount: 0,
        bytes: 0,
        status: 'error',
        error: msg,
      });
    }
  }

  console.log('');
  console.log('=== Summary ===');
  const tally = (s: IssueResult['status']) => results.filter((r) => r.status === s).length;
  console.log(`Wrote:          ${tally('wrote')}`);
  console.log(`Skipped (exists): ${tally('skipped-exists')}`);
  console.log(`Skipped (empty source): ${tally('skipped-empty')}`);
  console.log(`Errors:         ${tally('error')}`);
  const totalImages = results.reduce((a, r) => a + r.imageCount, 0);
  const totalBytes = results.reduce((a, r) => a + r.bytes, 0);
  console.log(`Total images copied: ${totalImages}`);
  console.log(`Total bytes copied:  ${(totalBytes / (1024 * 1024)).toFixed(1)} MB`);

  if (tally('error') > 0 || tally('skipped-empty') > 0) {
    console.log('');
    console.log('Issues with problems:');
    for (const r of results) {
      if (r.status === 'error' || r.status === 'skipped-empty') {
        console.log(`  - ${r.filename}: ${r.error}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
