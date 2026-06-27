// remark-demote-post-headings — task #1051.
//
// Blog post bodies are authored with Markdown `##`/`###` section headings,
// which render as <h2>/<h3>. But the article TITLE is rendered by
// PostLayout.astro as <h3 class="deco">. That left body sections (h2) at a
// HIGHER heading level than the title (h3) — semantically backwards, and
// visually the sections rendered larger than the title (Mark, task #1051).
//
// Mark's chosen fix: keep the title at <h3>, and push every in-body heading
// at least one level BELOW it. This plugin shifts body headings down two
// levels so the structure is unambiguous:
//   ##  (h2 section)     -> h4
//   ### (h3 subsection)  -> h5
//   #### (h4)            -> h6
//   ##### / ###### …     -> h6 (clamped; HTML has no h7+)
// A lone `#` (h1) in a body would also drop to h3 — still below… equal to
// the title, so we special-case it to h4 to stay strictly below. In
// practice posts don't use `#` in the body (the title is frontmatter), so
// this is just defensive.
//
// SCOPING: applied globally in astro.config.mjs, but gated on the file path
// so it ONLY transforms files under src/content/posts/. Newsletters,
// landing pages and singleton pages keep their own heading levels untouched.
// remark plugins receive the VFile as the second visitor-tree argument;
// Astro sets file.path to the source file URL (verified against
// @astrojs/markdown-remark — VFile is constructed with path: fileURL).

import { visit } from 'unist-util-visit';

const SHIFT = 2; // push body headings two levels down (h2 -> h4)
const MAX_DEPTH = 6; // HTML stops at h6

export default function remarkDemotePostHeadings() {
  return (tree, file) => {
    // Normalise the path (it may be a URL string or a fs path) and only act
    // on blog post sources. Match both POSIX and Windows separators.
    const p = String(file?.path ?? file?.history?.[0] ?? '').replace(/\\/g, '/');
    if (!p.includes('/content/posts/')) return;

    visit(tree, 'heading', (node) => {
      if (typeof node.depth !== 'number') return;
      // h1 in a body would tie the h3 title after a +2 shift would make it h3;
      // force it strictly below the title.
      const shifted = node.depth === 1 ? 4 : node.depth + SHIFT;
      node.depth = Math.min(shifted, MAX_DEPTH);
    });
  };
}
