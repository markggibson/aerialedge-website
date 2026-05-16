// blog.ts — shared helpers for the posts collection.
//
// v1 Jekyll permalink pattern (default `:categories/:year/:month/:day/:title:output_ext`)
// is preserved verbatim on the new build: /<first-category-slug>/YYYY/MM/DD/<slug>.html
// Real URLs in the wild use varying first segments — "classes", "events",
// "programmes", "services", "philosophy", "circus-shows". Inbound links
// (Google indexing, internal cross-references in v1 post bodies) depend on
// this exact shape — see plan §10 URL inventory.

import { getCollection, type CollectionEntry } from 'astro:content';
import { withBase } from './url';

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Base-LESS permalink for a post. Use for `getStaticPaths` params
 * (Astro will prefix `base` automatically when emitting the file) and
 * for any other consumer that needs the raw path.
 *
 * Shape: /<first-category-slug>/YYYY/MM/DD/<slug>.html — matches v1
 * Jekyll's default permalink. Phase 6 (#190) note: this string is the
 * path the file lives at; the renderable `<a href>` must use postHref()
 * instead so the link resolves correctly under `base: '/v2/'` staging.
 */
export function postPermalink(post: CollectionEntry<'posts'>): string {
  const cat = post.data.categories?.[0] ?? 'classes';
  const date = post.data.date instanceof Date ? post.data.date : new Date(post.data.date);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  // v1 slug = filename minus date prefix and `.md`. Astro entry id is the
  // filename without extension; strip the leading YYYY-MM-DD-.
  const slug = post.id.replace(/^\d{4}-\d{2}-\d{2}-/, '');
  return `/${slugify(cat)}/${y}/${m}/${d}/${slug}.html`;
}

/**
 * Base-aware `<a href>` target for a post. Use this everywhere a post
 * URL is rendered into HTML (sidebar recent posts, blog index, category
 * / tag / archive lists, the [...permalink] route's own sidebar refs).
 */
export function postHref(post: CollectionEntry<'posts'>): string {
  return withBase(postPermalink(post));
}

export async function getSortedPosts() {
  const posts = await getCollection('posts', ({ data }) => !data.draft);
  // Newest first — v1 Jekyll order.
  return posts.sort(
    (a, b) =>
      (b.data.date instanceof Date ? b.data.date : new Date(b.data.date)).getTime() -
      (a.data.date instanceof Date ? a.data.date : new Date(a.data.date)).getTime(),
  );
}
