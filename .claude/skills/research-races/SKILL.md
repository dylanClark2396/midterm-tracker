---
name: research-races
description: Resume or continue researching pending race pages (fill candidates' platforms, bios and arguments), one PR per district, verified by a second agent and merged on green. Use when asked to continue, resume or run the race research.
---

# Research pending races

Race research runs in waves of background agents from a local session (the cloud sandbox blocks the news and
government sites research needs). All progress lives in git and GitHub, so a fresh session can resume at any
point. Nothing is tracked in memory or in this file.

The owner has authorized merging research PRs without review once CI is green and the verifier pass is done.
Feature PRs are different: never merge those without asking.

## 1. See where things stand

```sh
node scripts/research-queue.mjs --next 6
```

It prints four lists. Handle them in this order:

1. **Verified PRs:** merge each one whose `Validate` check passed (Deploy shows skipped on PRs):
   `gh pr checks <n>` then `gh pr merge <n> --squash --delete-branch`. If Validate failed, read the log
   (`gh run view --log-failed`), fix it on the branch, and merge after it goes green.
2. **PRs needing the verifier pass:** start one verifier agent per PR (prompt below).
3. **Claimed branches with no PR:** if this session didn't start them, a previous session was cut off.
   - 0 commits past main: delete the branch (`git push origin --delete data/<id>`) so the race returns to the queue.
   - 1+ commits: start a research agent for that race and tell it to continue from the existing branch
     (`git checkout -b data/<id> origin/data/<id>`) instead of starting from main.
4. **Next to research:** contested races come first, then single-candidate ones. Keep about 6 research agents
   running at once.

Remove leftover local worktrees from dead sessions with `git worktree prune` (and delete their folders under
`.claude/worktrees/`).

## 2. Research agent (one per race)

Run it with the Agent tool: `subagent_type: general-purpose`, `isolation: worktree`, `run_in_background: true`.
Replace `<id>` (for example `tn-house-030`) and `<n>` (the district number), and fill in today's date:

> Research race `<id>` for the TN 2026 Ballot Guide (a nonpartisan voter guide for the Nov 3, 2026 Tennessee
> general election, https://tnelection.org) and open a PR. Today is <YYYY-MM-DD>.
>
> Setup and claim: `git fetch origin && git checkout -b data/<id> origin/main && git push -u origin data/<id>`.
> If the push is rejected, another session already claimed this race. Stop and report that.
>
> First read these rules (they're binding): CLAUDE.md, src/data/CLAUDE.md, src/content.config.ts, src/lib/rules.ts,
> src/data/categories.yaml and src/data/config/blocklist.yaml. src/data/races/tn-house-019.yaml is a finished
> example. Edit only src/data/races/<id>.yaml.
>
> Every rule in src/data/CLAUDE.md applies, especially:
> - Never invent content. No source means no item, and an empty field is fine.
> - Argument text has no party, ideology, group or person labels.
> - why_running and platform come only from the candidate's own materials.
> - AGAINST items must be published about this specific candidate.
> - Never build an argument from neutral data.
> - Criminal charges never go in.
> - Maximum 8 planks, one per category. Keep candidate order.
>
> Sources:
> - The candidate's real campaign site, found by web search. Confirm it's theirs; guessed domains are often parked.
> - Ballotpedia.
> - The Tennessee Lookout voter guide at tennesseelookout.com/voter-guides/contests/house-district-<n>/ (Senate:
>   senate-district-<n>). If you get a 403, use `curl -sL -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)
>   AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' <url>`.
> - Vote411 and local news. WJHL stories are mirrored on yahoo.com/news.
> - For incumbents: their wapp.capitol.tn.gov page and bill pages.
>
> The Knox News guide is paywalled, so never rely on it. Cite only pages you opened and read, never search snippets.
> Each source is `{url, title: "Page title (Publisher)", accessed: <today>}`. Set `research_status: complete` and
> `last_verified: <today>`.
>
> Run `npm ci` and `npm run validate`, and fix any failure. Commit as `data: <id>` and end the message with
> `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push, then
> `gh pr create --base main --title "data: <id>"`. The PR body has a one-line summary, a table
> Candidate (party initial) | Planks | For | Against, and a "For the reviewer" section listing gaps and anything
> uncertain. End the body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`. Don't merge.
> Report back the PR number, the table, and anything uncertain.

## 3. Verifier agent (one per PR, after research)

Run it with the same Agent settings:

> Verify research PR #<n> (`data/<id>`) for the TN 2026 Ballot Guide. Run
> `git fetch origin && git checkout -b data/<id> origin/data/<id>`, then read src/data/CLAUDE.md for the rules.
>
> Open every cited URL yourself. If you get a 403, use curl with a browser user agent. For each item, confirm the
> source supports it as written, and that it follows the rules: candidate's own materials for platform and
> why_running, against items published about this candidate, no labels, no inference, no criminal charges. Fix the
> wording or remove the item when a source doesn't support it.
>
> Run `npm run validate`, then commit as `verify: <id>` with the same Co-Authored-By line, and push. Comment on the
> PR (`gh pr comment`) with the number of entries checked, the number supported as written, and a list of what you
> fixed or removed. Then run `gh pr edit <n> --add-label verified`. Report back the same summary.

## 4. Repeat until the queue is empty

Every time an agent finishes, start the next step for its race: verifier after research, merge after verify. Top
the pool back up from the queue. Rerun the queue script whenever you're unsure of the state; it's the source of
truth.
