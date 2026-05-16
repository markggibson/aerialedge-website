// url.ts — base-aware URL helper for internal links.
//
// Phase 6 (task #190) wired Astro `base` to be staging-switchable: builds
// default to base `/` (dev / preview / prod), while staging builds run
// with `SITE_BASE=/v2/ npm run build` and produce a build whose internal
// URLs sit under `/v2/...`. Astro prefixes routes / page.url.* / Astro's
// own helpers with `base` automatically, but **string literals** in
// templates (`<a href="/portfolio/foo/">`) do not get the prefix. Wrap
// any internal-page path with `withBase()` so it works both at root and
// under `/v2/`.
//
// Asset paths (`/assets/...`) are deliberately left as root-relative
// literals (P6-E in the Phase 6 brief): during staging they resolve to
// v1's `public_html/assets/` tree on the same domain. Do NOT pass asset
// paths through `withBase()`.

const BASE = import.meta.env.BASE_URL; // e.g. '/' or '/v2/'

/**
 * Prefix a root-relative internal path with Astro's `base`.
 *
 *   withBase('/foo/')        → '/foo/'      (base '/')
 *   withBase('/foo/')        → '/v2/foo/'   (base '/v2/')
 *   withBase('/#about')      → '/#about'    (base '/')
 *   withBase('/#about')      → '/v2/#about' (base '/v2/')
 *   withBase('https://x.y')  → 'https://x.y' (absolute URLs untouched)
 *   withBase('#about')       → '#about'     (in-page anchors untouched)
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
