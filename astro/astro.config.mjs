// @ts-check
import { defineConfig } from 'astro/config';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lift-and-shift discipline: no integrations beyond what the migration
// genuinely needs.
export default defineConfig({
  // Output is fully static (Rochen shared hosting target).
  output: 'static',
  // Default `build.format: 'directory'` keeps page routes at
  // `/foo/index.html` (so URLs like `/safeguarding/` and
  // `/portfolio/<slug>/` work the way v1 served them). For the blog catch-
  // all, we emit permalinks like `/events/2024/10/02/handstands.html` — a
  // literal `.html` segment in the URL. Astro under directory format would
  // place those at `<path>.html/index.html`, which is not how v1 served
  // them. The post-build integration below flattens those folders so the
  // server delivers the same path v1 inbound links target.
  integrations: [
    {
      name: 'flatten-html-suffix-routes',
      hooks: {
        'astro:build:done': async ({ dir, logger }) => {
          // Walk dist/ and for every `<name>.html/index.html`, rewrite to
          // `<name>.html` as a flat file. Leaves trailing-slash routes
          // (`/foo/index.html`) untouched.
          // `dir` is a URL — decode it to a filesystem path. Using
          // dir.pathname loses spaces (becomes %20). fileURLToPath handles it.
          const root = fileURLToPath(dir);
          if (logger) logger.info(`flattening .html-suffix routes under ${root}`);
          const moved = await flattenRecursively(root);
          if (logger) logger.info(`flattened ${moved} routes`);
        },
      },
    },
  ],
});

async function flattenRecursively(folder) {
  let moved = 0;
  let entries;
  try {
    entries = await fs.readdir(folder, { withFileTypes: true });
  } catch {
    return moved;
  }
  for (const entry of entries) {
    const full = path.join(folder, entry.name);
    if (!entry.isDirectory()) continue;
    if (entry.name.endsWith('.html')) {
      // Pattern: <name>.html/ containing index.html → flatten to <name>.html
      const indexPath = path.join(full, 'index.html');
      let exists = false;
      try {
        await fs.access(indexPath);
        exists = true;
      } catch {}
      if (exists) {
        const content = await fs.readFile(indexPath);
        await fs.rm(full, { recursive: true, force: true });
        await fs.writeFile(full, content);
        moved += 1;
        continue;
      }
    }
    moved += await flattenRecursively(full);
  }
  return moved;
}
