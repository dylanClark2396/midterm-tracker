#!/usr/bin/env node
// Checks the agent guides: every relative markdown link in every CLAUDE.md must
// point to a file or folder that exists. External links and #anchors are skipped.
//
// Usage: node scripts/check-docs.mjs   (run from the project root)
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const SKIP = new Set(['node_modules', 'dist', '.git', '.astro', '.wrangler']);

const findGuides = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : findGuides(p);
    return e.name === 'CLAUDE.md' ? [p] : [];
  });

let broken = 0;
let checked = 0;
const guides = findGuides('.');
for (const guide of guides) {
  // Ignore fenced and inline code so examples aren't treated as links.
  const text = readFileSync(guide, 'utf8').replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const [, target] of text.matchAll(/\[(?:[^[\]]|\[[^\]]*\])*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    checked++;
    const path = decodeURIComponent(target.split('#')[0]);
    if (!existsSync(resolve(dirname(guide), path))) {
      broken++;
      console.error(`BROKEN  ${relative('.', guide)} -> ${target}`);
    }
  }
}

console.log(`${checked} relative link(s) checked across ${guides.length} CLAUDE.md file(s); ${broken} broken.`);
process.exit(broken ? 1 : 0);
