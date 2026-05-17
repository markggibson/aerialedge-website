// Content Collection schemas — populated in Phase 4 per migration plan §3.
//
// Astro 6 requires each collection to declare a loader (the v5 implicit
// file-based loader was removed). We use `glob()` against the on-disk
// content/<name>/ folders so the v4-style content tree still works.
// Reference: https://docs.astro.build/en/guides/upgrade-to/v6/
//
// SCHEMA MIRROR — the other file is astro/public/admin/config.yml.
// Keep these in sync field-for-field for posts + works + landing-pages
// (Phase 5, P5-E; landing-pages added 2026-05-16 task #207).
// When you change a field here, change it there too (and vice versa).

import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Sveltia writes '' for empty string fields and null for empty object/list
// fields (rather than omitting them). Zod's .optional() only accepts undefined,
// so we normalise '' and null → undefined before validation. Without this
// preprocess, every Sveltia-created entry with an unset optional field fails
// the build with an InvalidContentEntryDataError. First encountered 2026-05-16
// task #207 on landing-pages (Cord hotfix c18b5f6); generalised to every
// collection 2026-05-17 task #209 — posts and works could hit the same trap
// if Mark creates an entry via Sveltia with unset optional fields.
const emptyToUndef = (val: unknown) =>
  val === '' || val === null ? undefined : val;

// `posts` — blog (v1 _posts/*.md, 31 files).
//
// URL pattern: /classes/YYYY/MM/DD/<slug>.html — preserved verbatim from v1
// to keep inbound links and Google Search indexing working.
const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    author: z.preprocess(emptyToUndef, z.string().optional()),
    images: z.preprocess(emptyToUndef, z.array(z.string()).optional()),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    excerpt: z.preprocess(emptyToUndef, z.string().optional()),
    isVideoPost: z.preprocess(emptyToUndef, z.boolean().optional()),
    draft: z.preprocess(emptyToUndef, z.boolean().optional()),
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
    date: z.preprocess(emptyToUndef, z.string().optional()),
    client: z.preprocess(emptyToUndef, z.string().optional()),
    link: z.preprocess(
      emptyToUndef,
      z
        .object({
          text: z.string(),
          url: z.string(),
        })
        .optional(),
    ),
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

// `landing-pages` — campaign-style URL-shareable landing pages (task #207).
//
// URL pattern: /<slug>/ at apex root, no prefix. Mounted via
// src/pages/[landing_slug].astro, which performs a build-time
// reserved-slug check before emitting routes.
//
// Slug pattern enforced here (Zod) AND in config.yml (Sveltia) for
// defence-in-depth — neither layer alone catches everything (Sveltia
// rejects on save; Zod rejects on build).
const LANDING_SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const landingPages = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/landing-pages' }),
  schema: z.object({
    title: z.string(),
    slug: z
      .string()
      .regex(
        LANDING_SLUG_RE,
        'slug must be lowercase letters/digits with single hyphens (e.g. summer-2026)',
      ),
    hero_image: z.preprocess(emptyToUndef, z.string().optional()),
    cta: z.preprocess(
      emptyToUndef,
      z.object({
        text: z.string(),
        url: z.string(),
      }).optional(),
    ),
    draft: z.boolean().default(false),
    date: z.preprocess(emptyToUndef, z.coerce.date().optional()),
  }),
});

export const collections = { pages, posts, works, 'landing-pages': landingPages };
