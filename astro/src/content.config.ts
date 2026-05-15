// Phase 1 — empty Content Collection schemas (stubs only).
// Schemas will be populated in Phase 4 per migration plan §3.
// Do NOT add field definitions in Phase 1.
//
// Astro 6 requires each collection to declare a loader (the v5 implicit
// file-based loader was removed). We use `glob()` against the on-disk
// content/<name>/ folders so the v4-style content tree still works.
// Reference: https://docs.astro.build/en/guides/upgrade-to/v6/

import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

// `pages` — single pages (root-level *.html in v1 Jekyll).
const pages = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({}).passthrough(),
});

// `posts` — blog (_posts/*.md in v1 Jekyll).
const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({}).passthrough(),
});

// `works` — portfolio (_works/*.md in v1 Jekyll).
const works = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/works' }),
  schema: z.object({}).passthrough(),
});

export const collections = { pages, posts, works };
