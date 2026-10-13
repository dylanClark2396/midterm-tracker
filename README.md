# TN 2026 Ballot Guide — Arguments Without Labels

A static, mobile-friendly voter guide for the **November 3, 2026 Tennessee general election**, published at
**https://dylanclark2396.github.io/midterm-tracker/**.

It covers the three proposed constitutional amendments and the races on the ballot, and presents the arguments for
and against each one — **without any party, ideology, or group label**. Readers judge each argument on what it says,
not on who says it. The guide never tells anyone how to vote.

## The no-labels method

- **Arguments are just text.** No party or ideology tags, no names of the people or groups making them, no color
  coding or icons. Both columns (YES/NO, For/Against) are styled identically.
- **Sources without steering.** Every argument carries a footnote marker like `[3]`. Sources are collected in a
  collapsed **Sources** section at the bottom of each page, numbered in order. Nothing is hidden; nobody is nudged.
- **Shuffled order.** Arguments in each column are shuffled with a fixed seed per item at build time
  (`seededShuffle` in `src/lib/site.ts`), so order never signals priority and stays stable between visits.
- **Neutral wording.** Arguments are paraphrased in their strongest fair form. A blocklist of party/ideology terms
  (`src/data/config/blocklist.yaml`) is enforced at build time.
- **Candidates' own words for platforms.** "Why they're running" and "Platform" come only from a candidate's own
  materials (campaign site, announcements, questionnaires, direct interviews). Opponents' claims go under
  "Arguments against." Party appears only because it is printed on the ballot.
- **Never invent.** If nothing is published, the page says "No published arguments found" / "No published platform
  found" with the date checked.

The full editorial rules are on the site's [How this guide works](https://dylanclark2396.github.io/midterm-tracker/method/) page.

## Coverage

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | 3 amendments, Governor, U.S. Senate | Fully sourced |
| 2 | 9 U.S. House districts (May 2026 map) | Certified candidate lists; platforms and arguments in progress |
| 3 | 17 state Senate + 99 state House districts | Certified candidate lists; platforms and arguments in progress |

Candidate lists come from the Secretary of State's certified lists:
<https://sos.tn.gov/elections/2026-candidate-lists>.

## Data

All content lives in YAML under `src/data/` and is validated by the Zod schema in `src/content.config.ts`
(Astro content collections). **The build fails** if:

- any argument, platform plank, bio fact, or reason for running has no source URL;
- any argument contains a blocklisted label term;
- a candidate has more than 8 platform planks, or a plank uses a category not in `src/data/categories.yaml`;
- official facts (fiscal note, votes, resolutions) don't come from a government source.

```
src/data/
  categories.yaml           shared issue categories (rows of the compare table)
  config/blocklist.yaml     terms not allowed in argument text
  amendments/<id>.yaml      one file per amendment
  races/<id>.yaml           one file per race
```

Amendment files hold the verbatim ballot question, the Attorney General's summary, a plain-English summary, the
fiscal note, legislative votes, and `arguments` (`stance: yes | no`). Race files hold `candidates`, each with
`bio_facts`, `why_running`, `platform`, and `arguments` (`stance: for | against`). Every file has `last_verified`.

Files may define a top-level `_sources:` map of YAML anchors (`&name`) so a source can be reused as `*name`; the
schema ignores that key.

### Adding or updating data

1. Edit or add the YAML file. Paraphrase in your own words; keep any quote under 15 words and never attribute it to a
   named person in the text.
2. Give every item at least one source (`url`, `title`, `accessed`). Update `last_verified`.
3. To finish a "candidates only" race, fill in the candidates' fields and set `research_status: complete`.
4. Run `npm run build` and `npm run check:links`.

## Run locally

```sh
npm install
npm run dev          # http://localhost:4321/midterm-tracker/
npm run validate     # schema + blocklist checks only
npm run build        # full static build into dist/
npm run check:links  # internal links + every source URL (run after build)
```

Requires Node 22.12+.

## Deployment

`.github/workflows/deploy.yml` runs on every push to `main`: validate → build → link check → deploy to GitHub Pages
with `actions/deploy-pages`. It also re-checks links weekly. Source URLs that return 404/410 or fail DNS fail the
check; sites that block automated requests (401/403/429) are reported as warnings.

## Corrections

Open an issue with the **Suggest a correction** template. A source URL is required.

## Disclaimer

Not affiliated with any party, campaign, candidate, or government agency. Not voting advice.
