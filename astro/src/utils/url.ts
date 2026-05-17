// url.ts — base-aware URL helper for internal links.
//
// Phase 6 (task #190) wired Astro `base` to be staging-switchable: builds
// default to base `/` (dev / local preview / prod). Task #215 (2026-05-17)
// promoted the staging environment to a permanent fixture at
// https://aerialedge.co.uk/preview/, so staging builds now run with
// `SITE_BASE=/preview/ npm run build` and produce a build whose internal
// URLs sit under `/preview/...`. Astro prefixes routes / page.url.* /
// Astro's own helpers with `base` automatically, but **string literals**
// in templates (`<a href="/portfolio/foo/">`) do not get the prefix. Wrap
// any internal-page path with `withBase()` so it works both at root and
// under `/preview/`.
//
// Asset paths (`/assets/...`) are deliberately left as root-relative
// literals (P6-E in the Phase 6 brief). Apex and /preview/ share the
// single `public_html/assets/` tree on Rochen — that's intentional, so
// images uploaded via Sveltia don't need to be duplicated. Do NOT pass
// asset paths through `withBase()`.

const BASE = import.meta.env.BASE_URL; // e.g. '/' or '/preview/'

/**
 * Prefix a root-relative internal path with Astro's `base`.
 *
 *   withBase('/foo/')        → '/foo/'           (base '/')
 *   withBase('/foo/')        → '/preview/foo/'   (base '/preview/')
 *   withBase('/#about')      → '/#about'         (base '/')
 *   withBase('/#about')      → '/preview/#about' (base '/preview/')
 *   withBase('https://x.y')  → 'https://x.y'     (absolute URLs untouched)
 *   withBase('#about')       → '#about'          (in-page anchors untouched)
 */
export function withBase(path: string): string {
  if (!path) return path;
  // Absolute URLs, protocol-relative URLs, mailto:, tel:, in-page anchors —
  // pass through unchanged.
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(path)) return path;
  if (path.startsWith('mailto:') || path.startsWith('tel:')) return path;
  if (path.startsWith('#')) return path;

  // Normalise BASE (always ends with '/') + path (always starts with '/').
  const base = BASE.endsWith('/') ? BASE : BASE + '/';
  const rest = path.startsWith('/') ? path.slice(1) : path;
  return base + rest;
}
