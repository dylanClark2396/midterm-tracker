# scripts: maintenance tools

Standalone tools, run from the **project root** (paths like `dist/`, `src/data/` and `public/maps/` are relative to
it). None of them is imported by the site.

| Script | Run by | Purpose |
| --- | --- | --- |
| [check-links.mjs](check-links.mjs) | CI: PRs (changed files only), main pushes (internal only), weekly (everything); `npm run check:links` | Internal links and anchors in `dist/`, plus every external URL in the YAML and in `src/**/*.{astro,ts}` |
| [check-docs.mjs](check-docs.mjs) | CI; `npm run docs:check` | Relative links in every `CLAUDE.md` |
| [check-contact.mjs](check-contact.mjs) | CI; `npm run check:contact` | Contact form and Worker agree on field names, topics and `maxlength`s (parses both files with regexes, so keep `TOPICS`/`LIMITS` as plain object literals) |
| [build-district-maps.mjs](build-district-maps.mjs) | By hand, rarely | Regenerates [../public/maps/](../public/maps/) GeoJSON (needs network and `npx mapshaper`) |
| [research-queue.mjs](research-queue.mjs) | `npm run research:queue`; the [research-races skill](../.claude/skills/research-races/SKILL.md) | Where race research stands: PRs to merge or verify, claimed branches, next races (needs `gh`) |
| [seed-from-certified-list.py](seed-from-certified-list.py) | By hand when the state updates its lists | Creates or refreshes `pending` race files; writes [../data-staging/seed-report.md](../data-staging/seed-report.md) |

## Gotchas

- `check-links.mjs` needs a fresh `npm run build` for the internal pass. Use `-- --internal-only` to skip the
  network. 401/403/429 responses are warnings on purpose: news sites block bots but the pages exist for readers.
  Cloudflare challenges (the Tennessee Lookout and others) block every scripted request, even from home IPs, so
  they're grouped into one warning per host and those URLs go unchecked. Don't try to get past the challenge.
- Some sources block automated fetches entirely. That's fine for the checker (warning), but when researching, a
  `curl` with a browser user agent often works where a plain fetch gets 403.
- `build-district-maps.mjs`: the Comptroller's congressional download needs the disclaimer cookie already in the
  script. The output files must keep the property name `d` and the file names that `LAYERS` in
  [../src/scripts/district-finder.ts](../src/scripts/district-finder.ts) expects.
- `seed-from-certified-list.py` is standard-library Python. Its `LISTS` table sets the race id format
  (`us-house-01`, `tn-senate-05`, `tn-house-012`). Its levels must match
  [../src/lib/levels.ts](../src/lib/levels.ts), and `PARTIES` must match the schema's `ballot_party` enum. Use
  `--dry-run` first. Set `FEC_API_KEY` to cross-check federal candidates.
- The user-agent string is copied into each script on purpose; they're independent single-file tools.
