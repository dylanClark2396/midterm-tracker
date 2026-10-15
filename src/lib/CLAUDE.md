# src/lib: shared logic

Plain TypeScript used by the schema, the pages and the browser. No components here.

| File | Runs in | Used by |
| --- | --- | --- |
| [rules.ts](rules.ts) | Node only (build) | [../content.config.ts](../content.config.ts) and the compare-table labels in [../pages/races/[id].astro](../pages/races/[id].astro) |
| [site.ts](site.ts) | Build (Astro only) | Every page, [../layouts/Base.astro](../layouts/Base.astro) and the components |
| [geo.ts](geo.ts) | Browser | [../scripts/district-finder.ts](../scripts/district-finder.ts) |

## Rules for each file

- **rules.ts reads YAML with `fs` from `process.cwd()/src/data`**, because the bundled module ends up in a different
  directory. Run builds and scripts from the project root, and never import it into browser code.
- **site.ts uses `import.meta.env.BASE_URL`**, so plain Node scripts can't import it. Pages use its `url()` helper
  for every internal link (see the [root guide](../../CLAUDE.md)).
- **geo.ts must stay free of Leaflet and DOM code** so the point-in-polygon logic stays pure. Coordinates are
  `[lng, lat]` (GeoJSON order) but Leaflet uses `[lat, lng]`; the finder converts at the call site.

## Footnote numbering (the easy thing to break)

`prepareRace` and `prepareAmendment` create one `Footnotes` per page and call `ref()` **in the order the page
renders items**, so `[1]`, `[2]`, … run top to bottom. Numbers are deduped by URL; when two sources share a URL,
the first title wins.

```ts
const notes = new Footnotes();
// 1. compare table cells (each plank is ref'd once here)…
// 2. then per candidate: bio → why → platform (reuses the table's refs) → for → against
return { …, sources: notes.list };   // pass to <Sources>
```

If you reorder sections on a race or amendment page, reorder the `ref()` calls in the matching `prepare*` function
the same way, or the footnote numbers will jump around. Never call `ref()` from a component.

## Ordering

- Arguments go through `seededShuffle` with a seed of `<id>:<stance>` (amendments) or `<race id>:<name>:<stance>`
  (candidates). Never use `Math.random()` or sort arguments: order must not signal priority, and it must stay the
  same from one build to the next.
- Platform planks and compare-table rows follow [../data/categories.yaml](../data/categories.yaml) order.
- Candidates keep the file's order (the certified list).

## Gotchas

- Adding a race `level` means updating `LEVELS` here and several other files; see "If you change X" in the
  [root guide](../../CLAUDE.md).
- `hasProfile` and `ELECTION_DATE` are exported but not used anywhere.
- `CONTACT_ENDPOINT` and `TURNSTILE_SITE_KEY` are public by design. The Turnstile secret lives only in the Worker
  ([../../workers/contact/](../../workers/contact/CLAUDE.md)).
