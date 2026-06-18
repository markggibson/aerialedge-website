// Content Collection schemas — populated in Phase 4 per migration plan §3.
//
// Astro 6 requires each collection to declare a loader (the v5 implicit
// file-based loader was removed). We use `glob()` against the on-disk
// content/<name>/ folders so the v4-style content tree still works.
// Reference: https://docs.astro.build/en/guides/upgrade-to/v6/
//
// SCHEMA MIRROR — the other file is astro/public/admin/config.yml.
// Keep these in sync field-for-field for posts + works + landing-pages
// + homepage + newsletter (Phase 5, P5-E; landing-pages added 2026-05-16
// task #207; homepage singleton added 2026-05-17 task #210; newsletter
// added 2026-06-13 task #678).
// When you change a field here, change it there too (and vice versa).

import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

// Sveltia writes '' for empty string fields and null for empty object/list
// fields (rather than omitting them). Zod's .optional() only accepts undefined,
// so we normalise '', null, and empty arrays → undefined before validation.
// Without this preprocess, every Sveltia-created entry with an unset optional
// field fails the build with an InvalidContentEntryDataError. First encountered
// 2026-05-16 task #207 on landing-pages (Cord hotfix c18b5f6); generalised to
// every collection 2026-05-17 task #210 (closes #209).
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
    // Task #312 stage 2 (2026-05-26) — SEO meta. Separate from `title` so
    // the visible page H3 + SectionTitle keep the short human label, while
    // the <title> and <meta description> can carry the longer SERP-shaped
    // string. Both optional; pages fall back to `title` + the BaseLayout
    // default description when absent.
    metaTitle: z.preprocess(emptyToUndef, z.string().optional()),
    metaDescription: z.preprocess(emptyToUndef, z.string().optional()),
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
    // Optional small-title kicker rendered above the page title in the body
    // column (task #213 r3). Mirrors WorkLayout's `categories.join(' & ')` →
    // SectionTitle smallTitle pattern, but as a single free-text string here
    // because LPs aren't taxonomised the way works are.
    category: z.preprocess(emptyToUndef, z.string().optional()),
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

// `homepage` — Sveltia-editable singleton for the apex one-pager (task #210,
// 2026-05-17). Folder contains exactly one entry: index.md. Sveltia mounts it
// as a files-collection (label: "Homepage"), so Mark sees one entry he can
// edit — no create/delete.
//
// The schema is rich: every editable homepage block has its own object. Order
// of blocks on the page is fixed by src/pages/index.astro (the renderer);
// fields in the schema control the *content* of each block. Auto-pulled
// blocks (latest 3 posts, GHL newsletter form, Address+Vimeo, Social block,
// FooterMenu) stay code-driven and are NOT in this schema.
//
// Field-shape choices:
//   - Buttons everywhere use the same shape `{ text, url, target? }`. `target`
//     is optional and defaults to undefined on render (no _blank). Keeps
//     Sveltia forms uniform.
//   - The hero `body_html` field accepts inline HTML (one anchor link to
//     /#contact in production today). Rendered with set:html. Mark is the
//     sole editor — XSS surface is zero. If we ever open editing to others,
//     swap to widget: markdown and add a renderer.
//   - `works_section.tiles[].work` uses reference('works'), so an unknown
//     slug fails the build LOUDLY. Lift-and-shift behaviour preserved (today's
//     code throws on missing slug; this moves the check to Zod).
//   - `program_features` is the alternating "video parallax + dark callout"
//     band between Vouchers/Store and Pricing. v1 has three video parallaxes
//     and two dark callouts in alternation. Modelling it as an ordered list
//     of discriminated items (`kind: video | callout`) preserves the v1 order
//     AND lets Mark reorder / add / remove items in Sveltia without code
//     changes. This is the single piece of schema design that pays off most.
//
// Optional fields use `emptyToUndef` preprocess everywhere (per #209 lesson).
const buttonSchema = z.object({
  text: z.string(),
  url: z.string(),
  target: z.preprocess(emptyToUndef, z.string().optional()),
});

const videoFeatureSchema = z.object({
  kind: z.literal('video'),
  small_title: z.string(),
  title_lines: z.array(z.string()).min(1),
  video_src: z.string(),
  button: z.preprocess(emptyToUndef, buttonSchema.optional()),
});

const calloutFeatureSchema = z.object({
  kind: z.literal('callout'),
  title: z.string(),
  body: z.string(),
  button: z.preprocess(emptyToUndef, buttonSchema.optional()),
});

const homepage = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/homepage' }),
  schema: z.object({
    // Block 1: Hero (one-pager top). Includes the newsletter announcement
    // paragraph as `body_html` so the inline /#contact anchor renders inline.
    hero: z.object({
      small_title: z.string(),
      title_lines: z.array(z.string()).min(1),
      cta_buttons: z.array(buttonSchema).default([]),
      body_html: z.string(),
      video_src: z.string(),
      // Optional poster frame shown instantly while the hero video loads
      // (task #314). Optional for backward-compat: if unset, the <video>
      // simply renders without a poster as before.
      video_poster: z.preprocess(emptyToUndef, z.string().optional()),
    }),

    // Block 3: About section.
    about: z.object({
      small_title: z.string(),
      title: z.string(),
      body: z.string(),
      image: z.string(),
    }),

    // Block 4: Intensive callout (dark band, first one).
    intensive: z.object({
      title: z.string(),
      body: z.string(),
      button: buttonSchema,
    }),

    // Block 5: Works grid (Masonry). Tiles reference the `works` collection
    // — unknown slugs fail the build loudly via Astro's reference() validator.
    works_section: z.object({
      small_title: z.string(),
      title: z.string(),
      intro: z.string(),
      tiles: z
        .array(
          z.object({
            work: reference('works'),
            style: z.preprocess(emptyToUndef, z.enum(['wide']).optional()),
          }),
        )
        .min(1),
    }),

    // Blocks 6 + 7: Gift Vouchers and Clothing Store (side-by-side row).
    vouchers: z.object({
      title: z.string(),
      body: z.string(),
      image: z.string(),
      button: buttonSchema,
    }),
    store: z.object({
      title: z.string(),
      body: z.string(),
      image: z.string(),
      button: buttonSchema,
    }),

    // Block 8 (audit-expanded): the alternating video-parallax + dark-callout
    // band. v1 has 3 video + 2 callout in alternation. Modelled as an
    // ordered list so Mark can add/remove/reorder items in Sveltia.
    program_features: z
      .array(z.discriminatedUnion('kind', [videoFeatureSchema, calloutFeatureSchema]))
      .default([]),

    // Block 9: Pricing.
    pricing: z.object({
      small_title: z.string(),
      title: z.string(),
      cards: z
        .array(
          z.object({
            title: z.string(),
            icon: z.string(),
            price_tiers: z.array(z.string()).default([]),
          }),
        )
        .min(1),
    }),

    // Block 10: Timetable.
    timetable: z.object({
      title: z.string(),
      image: z.string(),
      button: buttonSchema,
    }),

    // Block 11: Training callout (dark band, last one before articles).
    training_callout: z.object({
      title: z.string(),
      body: z.string(),
      button: buttonSchema,
    }),
  }),
});

// `newsletter` — email-newsletter archive (Wynn task #678, 2026-06-13).
//
// Mark's decisions baked in:
//   - Architecture: Markdown lift + Sveltia publish (Option A — newsletter
//     authoring app at library.aerialedge.co.uk is bypassed for archive +
//     web-publish flow).
//   - URL pattern: /newsletter/<year>/<slug>/ (year-segmented).
//   - Image hosting: committed to Astro repo at
//     /assets/images/newsletter/<slug>/.
//
// `year` is a derived field — Sveltia / the backfill script writes `date`
// and the route emits `<year>` from `date.getUTCFullYear()`. Authors do
// NOT set `year` manually.
const newsletter = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/newsletter' }),
  schema: z.object({
    // The email subject line — used as <h1> + <title>.
    subject: z.string(),
    // Send date (drives both the year URL segment and the chronological sort).
    date: z.coerce.date(),
    // Slug controls the URL path: /newsletter/<year>/<slug>/. Required —
    // both Sveltia and the backfill script set it explicitly so renames
    // don't change the URL.
    slug: z.string(),
    // Optional preheader (the preview line under the subject in inbox view).
    // Doubles as the meta description if present.
    preheader: z.preprocess(emptyToUndef, z.string().optional()),
    // Optional hero image (first image in the email). Path is
    // /assets/images/newsletter/<slug>/<filename>.
    hero_image: z.preprocess(emptyToUndef, z.string().optional()),
    // Optional preview excerpt for the index card. Falls back to the first
    // ~30 words of body when absent.
    preview_excerpt: z.preprocess(emptyToUndef, z.string().optional()),
    // Draft gate — same shape as posts. Drafts excluded from index + RSS.
    draft: z.preprocess(emptyToUndef, z.boolean().optional()),
    // Optional sanitised-HTML sibling for archive fidelity (Wynn task #692,
    // 2026-06-13). When set, the value is a filename adjacent to the .md
    // entry inside src/content/newsletter/<year>/ (eg. "four-fly-tracks.html").
    // The detail page renders that HTML via `set:html` to preserve the
    // original email chrome (Poppins typography, gold accents, CTA buttons,
    // hero styling) that the markdown extraction stripped. The markdown body
    // remains the SEO + RSS source — this HTML is purely for visual
    // rendering of the detail page.
    html_body: z.preprocess(emptyToUndef, z.string().optional()),
  }),
});

export const collections = {
  pages,
  posts,
  works,
  'landing-pages': landingPages,
  homepage,
  newsletter,
};
