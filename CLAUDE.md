# TN 2026 Ballot Guide: agent guide

A static voter guide for the November 3, 2026 Tennessee general election, live at https://tnelection.org. It shows
the arguments for and against each constitutional amendment and candidate **without party, ideology, or group
labels**, with every claim footnoted to a source. User-facing detail (method, coverage, deployment) is in the
[README](README.md); the editorial rules readers see are in [src/pages/method.astro](src/pages/method.astro).

## Stack and entry points

- **Astro 7, static output** ([astro.config.mjs](astro.config.mjs)): `site` is `https://tnelection.org` and
  `trailingSlash: 'always'`. There's no UI framework; pages are `.astro` files with small inline scripts.
- **Content**: YAML in [src/data/](src/data/), validated by Zod in [src/content.config.ts](src/content.config.ts).
- **Browser code**: Leaflet map on `/districts/` ([src/scripts/district-finder.ts](src/scripts/district-finder.ts)).
- **Contact form backend**: a Cloudflare Worker in [workers/contact/](workers/contact/), deployed separately.
- **Hosting**: a Cloudflare Worker that only serves `dist/` as static assets ([wrangler.jsonc](wrangler.jsonc)), on
  the `tnelection.org` custom domain; [workers/www-redirect/](workers/www-redirect/) sends `www.` to the apex.
- **CI/deploy**: [.github/workflows/deploy.yml](.github/workflows/deploy.yml) runs validate → build → link check,
  then `wrangler deploy` on `main` (needs the `CLOUDFLARE_API_TOKEN` repo secret).

## How content becomes a page

```
src/data/**/*.yaml ──► content.config.ts (Zod schema + lib/rules.ts: blocklist, categories, ≤8 planks)
                              │  build fails here on unsourced or labelled content
                              ▼
            getCollection() in src/pages/**  ──►  lib/site.ts prepareRace / prepareAmendment
                                                  (seeded shuffle + footnote numbering)
                              ▼
            components/ArgColumns, Refs, Sources inside layouts/Base.astro  ──►  dist/ (static HTML)
```

## Where to look for…

| Topic | File |
| --- | --- |
| Data shape, validation, build-failing rules | [src/content.config.ts](src/content.config.ts), [src/lib/rules.ts](src/lib/rules.ts) |
| Writing or researching race/amendment YAML | [src/data/CLAUDE.md](src/data/CLAUDE.md) |
| Argument order, footnote numbering, view models | [src/lib/site.ts](src/lib/site.ts) |
| Site constants (URLs, election and early-voting dates, contact endpoint, Turnstile key) | [src/lib/site.ts](src/lib/site.ts) |
| Race levels (statewide, U.S. House, TN Senate, TN House) | [src/lib/levels.ts](src/lib/levels.ts) |
| Page shell, nav, meta tags, mobile argument tabs | [src/layouts/Base.astro](src/layouts/Base.astro) |
| Race and amendment pages | [src/pages/races/[id].astro](src/pages/races/[id].astro), [src/pages/amendments/[id].astro](src/pages/amendments/[id].astro) |
| District finder (map + address search) | [src/pages/districts.astro](src/pages/districts.astro), [src/scripts/district-finder.ts](src/scripts/district-finder.ts), [src/lib/geo.ts](src/lib/geo.ts) |
| Ballot cheat sheet | [src/pages/ballot.astro](src/pages/ballot.astro) |
| Styles and color tokens | [src/styles/global.css](src/styles/global.css) (imports the per-area files) |
| Link checking, map rebuilding, seeding races | [scripts/](scripts/CLAUDE.md) |

## Commands

Start the dev server in background mode: `astro dev --background` (manage it with `astro dev stop`, `astro dev
status`, `astro dev logs`). Stop it before `npm ci`, or Windows file locks cause EPERM errors.

| Command | What it does |
| --- | --- |
| `npm run validate` | `astro sync`: schema and blocklist checks only (fast) |
| `npm run build` | Full static build into `dist/` |
| `npm run check:links` | Internal links in `dist/` plus every external URL (needs network and a build first; add `-- --internal-only` to skip the network) |
| `npm run check` | `astro check`: type errors in `.astro` and `.ts` files |
| `npm run check:contact` | Contact form and Worker agree on fields, topics and limits |
| `npm run docs:check` | Every relative link in every `CLAUDE.md` resolves |
| `python scripts/seed-from-certified-list.py [--dry-run]` | Re-seed race files from the certified candidate lists |
| `node scripts/build-district-maps.mjs` | Rebuild `public/maps/*.json` (network + npx) |

There is no test suite. CI runs validate → check → check:contact → docs:check → build → check:links.

## Project-wide rules

- **No labels, ever.** Argument text must not reveal a party, ideology, group, or person. Both stances use identical
  markup and styling; don't add color, icons, or ordering that favors one side. Party appears only as
  `ballot_party` (as printed on the ballot).
- **Never invent content.** No source, no item. Empty is fine; the pages render "No published … found".
- **Internal links go through `url()`** from [src/lib/site.ts](src/lib/site.ts). It adds the trailing slash that
  `trailingSlash: 'always'` requires; a bare `/races` link fails the internal link check.
- **Every external URL in `src/**/*.astro` and `src/**/*.ts` gets probed** by `check:links` in CI, as do all YAML
  URLs. Don't add placeholder URLs, and expect URLs with `{` or `}` to be skipped.
- **Astro drops the space** when a line break sits next to an `<a>` tag. End such lines with `{' '}`.
- **Dates and counts in copy come from code.** Use `ELECTION_DAY`, `EARLY_VOTING` and the date helpers in
  [src/lib/site.ts](src/lib/site.ts), and `numberWord()` for counts like "three amendments". Don't type
  "November 3, 2026" into a page.

## If you change X, also update Y

| If you change… | Also update… |
| --- | --- |
| Race levels (`LEVEL_IDS` / `DISTRICT_LEVELS` in [levels.ts](src/lib/levels.ts)) | The label in `LEVELS` in [site.ts](src/lib/site.ts) (`npm run check` flags a missing one); for a district level, its map entry in `LAYERS` in [district-finder.ts](src/scripts/district-finder.ts) and its label in `districtLevels` in [ballot.astro](src/pages/ballot.astro); `LISTS` in the [seed script](scripts/seed-from-certified-list.py) |
| `ballot_party` enum | `PARTIES` in the [seed script](scripts/seed-from-certified-list.py) |
| Issue categories | Only [categories.yaml](src/data/categories.yaml); the schema and the compare table read it, and its order is the row order |
| Contact form fields, topics, or `maxlength`s in [contact.astro](src/pages/contact.astro) | `TOPICS` and `LIMITS` in [workers/contact/src/index.js](workers/contact/src/index.js) (`npm run check:contact` catches a mismatch), then redeploy the Worker by hand |
| Site domain (`site` in [astro.config.mjs](astro.config.mjs)) | `routes` in [wrangler.jsonc](wrangler.jsonc) and [the www redirect](workers/www-redirect/wrangler.jsonc), [public/robots.txt](public/robots.txt), `ALLOWED_ORIGINS` in [wrangler.jsonc](workers/contact/wrangler.jsonc), the Message-ID domain in the Worker |
| Contact Worker name or account | `CONTACT_ENDPOINT` in [site.ts](src/lib/site.ts) |
| Map file names in [build-district-maps.mjs](scripts/build-district-maps.mjs) | `LAYERS[].file` in [district-finder.ts](src/scripts/district-finder.ts) |
| Light-theme `--ink` / `--accent` in [base.css](src/styles/base.css) | `--map-ink` / `--map-accent` in the same file, which the district map reads (the map is always light) |
| Default argument tab or ordering rules | The explanation on [method.astro](src/pages/method.astro) |
| Main nav | `nav` in [Base.astro](src/layouts/Base.astro) |

## Folder guides

| Guide | Covers |
| --- | --- |
| [src/data/CLAUDE.md](src/data/CLAUDE.md) | YAML content: schema rules, sourcing, research status, editorial rulings |
| [src/lib/CLAUDE.md](src/lib/CLAUDE.md) | Shared logic: rules, view models, shuffle/footnotes, geometry |
| [src/CLAUDE.md](src/CLAUDE.md) | Site UI: routes, layout, components, browser scripts, styles |
| [scripts/CLAUDE.md](scripts/CLAUDE.md) | Link and contact checkers, map rebuild, candidate seeding |
| [workers/contact/CLAUDE.md](workers/contact/CLAUDE.md) | Contact form Worker |

Astro docs: [routing](https://docs.astro.build/en/guides/routing/),
[components](https://docs.astro.build/en/basics/astro-components/),
[content collections](https://docs.astro.build/en/guides/content-collections/),
[styling](https://docs.astro.build/en/guides/styling/), [full docs](https://docs.astro.build).

## Keeping these docs useful

- Update the folder's `CLAUDE.md` in the same change whenever how the folder works changes.
- Document what the code doesn't say (why, gotchas, cross-file dependencies). Never list functions or restate a
  file's own header comment.
- Keep folder guides to about 60 lines; they cost context every session.
- Use relative links, and run `npm run docs:check` after moving files.
- Only add a folder guide when the folder has rules an agent would otherwise get wrong.
- Never put a `CLAUDE.md` (or any `.md`) inside `src/pages/`: Astro publishes it as a page.
