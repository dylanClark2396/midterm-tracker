# scripts: maintenance tools

Standalone tools, run from the **project root** (paths like `dist/`, `src/data/` and `public/maps/` are relative to
it). None of them is imported by the site.

| Script | Run by | Purpose |
| --- | --- | --- |
| [check-links.mjs](check-links.mjs) | CI on every push and weekly; `npm run check:links` | Internal links and anchors in `dist/`, plus every external URL in the YAML and in `src/**/*.{astro,ts}` |
| [check-docs.mjs](check-docs.mjs) | `npm run docs:check` | Relative links in every `CLAUDE.md` |
| [build-district-maps.mjs](build-district-maps.mjs) | By hand, rarely | Regenerates [../public/maps/](../public/maps/) GeoJSON (needs network and `npx mapshaper`) |
| [seed-from-certified-list.py](seed-from-certified-list.py) | By hand when the state updates its lists | Creates or refreshes `pending` race files; writes [../data-staging/seed-report.md](../data-staging/seed-report.md) |

## Gotchas

- `check-links.mjs` needs a fresh `npm run build` for the internal pass. Use `-- --internal-only` to skip the
  network. 401/403/429 responses are warnings on purpose: news sites block bots but the pages exist for readers.
- Some sources block automated fetches entirely. That's fine for the checker (warning), but when researching, a
  `curl` with a browser user agent often works where a plain fetch gets 403.
- `build-district-maps.mjs`: the Comptroller's congressional download needs the disclaimer cookie already in the
  script. The output files must keep the property name `d` and the file names that `LAYERS` in
  [../src/scripts/district-finder.ts](../src/scripts/district-finder.ts) expects.
- `seed-from-certified-list.py` is standard-library Python. Its `LISTS` table sets the race id format
  (`us-house-01`, `tn-senate-05`, `tn-house-012`) and `PARTIES` must match the schema's `ballot_party` enum. Use
  `--dry-run` first. Set `FEC_API_KEY` to cross-check federal candidates.
- The user-agent string is copied into each script on purpose; they're independent single-file tools.
