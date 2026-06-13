---
subject: Newsletter archive infrastructure now live
date: 2026-06-13
slug: infra-validation
preheader: Test entry validating the /newsletter/ routes, schema, and Sveltia config wired up under task #678.
preview_excerpt: Wynn's infrastructure-validation entry — confirms the content collection schema, year-segmented URLs, RSS feed and Sveltia config all render correctly before the 49-issue backfill lands.
draft: false
---

This is an infrastructure-validation entry for the Aerial Edge newsletter
archive. If you're reading this on the live site, the following are working:

- Content collection schema validation (`src/content.config.ts`)
- Detail page route at `/newsletter/<year>/<slug>/`
- Markdown body rendering with brand styling
- Index page chronological listing
- RSS feed at `/newsletter/feed.xml`
- Sveltia "Newsletter" collection in `/admin`
- Main navigation link to `/newsletter/`

The 49-issue backfill from the existing newsletter corpus is pending Mark
re-hydrating the corpus working tree (see Wynn's task #678 return).

This entry can be safely deleted from the Sveltia editor once the backfill
ships and the routes are confirmed working with real content.
