// analytics.ts — the ONE config point for Google Analytics 4 (task #1308).
//
// This is the only place the measurement ID lives — every page reads this
// constant via src/components/Analytics.astro. To change it, edit the one
// line below; nothing else needs touching.
//
// Current ID: the web stream of the EXISTING GA4 property
// "Aerial Edge - GA4" (property 386606284, account 21120976 —
// www.aerialedge.co.uk, Mark's account). Reused per Mark's call
// 2026-07-09; no new property was created.
// Handover: Deliverables/google-analytics-setup-2026-07-08/HANDOVER.md
export const GA4_MEASUREMENT_ID = 'G-RFN5P1P2D4';

// True once the placeholder is swapped for a real ID. While false the tag
// still loads and fires (Google serves gtag.js for any ID, and beacons are
// accepted), so the wiring is verifiable on /preview/ — the hits just have
// no property collecting them yet.
export const GA4_ID_IS_REAL = !/^G-X+$/.test(GA4_MEASUREMENT_ID);

// Pages that count as "pro-course" for the pro_course_engaged event.
// Root-relative, trailing slash, compared as a prefix after the /preview/
// base (if any) is stripped.
export const PRO_COURSE_PATHS = [
  '/protrack/',
  '/professional-development-programme/',
  '/four-week-intensive/',
  '/foundation-course/',
];
