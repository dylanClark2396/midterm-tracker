#!/usr/bin/env node
// Link checker.
//  1. Internal: every href/src in dist/ that points inside the site must resolve
//     to a built file, and every same-page #fragment must exist.
//  2. External: every URL in src/data/**/*.yaml and src/**/*.astro must resolve.
//     404/410 and DNS failures fail the check. 401/403/429 (bot protection) and
//     transient errors are reported as warnings, since the page exists for humans.
//     Cloudflare challenges (cf-mitigated: challenge) can't be passed by a script,
//     so they're summarized as one line per host instead of a warning per URL.
//     405 counts as reachable: the server is there, it just wants another method.
//
// Usage: node scripts/check-links.mjs [--internal-only | --external-only] [--changed-since <git ref>]
//   --changed-since limits the external pass to files changed between <ref> and HEAD.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const argv = process.argv.slice(2);
const args = new Set(argv);
const since = argv.includes('--changed-since') ? argv[argv.indexOf('--changed-since') + 1] : null;
const BASE = ''; // site is served from the domain root
const DIST = 'dist';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

let failures = 0;
let warnings = 0;
const fail = (msg) => (failures++, console.error(`FAIL  ${msg}`));
const warn = (msg) => (warnings++, console.warn(`WARN  ${msg}`));

function checkInternal() {
  if (!existsSync(DIST)) {
    fail('dist/ not found — run `npm run build` first');
    return;
  }
  const pages = walk(DIST).filter((p) => p.endsWith('.html'));
  let checked = 0;
  for (const page of pages) {
    const html = readFileSync(page, 'utf8');
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    for (const [, ref] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
      checked++;
      if (ref.startsWith('#')) {
        if (ref.length > 1 && !ids.has(ref.slice(1))) fail(`${page}: missing anchor ${ref}`);
        continue;
      }
      if (!ref.startsWith('/') || ref.startsWith('//')) continue;
      if (!ref.startsWith(`${BASE}/`) && ref !== BASE) {
        fail(`${page}: internal link without base path: ${ref}`);
        continue;
      }
      const path = decodeURI(ref.slice(BASE.length).split('#')[0].split('?')[0]);
      const target = join(DIST, path);
      const ok = path.endsWith('/') ? existsSync(join(target, 'index.html')) : existsSync(target) || existsSync(join(target, 'index.html'));
      if (!ok) fail(`${page}: broken internal link ${ref}`);
    }
  }
  console.log(`Internal: ${checked} links checked across ${pages.length} pages.`);
}

function collectExternal() {
  const urls = new Map(); // url -> first file it appears in
  const add = (u, file) => {
    if (!urls.has(u)) urls.set(u, file);
  };
  const visit = (node, file) => {
    if (typeof node === 'string' && /^https?:\/\//.test(node)) add(node, file);
    else if (Array.isArray(node)) node.forEach((n) => visit(n, file));
    else if (node && typeof node === 'object') Object.values(node).forEach((n) => visit(n, file));
  };
  const changed = since
    ? new Set(execFileSync('git', ['diff', '--name-only', since, 'HEAD'], { encoding: 'utf8' }).split('\n').filter(Boolean))
    : null;
  const wanted = (f) => !changed || changed.has(f.replaceAll('\\', '/'));
  for (const file of walk('src/data').filter((f) => ['.yaml', '.yml'].includes(extname(f)) && wanted(f))) {
    visit(parse(readFileSync(file, 'utf8')), file);
  }
  for (const file of walk('src').filter((f) => ['.astro', '.ts'].includes(extname(f)) && wanted(f))) {
    for (const [u] of readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s"'`<>)]+/g)) {
      // Skip template literals and map tile URL templates ({z}/{x}/{y}).
      if (!/[{}]/.test(u)) add(u.replace(/[.,;]+$/, ''), file);
    }
  }
  return urls;
}

async function probe(url) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const method of ['HEAD', 'GET']) {
      try {
        const res = await fetch(url, {
          method,
          redirect: 'follow',
          headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/pdf,*/*' },
          signal: AbortSignal.timeout(25_000),
        });
        res.body?.cancel().catch(() => {});
        last = { status: res.status };
        if (res.ok || res.status === 405) return last;
        if (res.headers.get('cf-mitigated') === 'challenge') return { ...last, challenged: true };
        if (method === 'HEAD') continue; // some servers reject HEAD; retry with GET
        if ([404, 410].includes(res.status)) return last;
      } catch (err) {
        last = { error: err.cause?.code ?? err.name ?? String(err) };
        if (last.error === 'ENOTFOUND') return last;
      }
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  return last;
}

async function checkExternal() {
  const urls = collectExternal();
  const list = [...urls.keys()];
  let i = 0;
  let ok = 0;
  const challenged = new Map(); // host -> count
  const worker = async () => {
    while (i < list.length) {
      const url = list[i++];
      const r = await probe(url);
      const where = urls.get(url);
      if (r.status && (r.status < 400 || r.status === 405)) ok++;
      else if (r.challenged) {
        const host = new URL(url).hostname.replace(/^www\./, '');
        challenged.set(host, (challenged.get(host) ?? 0) + 1);
      }
      else if (r.status === 404 || r.status === 410 || r.error === 'ENOTFOUND') fail(`${url} (${r.status ?? r.error}) in ${where}`);
      else warn(`${url} (${r.status ?? r.error}) in ${where} — reachable by browser? check manually`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  for (const [host, n] of [...challenged].sort((a, b) => b[1] - a[1])) {
    warn(`${host}: ${n} URL(s) not checkable (Cloudflare bot challenge) — spot-check in a browser`);
  }
  const skipped = [...challenged.values()].reduce((a, b) => a + b, 0);
  console.log(`External: ${ok}/${list.length} URLs returned OK${skipped ? `, ${skipped} behind a Cloudflare challenge` : ''}.`);
}

if (!args.has('--external-only')) checkInternal();
if (!args.has('--internal-only')) await checkExternal();

console.log(`\n${failures} failure(s), ${warnings} warning(s).`);
process.exit(failures ? 1 : 0);
