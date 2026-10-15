# src: the site UI (pages, layout, components, browser code, styles)

Every `.astro` or `.md` file in [pages/](pages/) is a route (Astro file-based routing). The pages use
[layouts/](layouts/Base.astro), [components/](components/), [scripts/](scripts/district-finder.ts) and
[styles/](styles/global.css). Content and shared logic have their own guides: [data/](data/CLAUDE.md),
[lib/](lib/CLAUDE.md).

| Route | File | Notes |
| --- | --- | --- |
| `/races/<id>/`, `/amendments/<id>/` | [pages/races/[id].astro](pages/races/[id].astro), [pages/amendments/[id].astro](pages/amendments/[id].astro) | One page per YAML file, built via `getStaticPaths` |
| `/districts/` | [pages/districts.astro](pages/districts.astro) + [scripts/district-finder.ts](scripts/district-finder.ts) | Leaflet map and address search; the page hands race data to the script through `data-races` |
| `/ballot/` | [pages/ballot.astro](pages/ballot.astro) | Practice ballot, all in the browser |
| `/contact/` | [pages/contact.astro](pages/contact.astro) | Posts to the Worker in [../workers/contact/](../workers/contact/CLAUDE.md) |
| `/method/` | [pages/method.astro](pages/method.astro) | The public editorial rules; keep it in sync with behavior |

## Page skeleton

```astro
---
import Base from '../layouts/Base.astro';   // from a page directly in src/pages/
import { url } from '../lib/site';
---
<Base title="Short name" description="One sentence for search results.">
  <h1>…</h1>
  <a href={url('races')}>Races</a>{' '}   <!-- url() for internal links; {' '} keeps the space -->
</Base>
```

- `title="Home"` is special: [layouts/Base.astro](layouts/Base.astro) then uses the long home-page title and
  adds the JSON-LD block. Pass `noindex` to keep a page out of search results (as [pages/404.astro](pages/404.astro) does).
- Data pages call a `prepare*` view model from [lib/site.ts](lib/site.ts) and pass its `sources` to
  [components/Sources.astro](components/Sources.astro). Don't number footnotes in a page; see
  [lib/CLAUDE.md](lib/CLAUDE.md).

## Components

- [components/ArgColumns.astro](components/ArgColumns.astro): the two equal argument columns. They become tabs on
  narrow screens, driven by the `[data-tabs]` script in `Base.astro`. Its `id` prop must be unique on the page
  (race pages use the candidate's name slug). The first tab (YES / For) is always the default, as the method page
  promises.
- [components/Refs.astro](components/Refs.astro) links to `#src-N`. `Base.astro` opens the collapsed Sources
  `<details>` when the URL hash points inside it.

## Styles

- [styles/global.css](styles/global.css) only `@import`s base → blocks → arguments → candidates. Keep that
  order. Colors come from the tokens in [styles/base.css](styles/base.css), which has light and dark sets.
- Never style the two stances differently (no colors or icons per side).
- Page `<style>` blocks are scoped. HTML that a script inserts (finder results, cheat-sheet list) needs `:global()`
  selectors, as in [pages/districts.astro](pages/districts.astro) and [pages/ballot.astro](pages/ballot.astro).

## Gotchas

- **Never put a `.md` file (including a `CLAUDE.md`) in `pages/`.** Astro publishes it as a page and adds it to the
  sitemap. That's why this guide sits in `src/`.
- **Ballot cheat sheet stores nothing**, not even in `localStorage`; the page tells voters so. Don't add
  persistence. It also resets on a back/forward cache restore and warns before unload.
- **District finder**: the Census geocoder sends no CORS headers, so it's called through JSONP. Only odd-numbered
  TN Senate districts have races in 2026. The map lines are simplified, so the finder shows a "confirm with the
  state's lookup" notice near any line (`nearLine` in [lib/geo.ts](lib/geo.ts)). Map tiles are OpenStreetMap
  (CARTO now needs a key), and Leaflet's flag prefix is removed on purpose.
- **Contact**: the Worker answers `{ ok, error? }` JSON, and the page shows `error` as written. The hidden
  `website` field is a honeypot and `page` is filled from the referrer. Field names, topic values and
  `maxlength`s must match the Worker; `npm run check:contact` verifies that.
- Write dates and counts with the helpers in [lib/site.ts](lib/site.ts) (`ELECTION_DAY`, `EARLY_VOTING`,
  `formatDayRange`, `numberWord`), not as literal text. Statewide races are found by `level`, never by id.
