#!/usr/bin/env node
// Shows where race research stands, so any session can pick up where the last one stopped.
// State lives only in git and GitHub: `research_status` on origin/main, open `data/*` PRs (with or
// without the `verified` label), and `data/*` branches without a PR. Nothing else to keep in sync.
//
// Usage: node scripts/research-queue.mjs [--next N] [--json]   (run from the project root; needs git and gh)
import { execFileSync } from 'node:child_process';

const nextArg = process.argv.indexOf('--next');
const NEXT = nextArg > -1 ? Number(process.argv[nextArg + 1]) : 6;
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

// Agent worktrees share this repo's refs, so a concurrent fetch can fail with "incorrect old value"; retry.
for (let attempt = 1; ; attempt++) {
  try {
    run('git', ['fetch', '-q', 'origin']);
    break;
  } catch (err) {
    if (attempt === 3) throw err;
  }
}
const files = run('git', ['ls-tree', '--name-only', 'origin/main', 'src/data/races/'])
  .split('\n')
  .filter((f) => f.endsWith('.yaml'));

// Statewide first, then U.S. House, TN Senate, TN House; district number within a level.
const LEVEL_ORDER = ['statewide', 'us_house', 'state_senate', 'state_house'];
const races = files.map((f) => {
  const text = run('git', ['show', `origin/main:${f}`]);
  return {
    id: f.split('/').pop().replace('.yaml', ''),
    pending: /^research_status:\s*pending/m.test(text),
    candidates: (text.match(/^ {2}- name:/gm) ?? []).length,
    level: LEVEL_ORDER.indexOf(text.match(/^level:\s*(\w+)/m)?.[1]),
    district: Number(text.match(/^district:\s*(\d+)/m)?.[1] ?? 0),
  };
});

const prs = JSON.parse(
  run('gh', ['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,headRefName,labels']),
).filter((p) => p.headRefName.startsWith('data/'));
const branches = run('git', ['ls-remote', '--heads', 'origin', 'data/*'])
  .split('\n')
  .filter(Boolean)
  .map((l) => l.split('refs/heads/')[1]);

const prIds = new Set(prs.map((p) => p.headRefName.slice(5)));
const verified = prs.filter((p) => p.labels.some((l) => l.name === 'verified'));
const unverified = prs.filter((p) => !verified.includes(p));
const orphanBranches = branches.filter((b) => !prIds.has(b.slice(5)));
const busy = new Set([...prIds, ...branches.map((b) => b.slice(5))]);

const pending = races.filter((r) => r.pending);
const queue = pending
  .filter((r) => !busy.has(r.id))
  .sort((a, b) => (b.candidates > 1) - (a.candidates > 1) || a.level - b.level || a.district - b.district);
const contested = pending.filter((r) => r.candidates > 1).length;

// A branch is pushed (at main's commit) as a claim before research starts, so "0 commits" means
// research is running elsewhere or was cut off before its first commit.
const ahead = (b) => Number(run('git', ['rev-list', '--count', `origin/main..origin/${b}`]).trim());

if (process.argv.includes('--json')) {
  // For research-runner.mjs.
  console.log(JSON.stringify({
    verified: verified.map((p) => ({ number: p.number, id: p.headRefName.slice(5) })),
    unverified: unverified.map((p) => ({ number: p.number, id: p.headRefName.slice(5) })),
    orphans: orphanBranches.map((b) => ({ id: b.slice(5), ahead: ahead(b) })),
    queue: queue.map((r) => ({ id: r.id, candidates: r.candidates })),
  }));
  process.exit(0);
}

const list = (rows, fmt) => (rows.length ? rows.map((r) => `  ${fmt(r)}`).join('\n') : '  (none)');
console.log(`Researched: ${races.length - pending.length} of ${races.length}. Pending on main: ${pending.length} ` +
  `(${contested} contested, ${pending.length - contested} single-candidate).\n`);
console.log(`1. Verified PRs, merge when CI is green:\n${list(verified, (p) => `#${p.number} ${p.headRefName}`)}\n`);
console.log(`2. PRs that still need the verifier pass:\n${list(unverified, (p) => `#${p.number} ${p.headRefName}`)}\n`);
console.log(`3. data/* branches with no PR (claimed; if no session is working on them, they were interrupted):\n` +
  list(orphanBranches, (b) => `${b}  (${ahead(b)} commits past main)`) + '\n');
console.log(`4. Next ${Math.min(NEXT, queue.length)} to research:\n` +
  list(queue.slice(0, NEXT), (r) => `${r.id}  (${r.candidates} candidate${r.candidates === 1 ? '' : 's'})`));
