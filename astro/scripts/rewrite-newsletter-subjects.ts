#!/usr/bin/env -S npx tsx
// rewrite-newsletter-subjects.ts — replace each backfilled newsletter's
// frontmatter `subject:` with the body H1 line (the verbatim email subject
// the Rochen extractor preserved).
//
// Wynn task #690 (2026-06-13). Mark approved the fix flagged in #686
// (triage at Deliverables/newsletter-archive-typo-triage-2026-06-13/title-triage.md).
//
// Backstory:
//   - backfill-newsletter-archive.ts derived `subject:` from the slug via
//     `inferSubjectFromSlug()` (Title Case from kebab-case) because the
//     extractor body files had no explicit `subject:` frontmatter to lift.
//     Result: lost diacritics ("Brügger" → "Br Gger"), apostrophes ("Can't"
//     → "Can T"), all-caps emphasis ("HNY", "TONIGHT", "TOMORROW", "NEW"),
//     punctuation (`?`, `!`, `:`, `+`, `&`, `/`, `,`), emojis, and case for
//     initials ("JJ" → "Jj").
//   - The H1 line of each body IS the original subject, verbatim. Use it.
//
// Strategy:
//   1. Walk every src/content/newsletter/<year>/<slug>.md.
//   2. Find the first `# ...` line after the frontmatter — that's the H1.
//   3. Replace the frontmatter `subject:` value with the H1 text, preserving
//      original casing/punctuation/diacritics/emojis. Quote via the same
//      YAML-safe path the backfill script used.
//   4. If a body has no clean H1, leave the issue untouched and surface it
//      in the failure list.
//
// Idempotency: re-running compares the new subject to the existing one; if
// they already match, the file is left untouched. Re-running on a clean tree
// is a no-op.
//
// Usage:
//
//   npx tsx scripts/rewrite-newsletter-subjects.ts            # all years, live
//   npx tsx scripts/rewrite-newsletter-subjects.ts --dry-run  # preview

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
      console.log('Usage: npx tsx scripts/rewrite-newsletter-subjects.ts [--dry-run]');
      process.exit(0);
    }
  }
  return { dryRun };
}

interface IssueResult {
  file: string;
  slug: string;
  oldSubject: string;
  newSubject: string;
  status: 'rewrote' | 'skipped-already-matches' | 'skipped-no-h1' | 'skipped-empty' | 'error';
  reason?: string;
}

function escapeYaml(s: string): string {
  // Mirror backfill-newsletter-archive.ts L114-L118 — double-quote everything
  // and escape embedded backslashes + quotes.
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function extractH1(body: string): string | null {
  // Find the first line starting with `# ` (single hash followed by a space).
  // This is the H1 produced by extract_newsletters.py. We do NOT match `## `
  // (subsection) or fenced-code-block headings (none appear in this corpus,
  // but the strict `^# ` regex on a per-line scan rules them out anyway).
  const lines = body.split('\n');
  for (const line of lines) {
    if (line.startsWith('# ') && !line.startsWith('## ')) {
      const h1 = line.slice(2).trim();
      if (h1.length > 0) return h1;
    }
  }
  return null;
}

function rewriteFrontmatter(raw: string, newSubject: string): { output: string; oldSubject: string } | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return null;
  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  // Find and replace the `subject:` line. The backfill writes it on its own
  // line as `subject: "..."` (always quoted via escapeYaml). Match that shape
  // and replace value only — leave key formatting alone.
  const fmLines = frontmatter.split('\n');
  let subjectLineIdx = -1;
  let oldSubject = '';
  for (let i = 0; i < fmLines.length; i++) {
    const m = fmLines[i].match(/^subject:\s*(.*)$/);
    if (m) {
      subjectLineIdx = i;
      // Strip surrounding quotes (mirrors backfill parseFrontmatter L88-L97).
      let v = m[1].trim();
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      // Unescape the doubled-quote / backslash escapes the backfill writes.
      v = v.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      oldSubject = v;
      break;
    }
  }
  if (subjectLineIdx === -1) {
    // No subject line at all — shouldn't happen for backfilled issues, but be
    // defensive. Insert one as the first frontmatter line.
    fmLines.unshift(`subject: ${escapeYaml(newSubject)}`);
  } else {
    fmLines[subjectLineIdx] = `subject: ${escapeYaml(newSubject)}`;
  }

  const output = `---\n${fmLines.join('\n')}\n---\n${body}`;
  return { output, oldSubject };
}

async function processIssue(filePath: string, args: Args): Promise<IssueResult> {
  const file = path.relative(ASTRO_ROOT, filePath);
  const slug = path.basename(filePath, '.md');

  const raw = await fs.readFile(filePath, 'utf-8');
  if (!raw.trim()) {
    return {
      file,
      slug,
      oldSubject: '',
      newSubject: '',
      status: 'skipped-empty',
      reason: 'file is empty',
    };
  }

  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return {
      file,
      slug,
      oldSubject: '',
      newSubject: '',
      status: 'error',
      reason: 'no frontmatter block',
    };
  }
  const body = fmMatch[2];

  const h1 = extractH1(body);
  if (h1 === null) {
    return {
      file,
      slug,
      oldSubject: '',
      newSubject: '',
      status: 'skipped-no-h1',
      reason: 'body has no `# ...` H1 line',
    };
  }

  const rewritten = rewriteFrontmatter(raw, h1);
  if (!rewritten) {
    return {
      file,
      slug,
      oldSubject: '',
      newSubject: h1,
      status: 'error',
      reason: 'frontmatter parse failed',
    };
  }

  if (rewritten.oldSubject === h1) {
    return {
      file,
      slug,
      oldSubject: rewritten.oldSubject,
      newSubject: h1,
      status: 'skipped-already-matches',
    };
  }

  if (!args.dryRun) {
    await fs.writeFile(filePath, rewritten.output, 'utf-8');
  }
  return {
    file,
    slug,
    oldSubject: rewritten.oldSubject,
    newSubject: h1,
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

  const results: IssueResult[] = [];
  for (const file of issues) {
    try {
      const r = await processIssue(file, args);
      results.push(r);
      const tag = `[${r.status}]`.padEnd(28);
      let detail = '';
      if (r.status === 'rewrote') {
        detail = `\n    "${r.oldSubject}"\n    → "${r.newSubject}"`;
      } else if (r.status === 'skipped-no-h1') {
        detail = ` — ${r.reason}`;
      } else if (r.status === 'error') {
        detail = ` — ${r.reason}`;
      }
      console.log(`${tag} ${path.basename(file)}${detail}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[error]                      ${path.basename(file)} — ${msg}`);
    }
  }

  console.log('');
  console.log('=== Summary ===');
  const tally = (s: IssueResult['status']) => results.filter((r) => r.status === s).length;
  console.log(`Rewrote:                    ${tally('rewrote')}`);
  console.log(`Skipped (already matches):  ${tally('skipped-already-matches')}`);
  console.log(`Skipped (no H1):            ${tally('skipped-no-h1')}`);
  console.log(`Skipped (empty):            ${tally('skipped-empty')}`);
  console.log(`Errors:                     ${tally('error')}`);

  const flagged = results.filter(
    (r) => r.status === 'skipped-no-h1' || r.status === 'error',
  );
  if (flagged.length > 0) {
    console.log('');
    console.log('=== Flagged (need attention) ===');
    for (const r of flagged) {
      console.log(`  ${r.slug}: ${r.reason ?? r.status}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
