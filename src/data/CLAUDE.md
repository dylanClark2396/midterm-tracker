# src/data: content guide

All guide content lives here as YAML. The schema in [../content.config.ts](../content.config.ts) and the rules in
[../lib/rules.ts](../lib/rules.ts) validate it on every `npm run validate` and every build.

| Path | Purpose |
| --- | --- |
| [races/](races/) | One file per race: 2 statewide, 9 U.S. House, 17 TN Senate, 99 TN House |
| [amendments/](amendments/) | One file per constitutional amendment |
| [categories.yaml](categories.yaml) | Platform categories. File order is the row order of the compare table |
| [config/blocklist.yaml](config/blocklist.yaml) | Terms banned from argument text (whole word, case-insensitive; a trailing `*` matches any suffix) |

## Required file shape

```yaml
# Office — one-line context. Candidate order follows the certified candidate list.
_sources:                      # optional; ignored by the schema, just YAML anchors
  camp: &camp { url: "https://…", title: "Page title (Who published it)", accessed: 2026-10-15 }
id: tn-house-012               # must equal the filename; it's the URL slug
office: "Tennessee House, District 12"
level: state_house             # statewide | us_house | state_senate | state_house
district: 12                   # null for statewide
research_status: complete      # pending = page shows names only, whatever else is filled in
candidate_list_source: "https://sos-prod.tnsosgovfiles.com/…"
candidates:
  - name: "…"
    ballot_party: Republican   # Republican | Democratic | Independent, as printed on the ballot
    bio_facts: [{ text: "…", sources: [*camp] }]
    why_running: { text: null, sources: [] }      # null = "No stated reason found"
    platform: [{ category: education, text: "…", sources: [*camp] }]
    arguments: [{ stance: for, text: "…", sources: [*camp] }]   # amendments use yes | no
last_verified: 2026-10-15
```

## Gotchas

- **`research_status: pending` hides research.** A pending race page lists only names, party and city, so set
  `complete` when you fill in platforms or arguments.
- **Candidate order is the certified list's order.** Don't sort it. Argument order is shuffled with a seed built
  from the race id, candidate `name` and stance, so renaming a candidate reshuffles their arguments (expected).
- **Platform**: at most 8 planks and one per category. The page orders planks by
  [categories.yaml](categories.yaml), not by file order.
- **Argument text**: at least 20 characters, no blocklisted term. The blocklist catches label words, not
  intent, so wording that implies a side through a name, slogan or group still has to be rewritten by hand.
- **Amendment official facts** (fiscal note, resolutions, vote URLs) must be on a `.gov` host or `tnsosfiles.com`.
  `official_source` must be `.gov`.
- Every URL here is probed by `npm run check:links` in CI. A dead (404/410/DNS) source fails the deploy; a
  bot-blocked one (401/403/429) is only a warning.
- [../../scripts/seed-from-certified-list.py](../../scripts/seed-from-certified-list.py) rewrites **pending** files
  when the certified list changes. It never overwrites a file that has research content; it reports conflicts in
  [../../data-staging/seed-report.md](../../data-staging/seed-report.md) instead.

## Editorial rulings (keep research consistent)

- Paraphrase in your own words. Keep any quote under 15 words and never attribute it to a named person in the text.
- "Why running" and "platform" come only from the candidate's own materials (campaign site, announcements,
  questionnaires, interviews). The live campaign site counts as the current platform even if its text is older.
- "Against" items must be published about *this* candidate (their record, a bill they sponsored, opponent
  material naming them). Pairing a vote with a general policy critique is inference; leave it out.
- Never build an argument from neutral data (budget scores, statistics). If nobody published the argument, the
  column stays empty.
- Neutral record facts that nobody argues about are bio facts, not arguments. A party office held is a valid bio
  fact; trivia about party switching is not.
- Criminal charges never go in, even if dismissed.
- Independents with no published information stay as name, party and city only.
- Find a candidate's real campaign site through the FEC API (`/v1/committee/<id>/` → `website`); guessed domains
  are often parked.
