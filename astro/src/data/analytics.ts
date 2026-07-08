// analytics.ts — the ONE config point for Google Analytics 4 (task #1308).
//
// To go live: replace the placeholder below with the real measurement ID
// from the GA4 property (Admin → Data streams → Web → "Measurement ID",
// shaped like G-ABC1DE2FGH). That is the only change needed — every page
// reads this constant via src/components/Analytics.astro.
//
// Click-by-click instructions for creating the GA4 property and reading
// off this ID live in:
//   Deliverables/google-analytics-setup-2026-07-08/HANDOVER.md
export const GA4_MEASUREMENT_ID = 'G-XXXXXXXXXX';

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
