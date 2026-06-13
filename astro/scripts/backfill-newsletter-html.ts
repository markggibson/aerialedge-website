#!/usr/bin/env -S npx tsx
// backfill-newsletter-html.ts — sanitise + rewrite the raw newsletter HTML so
// each backfilled archive entry renders with full subscriber-received fidelity
// (Poppins typography, gold accents, hero, CTA buttons, timeline strips).
//
// Wynn task #692 (2026-06-13). The original markdown extraction was readable
// but stripped all the email chrome. This script processes the raw text/html
// MIME part saved by `Team/tools/rochen-mail/extract_newsletter_html.py` and
// writes a sanitised, rewritten-image-path HTML file alongside each entry.
//
// Source corpus shape:
//   <corpus>/html-bodies/YYYY-MM-DD-<slug>.html        — raw text/html MIME part
//   <corpus>/bodies/YYYY-MM-DD-<slug>.md               — markdown (kept as RSS/SEO source)
//
// Output:
//   astro/src/content/newsletter/<year>/<slug>.html    — sanitised + rewritten HTML
//   (the existing .md frontmatter is augmented with `html_body: <slug>.html`)
//
// Sanitisation:
//   - Strip <script>, inline event handlers (onclick=, onload=, ...)
//   - Strip <link rel="stylesheet">, <base>
//   - Strip <meta http-equiv="refresh"> and similar
//   - Strip tracking pixels (1x1 images, *.list-manage.com, *.mailchimp.com,
//     /open.gif, /beacon, etc.)
//   - Strip mailchimp/GHL unsubscribe-rewriter wrapper anchors? No — leave
//     anchors intact (they're harmless and the unsubscribe link is data).
//   - Keep <style> blocks (email styling lives there + inline; without it
//     the layout breaks).
//
// Image rewriting (URL → local committed path):
//   The original extractor walked the HTML in document order, deduped by URL,
//   filtered tracking hints + tiny images, and saved up to 12 surviving images
//   as img-01.<ext>..img-12.<ext>. This script replays the same walk to derive
//   each issue's URL-order list, matches against the committed file list at
//   astro/public/assets/images/newsletter/<slug>/, and rewrites every <img src>
//   in the sanitised HTML.
//
//   Strategy: position-based mapping. URL #N (after dedup, after tracking
//   filter) → img-NN.<ext>. URLs that the extractor dropped (tracking hint,
//   download failure, sub-5KB, beyond MAX_IMAGES_PER_EMAIL=12) have no local
//   file and the rewriter drops the <img> tag entirely.
//
// Usage:
//   cd astro && npx tsx scripts/backfill-newsletter-html.ts \
//     --corpus="/path/to/Deliverables/ae-newsletters-archive-2026-05-26" \
//     [--dry-run] [--force]

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sanitizeHtml from 'sanitize-html';
import { load } from 'cheerio';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASTRO_ROOT = path.resolve(__dirname, '..');
const CONTENT_ROOT = path.join(ASTRO_ROOT, 'src', 'content', 'newsletter');
const IMAGES_ROOT = path.join(ASTRO_ROOT, 'public', 'assets', 'images', 'newsletter');

// Mirror Python extractor constants — keep these in sync with
// Team/tools/rochen-mail/extract_newsletters.py.
const MIN_IMAGE_BYTES = 5_000; // n/a here (we don't refetch) but documents the rule
const MAX_IMAGES_PER_EMAIL = 12;
const TRACKING_URL_HINTS = [
  '/open.gif',
  'tracking',
  'beacon',
  'pixel.gif',
  'pixel.png',
  '/o/',
  'msys',
  'spacer',
  '1x1',
];

interface Args {
  corpus: string;
  dryRun: boolean;
  force: boolean;
  only?: string; // single slug for spot-check rebuilds
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let corpus = '';
  let dryRun = false;
  let force = false;
  let only: string | undefined;
  for (const arg of args) {
    if (arg.startsWith('--corpus=')) corpus = arg.slice('--corpus='.length);
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--force') force = true;
    else if (arg.startsWith('--only=')) only = arg.slice('--only='.length);
    else if (arg === '--help' || arg === '-h') {
      console.log(
        'Usage: npx tsx scripts/backfill-newsletter-html.ts --corpus=<path> [--dry-run] [--force] [--only=<slug>]',
      );
      process.exit(0);
    }
  }
  if (!corpus) {
    console.error('Error: --corpus=<path> is required');
    process.exit(1);
  }
  return { corpus, dryRun, force, only };
}

function looksLikeTracking(url: string): boolean {
  const u = url.toLowerCase();
  return TRACKING_URL_HINTS.some((h) => u.includes(h));
}

interface FrontMatter {
  raw: string;
  fields: Record<string, string>;
  body: string;
}

function parseFrontmatter(raw: string): FrontMatter {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { raw, fields: {}, body: raw };
  const fmRaw = match[1];
  const body = match[2];
  const fields: Record<string, string> = {};
  for (const line of fmRaw.split('\n')) {
    const kv = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[kv[1]] = value;
  }
  return { raw: fmRaw, fields, body };
}

function quoteYaml(s: string): string {
  if (s === '' || /[:#&*!|>'"%@`\[\]{}]/.test(s) || s.startsWith(' ') || s.endsWith(' ')) {
    return JSON.stringify(s);
  }
  return s;
}

function serializeFrontmatter(fields: Record<string, string>, body: string): string {
  const order = ['subject', 'date', 'slug', 'hero_image', 'html_body', 'preheader', 'preview_excerpt', 'draft'];
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const k of order) {
    if (fields[k] === undefined) continue;
    lines.push(`${k}: ${quoteYaml(fields[k])}`);
    seen.add(k);
  }
  for (const k of Object.keys(fields)) {
    if (seen.has(k)) continue;
    lines.push(`${k}: ${quoteYaml(fields[k])}`);
  }
  return ['---', ...lines, '---', body].join('\n');
}

interface RewriteStats {
  slug: string;
  htmlInBytes: number;
  htmlOutBytes: number;
  imgRefsTotal: number;     // <img> tags found
  imgRefsMapped: number;    // mapped to a committed local file
  imgRefsDroppedTracking: number;
  imgRefsDroppedNoFile: number;
  imgRefsDroppedDuplicate: number;
  localFilesAvailable: number;
}

async function listLocalImages(slug: string): Promise<string[]> {
  const dir = path.join(IMAGES_ROOT, slug);
  try {
    const entries = await fs.readdir(dir);
    return entries.filter((e) => /^img-\d+\.[a-z0-9]+$/.test(e)).sort();
  } catch {
    return [];
  }
}

/**
 * Walk the HTML the same way the Python extractor walked it: document-order
 * <img> tags, dedup by src URL, drop tracking-hint URLs. Returns the ordered
 * URL list as the extractor saw it. Position N in this list corresponds to
 * `img-NN.<ext>` on disk (1-based), IFF the image was big enough to survive
 * the extractor's MIN_IMAGE_BYTES + MAX_IMAGES_PER_EMAIL filters.
 *
 * Because the extractor's filters are content-driven (we don't have the
 * original bytes here), we can't perfectly reproduce which URLs were dropped.
 * Instead we map the surviving URLs by counting position: position N in the
 * surviving list (after dedup + tracking-filter) → img-NN. If the local
 * directory has fewer files than expected, the trailing URLs map to nothing
 * and their <img> tags get dropped.
 */
function orderedUniqueSrcs(html: string): string[] {
  const $ = load(html);
  const seen = new Set<string>();
  const ordered: string[] = [];
  $('img').each((_, el) => {
    const src = ($(el).attr('src') ?? '').trim();
    if (!src) return;
    if (src.startsWith('data:')) return;
    if (looksLikeTracking(src)) return;
    if (seen.has(src)) return;
    seen.add(src);
    ordered.push(src);
  });
  return ordered.slice(0, MAX_IMAGES_PER_EMAIL);
}

interface UrlMap {
  urlToLocal: Map<string, string>; // remote URL → '/assets/images/newsletter/<slug>/img-NN.<ext>'
  unmappedUrls: string[];          // remote URLs with no local file (extractor dropped them)
  trailingLocalFiles: string[];    // local files with no corresponding URL slot (rare)
}

function buildUrlMap(slug: string, htmlOrderedUrls: string[], localFiles: string[]): UrlMap {
  const urlToLocal = new Map<string, string>();
  const unmappedUrls: string[] = [];
  // Position-based pairing: URL #i (0-based) → localFiles[i] when available.
  // If extractor dropped some URLs as too-small or fetch-fail, the trailing
  // URLs simply have no file — drop the <img>. We can't tell *which* URL was
  // dropped from this side, so we trust the ordered list.
  for (let i = 0; i < htmlOrderedUrls.length; i++) {
    if (i < localFiles.length) {
      urlToLocal.set(htmlOrderedUrls[i], `/assets/images/newsletter/${slug}/${localFiles[i]}`);
    } else {
      unmappedUrls.push(htmlOrderedUrls[i]);
    }
  }
  const trailingLocalFiles =
    localFiles.length > htmlOrderedUrls.length
      ? localFiles.slice(htmlOrderedUrls.length)
      : [];
  return { urlToLocal, unmappedUrls, trailingLocalFiles };
}

function sanitiseAndRewrite(html: string, urlMap: UrlMap): { out: string; refs: { total: number; mapped: number; tracking: number; noFile: number } } {
  // Stage 1: sanitize-html with a generous allowlist (email HTML uses tables
  // everywhere). We keep <style> blocks and the inline style attributes that
  // carry all the visual chrome.
  const sanitised = sanitizeHtml(html, {
    allowedTags: [
      'a', 'b', 'br', 'center', 'div', 'em', 'font', 'h1', 'h2', 'h3', 'h4',
      'h5', 'h6', 'hr', 'i', 'img', 'li', 'ol', 'p', 'pre', 'small', 'span',
      'strong', 'style', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th',
      'thead', 'tr', 'u', 'ul', 'blockquote', 'code', 'caption', 'colgroup',
      'col', 'section', 'article', 'header', 'footer', 'figure', 'figcaption',
      'picture', 'source', 'address',
    ],
    allowedAttributes: false as unknown as Record<string, string[]>,
    // We intentionally allow <style> blocks — email layouts depend on them.
    // sanitize-html warns loudly otherwise; opt out here, but our transformTags
    // hook strips inline event handlers and the allowedSchemes list blocks
    // javascript:/vbscript: URLs.
    allowVulnerableTags: true,
    // Keep all attributes EXCEPT inline event handlers + a few unsafe ones.
    // Setting allowedAttributes: false would strip everything; setting it to
    // an explicit deny-list isn't supported, so we use the transformer hook
    // below to strip dangerous attrs while letting all others through.
    allowedSchemes: ['http', 'https', 'mailto', 'tel', 'cid'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowedSchemesAppliedToAttributes: ['href', 'src', 'cite'],
    allowProtocolRelative: true,
    parser: { lowerCaseTags: true, lowerCaseAttributeNames: true },
    transformTags: {
      '*': (tagName, attribs) => {
        const cleaned: Record<string, string> = {};
        for (const [k, v] of Object.entries(attribs)) {
          const lk = k.toLowerCase();
          // Strip inline event handlers.
          if (lk.startsWith('on')) continue;
          // Strip <base href> and <meta http-equiv="refresh"> — handled
          // structurally by allowedTags omission, but defensive too.
          if (tagName === 'meta' && lk === 'http-equiv') continue;
          // Strip srcset/source attrs with javascript: schemes — sanitize-html
          // doesn't deeply parse srcset, so be safe.
          if (lk === 'srcset' && /javascript:/i.test(v)) continue;
          cleaned[k] = v;
        }
        return { tagName, attribs: cleaned };
      },
    },
    // Drop <script>, <link rel="stylesheet">, <base>, <meta http-equiv>,
    // <iframe>, <object>, <embed>, <form> — none on allowedTags.
  });

  // Stage 2: walk the sanitised HTML and rewrite <img src>. Drop <img> tags
  // whose URLs we can't map (no local file, tracking pixel that survived,
  // etc.).
  const $ = load(sanitised);
  let total = 0;
  let mapped = 0;
  let tracking = 0;
  let noFile = 0;

  $('img').each((_, el) => {
    total++;
    const $el = $(el);
    const src = ($el.attr('src') ?? '').trim();
    if (!src) {
      $el.remove();
      return;
    }
    if (src.startsWith('data:')) {
      // Tiny inline data-URL spacer/divider — leave (these are visual chrome).
      return;
    }
    if (looksLikeTracking(src)) {
      tracking++;
      $el.remove();
      return;
    }
    const local = urlMap.urlToLocal.get(src);
    if (local) {
      $el.attr('src', local);
      // Strip srcset (it references the same remote CDN and we don't have
      // multi-resolution local files).
      $el.removeAttr('srcset');
      // Ensure decoding hints are reasonable; preserve width/height/style.
      mapped++;
    } else {
      noFile++;
      $el.remove();
    }
  });

  // Stage 3: rewrite background-image URLs in inline style="" attrs.
  // Email templates sometimes use background-image for hero rasters; map by
  // the same urlToLocal table.
  $('[style]').each((_, el) => {
    const $el = $(el);
    let style = $el.attr('style') ?? '';
    style = style.replace(/url\((['"]?)([^'")]+)\1\)/g, (m, q, url) => {
      const trimmed = url.trim();
      const local = urlMap.urlToLocal.get(trimmed);
      if (local) return `url(${q}${local}${q})`;
      if (looksLikeTracking(trimmed)) return 'none';
      return m;
    });
    $el.attr('style', style);
  });

  // Stage 4: drop <base href>. Already filtered by tag allowlist, but if it
  // somehow survived, kill it.
  $('base').remove();

  // Output the body contents only — many emails wrap everything in
  // <html><body>; we want just the body's inner HTML so it can be embedded
  // into the Astro page without nested <html> tags.
  const $body = $('body');
  let out: string;
  if ($body.length) {
    // Pull <style> blocks from <head> into the output so the visual styling
    // survives. Each <style> stays scoped via the inline-attribute pattern
    // emails already use.
    const styles: string[] = [];
    $('head style').each((_, el) => {
      const css = $(el).html() ?? '';
      if (css.trim()) styles.push(`<style>${css}</style>`);
    });
    // Also keep style tags that live in body (rare but happens).
    $body.find('style').each((_, el) => {
      const css = $(el).html() ?? '';
      if (css.trim()) styles.push(`<style>${css}</style>`);
      $(el).remove();
    });
    out = styles.join('\n') + '\n' + ($body.html() ?? '');
  } else {
    // No body wrapper — use the whole document.
    out = $.html();
  }

  return { out, refs: { total, mapped, tracking, noFile } };
}

interface Manifest {
  generatedAt: string;
  task: string;
  totalIssues: number;
  totalHtmlBytesIn: number;
  totalHtmlBytesOut: number;
  totalImgRefs: number;
  totalImgMapped: number;
  totalImgDroppedTracking: number;
  totalImgDroppedNoFile: number;
  issues: RewriteStats[];
}

async function main() {
  const args = parseArgs();
  const htmlBodiesDir = path.join(args.corpus, 'html-bodies');

  const allHtmlFiles = await fs.readdir(htmlBodiesDir);
  const htmlFiles = allHtmlFiles.filter((f) => f.endsWith('.html')).sort();

  const manifest: Manifest = {
    generatedAt: new Date().toISOString(),
    task: '#692',
    totalIssues: 0,
    totalHtmlBytesIn: 0,
    totalHtmlBytesOut: 0,
    totalImgRefs: 0,
    totalImgMapped: 0,
    totalImgDroppedTracking: 0,
    totalImgDroppedNoFile: 0,
    issues: [],
  };

  for (const htmlFile of htmlFiles) {
    // Slug = file basename, but the markdown bodies dropped the YYYY-MM-DD
    // prefix when copied into astro content (eg. 2026-02-21-four-fly-... →
    // four-fly-...). The committed image folder uses the trimmed slug.
    // Derive both.
    const baseSlug = htmlFile.replace(/\.html$/, '');
    const dateMatch = baseSlug.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    if (!dateMatch) {
      console.warn(`skip ${htmlFile} — no YYYY-MM-DD prefix`);
      continue;
    }
    const trimmedSlug = dateMatch[2];
    if (args.only && trimmedSlug !== args.only) continue;

    // Read the matching content collection entry (so we know the year folder
    // + can write html_body into its frontmatter).
    const mdCandidates = [
      path.join(CONTENT_ROOT, '2025', `${trimmedSlug}.md`),
      path.join(CONTENT_ROOT, '2026', `${trimmedSlug}.md`),
    ];
    let mdPath: string | null = null;
    for (const c of mdCandidates) {
      try { await fs.access(c); mdPath = c; break; } catch {}
    }
    if (!mdPath) {
      // No matching collection entry — likely a post-snapshot broadcast.
      // Skip silently.
      continue;
    }

    const rawHtml = await fs.readFile(path.join(htmlBodiesDir, htmlFile), 'utf-8');
    const localFiles = await listLocalImages(trimmedSlug);
    const ordered = orderedUniqueSrcs(rawHtml);
    const urlMap = buildUrlMap(trimmedSlug, ordered, localFiles);
    const { out, refs } = sanitiseAndRewrite(rawHtml, urlMap);

    const stats: RewriteStats = {
      slug: trimmedSlug,
      htmlInBytes: Buffer.byteLength(rawHtml, 'utf-8'),
      htmlOutBytes: Buffer.byteLength(out, 'utf-8'),
      imgRefsTotal: refs.total,
      imgRefsMapped: refs.mapped,
      imgRefsDroppedTracking: refs.tracking,
      imgRefsDroppedNoFile: refs.noFile,
      imgRefsDroppedDuplicate: 0,
      localFilesAvailable: localFiles.length,
    };
    manifest.issues.push(stats);
    manifest.totalIssues++;
    manifest.totalHtmlBytesIn += stats.htmlInBytes;
    manifest.totalHtmlBytesOut += stats.htmlOutBytes;
    manifest.totalImgRefs += refs.total;
    manifest.totalImgMapped += refs.mapped;
    manifest.totalImgDroppedTracking += refs.tracking;
    manifest.totalImgDroppedNoFile += refs.noFile;

    // Write the sanitised HTML alongside the markdown entry.
    const htmlOutPath = mdPath.replace(/\.md$/, '.html');
    if (!args.dryRun) {
      await fs.writeFile(htmlOutPath, out, 'utf-8');
    }

    // Update markdown frontmatter to point at the html sibling.
    const rawMd = await fs.readFile(mdPath, 'utf-8');
    const fm = parseFrontmatter(rawMd);
    fm.fields.html_body = `${trimmedSlug}.html`;
    const rewritten = serializeFrontmatter(fm.fields, fm.body);
    if (!args.dryRun) {
      await fs.writeFile(mdPath, rewritten, 'utf-8');
    }

    console.log(
      `${trimmedSlug.padEnd(60)} ` +
        `in=${(stats.htmlInBytes / 1024).toFixed(0).padStart(4)}KB ` +
        `out=${(stats.htmlOutBytes / 1024).toFixed(0).padStart(4)}KB ` +
        `imgs=${refs.mapped}/${refs.total} (drop:${refs.tracking}t+${refs.noFile}n)` +
        (urlMap.trailingLocalFiles.length ? ` trail=${urlMap.trailingLocalFiles.length}` : ''),
    );
  }

  const manifestPath = path.join(args.corpus, 'html-rewrite-manifest.json');
  if (!args.dryRun) {
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  console.log('\n--- SUMMARY ---');
  console.log(`Issues processed:    ${manifest.totalIssues}`);
  console.log(`HTML in bytes:       ${(manifest.totalHtmlBytesIn / 1024).toFixed(0)} KB`);
  console.log(`HTML out bytes:      ${(manifest.totalHtmlBytesOut / 1024).toFixed(0)} KB`);
  console.log(`<img> refs total:    ${manifest.totalImgRefs}`);
  console.log(`  mapped to local:   ${manifest.totalImgMapped}`);
  console.log(`  dropped tracking:  ${manifest.totalImgDroppedTracking}`);
  console.log(`  dropped no-file:   ${manifest.totalImgDroppedNoFile}`);
  console.log(`Manifest:            ${manifestPath}`);
  if (args.dryRun) console.log('(dry-run — no files written)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
