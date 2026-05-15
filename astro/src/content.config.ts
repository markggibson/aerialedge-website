// Content Collection schemas — populated in Phase 4 per migration plan §3.
//
// Astro 6 requires each collection to declare a loader (the v5 implicit
// file-based loader was removed). We use `glob()` against the on-disk
// content/<name>/ folders so the v4-style content tree still works.
// Reference: https://docs.astro.build/en/guides/upgrade-to/v6/
//
// Schemas mirror plan §3. Single source of truth for Sveltia CMS
// (Phase 5) — config.yml will be aligned field-for-field at that point.

import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// `posts` — blog (v1 _posts/*.md, 31 files).
//
// URL pattern: /classes/YYYY/MM/DD/<slug>.html — preserved verbatim from v1
// to keep inbound links and Google Search indexing working.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    author: z.string().optional(),
    images: z.array(z.string()).optional(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    excerpt: z.string().optional(),
    isVideoPost: z.boolean().optional(),
    draft: z.boolean().optional(),
  }),
});

// `works` — portfolio (v1 _works/*.md, 8 files).
//
// URL pattern: /portfolio/<slug>/ — preserved verbatim from v1.
// `slug` is an explicit field so we can normalise v1 filenames containing
// `&` and mixed case (plan §11 R2) without changing the public URL.
const works = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/works' }),
  schema: z.object({
    title: z.string(),
    slug: z.string(),
    thumbnail: z.string(),
    slides: z.array(z.string()).default([]),
    categories: z.array(z.string()).default([]),
    date: z.string().optional(),
    client: z.string().optional(),
    link: z
      .object({
        text: z.string(),
        url: z.string(),
      })
      .optional(),
  }),
});

// `pages` — kept as a stub collection for Phase 5 (Sveltia editing of single
// pages). Phase 4 implements single pages as .astro files directly in
// src/pages/ for lift-and-shift fidelity; the Content Collection becomes
// the editing surface in Phase 5.
const pages = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({}).passthrough(),
});

export const collections = { pages, posts, works };
