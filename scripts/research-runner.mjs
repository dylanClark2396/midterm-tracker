#!/usr/bin/env node
// Runs the research-races pipeline without an orchestrating Claude session: research → verify → wait for CI →
// merge, one race per worktree. Only the research and verify steps use Claude, each as a fresh headless
// `claude -p` run with a narrow tool allowlist. Queue, claims, CI polling and merging are plain code.
// State still lives only in git and GitHub (see research-queue.mjs), so this and the skill can take turns.
//
// Usage: node scripts/research-runner.mjs [options]   (run from the project root; needs git, gh, claude)
//   --jobs N        Claude runs at once (default 4)
//   --limit N       New races to start this run (default: the whole queue)
//   --only a,b      Only these race ids
//   --model M       Model for the claude runs, e.g. sonnet (default: your Claude Code default)
//   --budget USD    Per-run --max-budget-usd cap
//   --adopt         Also take over work another session left: verify open unverified PRs and continue claimed
//                   data/* branches with no PR. Only use when no other session is researching.
//   --dry-run       Print the plan and exit
// Logs (each run's JSON result, including its session id for `claude --resume`) go to .claude/research-logs/.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? argv[i + 1] : fallback;
};
const JOBS = Number(opt('jobs', 4));
const LIMIT = Number(opt('limit', Infinity));
const ONLY = opt('only', '').split(',').filter(Boolean);
const MODEL = opt('model');
const BUDGET = opt('budget');
const ADOPT = argv.includes('--adopt');
const DRY = argv.includes('--dry-run');

const ROOT = process.cwd();
const LOGS = resolve(ROOT, '.claude/research-logs');
const TODAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
const CI_TIMEOUT_MS = 30 * 60_000;

const sh = (cmd, args, cwd = ROOT) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: cmd === 'npm' });
const tryRun = (cmd, args, cwd) => {
  try {
    return sh(cmd, args, cwd);
  } catch {
    return null;
  }
};
const log = (id, msg) => console.log(`${new Date().toLocaleTimeString()}  ${id.padEnd(14)} ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Claude runs: a priority semaphore, so verifying finished research beats starting new research.
let running = 0;
const waiters = [];
async function withSlot(priority, fn) {
  if (running >= JOBS) {
    await new Promise((r) => {
      waiters.push({ priority, r });
      waiters.sort((a, b) => b.priority - a.priority);
    });
  }
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiters.shift()?.r();
  }
}

function claude(id, step, cwd, prompt, allowed) {
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'dontAsk', '--allowedTools', ...allowed];
  if (MODEL) args.push('--model', MODEL);
  if (BUDGET) args.push('--max-budget-usd', BUDGET);
  return new Promise((done) => {
    const child = spawn('claude', args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.stdin.end(prompt);
    child.on('close', (code) => {
      writeFileSync(resolve(LOGS, `${id}-${step}.json`), out || err);
      let result = {};
      try {
        result = JSON.parse(out);
      } catch {}
      const cost = result.total_cost_usd != null ? ` ($${result.total_cost_usd.toFixed(2)})` : '';
      log(id, `${step} finished, exit ${code}, ${result.num_turns ?? '?'} turns${cost}`);
      done(code === 0 && !result.is_error);
    });
  });
}

// Tools the headless runs may use. Anything else is denied (dontAsk), never prompted.
const baseTools = (id) => [
  'Read', 'Edit', 'Write', 'Glob', 'Grep', 'WebSearch', 'WebFetch',
  'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git add:*)',
  'Bash(git commit:*)', `Bash(git push origin HEAD:data/${id})`,
  'Bash(npm run validate)', 'Bash(curl:*)', 'Bash(date:*)', 'Bash(ls:*)', 'Bash(cat:*)', 'Bash(head:*)',
  'Bash(grep:*)',
];

const RULES = `Every rule in src/data/CLAUDE.md applies, especially:
- Never invent content. No source means no item, and an empty field is fine.
- Argument text has no party, ideology, group or person labels.
- why_running and platform come only from the candidate's own materials.
- AGAINST items must be published about this specific candidate.
- Never build an argument from neutral data.
- Criminal charges never go in.
- Maximum 8 planks, one per category. Keep candidate order.`;

const researchPrompt = (id, continuing) => {
  const n = Number(id.match(/(\d+)$/)[1]);
  const lookout = id.startsWith('tn-senate') ? `senate-district-${n}` : `house-district-${n}`;
  return `Research race \`${id}\` for the TN 2026 Ballot Guide (a nonpartisan voter guide for the Nov 3, 2026 Tennessee
general election, https://tnelection.org) and open a PR. Today is ${TODAY}.

You're in a git worktree that's already set up: the race is claimed as remote branch data/${id} and node_modules
is installed.${continuing ? ' The branch has earlier, unfinished work on it: check `git log origin/main..HEAD` and continue from it.' : ''}

First read these rules (they're binding): CLAUDE.md, src/data/CLAUDE.md, src/content.config.ts, src/lib/rules.ts,
src/data/categories.yaml and src/data/config/blocklist.yaml. src/data/races/tn-house-019.yaml is a finished
example. Edit only src/data/races/${id}.yaml.

${RULES}

Sources:
- The candidate's real campaign site, found by web search. Confirm it's theirs; guessed domains are often parked.
- Ballotpedia.
- The Tennessee Lookout voter guide at https://tennesseelookout.com/voter-guides/contests/${lookout}/. If you get a
  403, use \`curl -sL -A 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)
  Chrome/124.0 Safari/537.36' <url>\`.
- Vote411 and local news. WJHL stories are mirrored on yahoo.com/news.
- For incumbents: their wapp.capitol.tn.gov page and bill pages.

The Knox News guide is paywalled, so never rely on it. Cite only pages you opened and read, never search snippets.
Each source is \`{url, title: "Page title (Publisher)", accessed: ${TODAY}}\`. Set \`research_status: complete\` and
\`last_verified: ${TODAY}\`.

Run \`npm run validate\` and fix any failure. Then \`git add src/data/races/${id}.yaml\` (only that file) and commit
as \`data: ${id}\`, ending the message with \`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\`.
Push with exactly \`git push origin HEAD:data/${id}\`. Don't open the PR yourself. Instead, write the PR body to
.pr-body.md in the worktree root (don't commit it): a one-line summary, a table Candidate (party initial) |
Planks | For | Against, and a "For the reviewer" section listing gaps and anything uncertain.`;
};

const verifyPrompt = (id, pr) => `Verify research PR #${pr} (branch data/${id}) for the TN 2026 Ballot Guide. Today is ${TODAY}.
You're in a git worktree with the branch checked out. Read src/data/CLAUDE.md for the rules, then
src/data/races/${id}.yaml.

Open every cited URL yourself. If you get a 403, use curl with a browser user agent. For each item, confirm the
source supports it as written, and that it follows the rules: candidate's own materials for platform and
why_running, against items published about this candidate, no labels, no inference, no criminal charges. Fix the
wording or remove the item when a source doesn't support it.

Run \`npm run validate\`. If you changed anything, commit as \`verify: ${id}\` ending with
\`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\` and push with exactly \`git push origin HEAD:data/${id}\`.
Don't comment on the PR yourself. Instead, write .verify-comment.md in the worktree root (don't commit it): the
number of entries checked, the number supported as written, and a list of what you fixed or removed.`;

// ---- Worktrees and GitHub.
const worktree = (id) => resolve(ROOT, '.claude/worktrees', `run-${id}`);

function setupWorktree(id, from) {
  const dir = worktree(id);
  if (existsSync(dir)) {
    tryRun('git', ['worktree', 'remove', '--force', dir]);
  }
  sh('git', ['fetch', '-q', 'origin']);
  // A local run/<id> branch, so it never collides with a data/<id> checked out in another worktree.
  sh('git', ['worktree', 'add', '-q', '-B', `run/${id}`, dir, from]);
  sh('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], dir);
  return dir;
}

function cleanup(id) {
  tryRun('git', ['worktree', 'remove', '--force', worktree(id)]);
  tryRun('git', ['branch', '-D', `run/${id}`]);
}

const prFor = (id) =>
  JSON.parse(sh('gh', ['pr', 'list', '--head', `data/${id}`, '--state', 'open', '--json', 'number']))[0]?.number;

function claim(id) {
  if (sh('git', ['ls-remote', '--heads', 'origin', `data/${id}`]).trim()) return false;
  return tryRun('git', ['push', '-q', 'origin', `origin/main:refs/heads/data/${id}`]) !== null;
}

function validateCheck(pr) {
  const checks = JSON.parse(tryRun('gh', ['pr', 'checks', String(pr), '--json', 'name,bucket']) ?? '[]');
  return checks.find((c) => c.name.startsWith('Validate'))?.bucket; // pass | fail | pending | undefined
}

async function mergeWhenGreen(id, pr) {
  const start = Date.now();
  await sleep(15_000); // let the push register a new check run
  for (;;) {
    const state = validateCheck(pr);
    if (state === 'pass') break;
    if (state === 'fail') return log(id, `#${pr} Validate failed; left open (gh run view --log-failed)`), false;
    if (Date.now() - start > CI_TIMEOUT_MS) return log(id, `#${pr} CI still pending after 30 min; left open`), false;
    await sleep(30_000);
  }
  sh('gh', ['pr', 'merge', String(pr), '--squash']);
  tryRun('git', ['push', '-q', 'origin', '--delete', `data/${id}`]);
  log(id, `#${pr} merged`);
  return true;
}

// ---- One race, from wherever it is to merged.
async function pipeline(task) {
  const { id } = task;
  let pr = task.pr;
  try {
    if (!pr) {
      const ok = await withSlot(0, async () => {
        if (task.kind === 'new' && !claim(id)) return log(id, 'already claimed elsewhere, skipped'), false;
        const dir = setupWorktree(id, task.kind === 'new' ? 'origin/main' : `origin/data/${id}`);
        log(id, task.kind === 'new' ? 'researching' : 'continuing research');
        if (!(await claude(id, 'research', dir, researchPrompt(id, task.kind === 'continue'), baseTools(id)))) return false;
        if (tryRun('npm', ['run', 'validate'], dir) === null) return log(id, 'validate fails after research; worktree kept'), false;
        sh('git', ['fetch', '-q', 'origin'], dir);
        if (sh('git', ['rev-list', '--count', `origin/main..origin/data/${id}`], dir).trim() === '0')
          return log(id, 'nothing pushed; worktree kept'), false;
        const body = resolve(dir, '.pr-body.md');
        if (!existsSync(body)) writeFileSync(body, `Research for ${id}. (The research run left no PR body.)\n`);
        writeFileSync(body, `${readFileSync(body, 'utf8').trim()}\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)\n`);
        sh('gh', ['pr', 'create', '--base', 'main', '--head', `data/${id}`, '--title', `data: ${id}`, '--body-file', body], dir);
        return true;
      });
      if (!ok) return;
      pr = prFor(id);
      log(id, `opened #${pr}`);
    }

    const verified = await withSlot(1, async () => {
      const dir = existsSync(worktree(id)) ? worktree(id) : setupWorktree(id, `origin/data/${id}`);
      tryRun('git', ['pull', '-q', '--ff-only', 'origin', `data/${id}`], dir);
      log(id, `verifying #${pr}`);
      if (!(await claude(id, 'verify', dir, verifyPrompt(id, pr), baseTools(id)))) return false;
      if (tryRun('npm', ['run', 'validate'], dir) === null) return log(id, 'validate fails after verify; worktree kept'), false;
      const comment = resolve(dir, '.verify-comment.md');
      if (!existsSync(comment)) return log(id, 'verifier left no summary; worktree kept'), false;
      sh('gh', ['pr', 'comment', String(pr), '--body-file', comment], dir);
      sh('gh', ['pr', 'edit', String(pr), '--add-label', 'verified'], dir);
      return true;
    });
    if (!verified) return;

    if (await mergeWhenGreen(id, pr)) cleanup(id);
  } catch (e) {
    log(id, `error: ${(e.stderr || e.message).toString().trim().split('\n')[0]}; worktree kept`);
  }
}

// ---- Plan.
mkdirSync(LOGS, { recursive: true });
const state = JSON.parse(sh('node', ['scripts/research-queue.mjs', '--json']));
const pick = (rows) => (ONLY.length ? rows.filter((r) => ONLY.includes(r.id)) : rows);

const tasks = [];
if (ADOPT) {
  for (const p of pick(state.unverified)) tasks.push({ id: p.id, kind: 'verify', pr: p.number });
  for (const o of pick(state.orphans)) tasks.push({ id: o.id, kind: o.ahead > 0 ? 'continue' : 'reclaim' });
}
for (const r of pick(state.queue).slice(0, LIMIT)) tasks.push({ id: r.id, kind: 'new' });

console.log(`Today ${TODAY}. ${JOBS} claude runs at once${MODEL ? `, model ${MODEL}` : ''}.`);
console.log(`Merge if green: ${state.verified.map((p) => `#${p.number}`).join(' ') || '(none)'}`);
for (const kind of ['verify', 'continue', 'reclaim', 'new'])
  console.log(`${kind.padEnd(9)} ${tasks.filter((t) => t.kind === kind).map((t) => t.id).join(' ') || '(none)'}`);
if (!ADOPT && (state.unverified.length || state.orphans.length))
  console.log(`(Skipping ${state.unverified.length} unverified PRs and ${state.orphans.length} claimed branches; --adopt takes them over.)`);
if (DRY) process.exit(0);

// A claim with no commits is reset to a fresh claim.
for (const t of tasks.filter((t) => t.kind === 'reclaim')) {
  tryRun('git', ['push', '-q', 'origin', '--delete', `data/${t.id}`]);
  t.kind = 'new';
}

await Promise.all([
  ...state.verified.map(async (p) => (await mergeWhenGreen(p.id, p.number)) && cleanup(p.id)),
  ...tasks.map(pipeline),
]);
console.log('\nDone. Run `npm run research:queue` to see what is left.');
