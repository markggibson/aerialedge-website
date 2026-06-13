// /newsletter/feed.xml — RSS 2.0 feed for the newsletter archive.
//
// Wynn task #678 (2026-06-13).
//
// Astro endpoint. Returns `application/rss+xml` with one <item> per
// published newsletter (drafts excluded). Items sorted newest-first.
//
// Uses straight string assembly rather than @astrojs/rss to avoid pulling
// a new dep — the feed shape is small and well-known.

import type { APIRoute } from 'astro';
import { getSortedNewsletters, newsletterPermalink } from '../../utils/newsletter';

const SITE_ORIGIN = 'https://aerialedge.co.uk';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const GET: APIRoute = async () => {
  const items = await getSortedNewsletters();

  const channelLink = SITE_ORIGIN + '/newsletter/';
  const selfLink = SITE_ORIGIN + '/newsletter/feed.xml';

  const itemXml = items
    .map((entry) => {
      const link = SITE_ORIGIN + newsletterPermalink(entry);
      const date = entry.data.date instanceof Date ? entry.data.date : new Date(entry.data.date);
      const description =
        entry.data.preview_excerpt ?? entry.data.preheader ?? entry.data.subject;
      return `
    <item>
      <title>${escapeXml(entry.data.subject)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${date.toUTCString()}</pubDate>
      <description>${escapeXml(description)}</description>
    </item>`;
    })
    .join('');

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Aerial Edge Newsletter</title>
    <link>${channelLink}</link>
    <atom:link href="${selfLink}" rel="self" type="application/rss+xml" />
    <description>Weekly newsletter from Aerial Edge, Glasgow's circus school.</description>
    <language>en-gb</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>${itemXml}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
    },
  });
};
