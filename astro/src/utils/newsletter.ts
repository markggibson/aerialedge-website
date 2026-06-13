// newsletter.ts — shared helpers for the newsletter collection.
//
// Wynn task #678 (2026-06-13). URL pattern (Mark's Q2 decision):
//   /newsletter/<year>/<slug>/
//
// `year` is derived from frontmatter `date` (UTC) — authors don't set it
// manually. `slug` is an explicit frontmatter field so renames don't change
// URLs (same pattern as `works`).

import { getCollection, type CollectionEntry } from 'astro:content';
import { withBase } from './url';

/**
 * Base-LESS path for a newsletter entry. Use for `getStaticPaths` params
 * (Astro prefixes `base` when emitting the file).
 *
 * Shape: /newsletter/<year>/<slug>/
 */
export function newsletterPermalink(entry: CollectionEntry<'newsletter'>): string {
  const date = entry.data.date instanceof Date ? entry.data.date : new Date(entry.data.date);
  const year = date.getUTCFullYear();
  return `/newsletter/${year}/${entry.data.slug}/`;
}

/**
 * Base-aware <a href> target for a newsletter entry. Use everywhere a
 * newsletter URL is rendered into HTML (index page, RSS feed, sidebars).
 */
export function newsletterHref(entry: CollectionEntry<'newsletter'>): string {
  return withBase(newsletterPermalink(entry));
}

/**
 * Newest-first chronological sort. Drafts excluded.
 */
export async function getSortedNewsletters() {
  const items = await getCollection('newsletter', ({ data }) => !data.draft);
  return items.sort(
    (a, b) =>
      (b.data.date instanceof Date ? b.data.date : new Date(b.data.date)).getTime() -
      (a.data.date instanceof Date ? a.data.date : new Date(a.data.date)).getTime(),
  );
}

/**
 * Group newsletters by year (newest year first; within each year, newest first).
 * Used by the index page for year-segmented rendering.
 */
export function groupByYear(
  items: CollectionEntry<'newsletter'>[],
): Array<{ year: number; items: CollectionEntry<'newsletter'>[] }> {
  const buckets = new Map<number, CollectionEntry<'newsletter'>[]>();
  for (const item of items) {
    const d = item.data.date instanceof Date ? item.data.date : new Date(item.data.date);
    const y = d.getUTCFullYear();
    if (!buckets.has(y)) buckets.set(y, []);
    buckets.get(y)!.push(item);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => b - a)
    .map(([year, items]) => ({ year, items }));
}

/**
 * Excerpt fallback — first ~30 words of the rendered body, stripped of
 * markdown syntax. Used by the index page when `preview_excerpt` is unset.
 */
export function deriveExcerpt(body: string, wordCount = 30): string {
  const stripped = body
    // Drop frontmatter if present (defensive — body shouldn't contain it).
    .replace(/^---[\s\S]*?---\n/, '')
    // Drop image syntax.
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    // Drop link syntax, keep text.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    // Drop heading / list / blockquote markers.
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^>\s+/gm, '')
    // Drop emphasis markers.
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Collapse whitespace.
    .replace(/\s+/g, ' ')
    .trim();
  const words = stripped.split(' ').filter(Boolean);
  if (words.length <= wordCount) return stripped;
  return words.slice(0, wordCount).join(' ') + '…';
}
