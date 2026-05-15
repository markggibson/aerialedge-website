// @ts-check
import { defineConfig } from 'astro/config';

// Phase 1 scaffold — minimal Astro 6 config.
// Lift-and-shift discipline: no integrations beyond what the placeholder needs.
export default defineConfig({
  // Output is fully static for Phase 1 (Rochen shared hosting target).
  output: 'static',
});
