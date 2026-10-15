#!/usr/bin/env node
// Checks that the contact form (src/pages/contact.astro) and its Worker
// (workers/contact/src/index.js) agree on field names, topic values and length
// limits. They deploy separately, so nothing else catches drift between them.
//
// Usage: node scripts/check-contact.mjs   (run from the project root)
import { readFileSync } from 'node:fs';

const page = readFileSync('src/pages/contact.astro', 'utf8');
const worker = readFileSync('workers/contact/src/index.js', 'utf8');

const problems = [];
const sameSet = (what, a, b) => {
  const missing = [...a].filter((x) => !b.has(x));
  const extra = [...b].filter((x) => !a.has(x));
  if (missing.length) problems.push(`${what}: in the form but not the Worker: ${missing.join(', ')}`);
  if (extra.length) problems.push(`${what}: in the Worker but not the form: ${extra.join(', ')}`);
};
const block = (name) => {
  const m = worker.match(new RegExp(String.raw`const ${name} = \{([\s\S]*?)\};`));
  if (!m) throw new Error(`could not find ${name} in the Worker`);
  return m[1];
};

// Form side. The Turnstile widget adds its own field at runtime.
const form = page.match(/<form[\s\S]*?<\/form>/)?.[0] ?? '';
const tags = [...form.matchAll(/<(?:input|textarea|select)\b[^>]*>/g)].map(([tag]) => ({
  name: tag.match(/\sname="([^"]+)"/)?.[1],
  max: tag.match(/\smaxlength="(\d+)"/)?.[1],
}));
const formFields = new Set([...tags.map((t) => t.name).filter(Boolean), 'cf-turnstile-response']);
const formMax = Object.fromEntries(tags.filter((t) => t.name && t.max).map((t) => [t.name, Number(t.max)]));
const topicSelect = form.match(/<select\b[^>]*name="topic"[^>]*>([\s\S]*?)<\/select>/)?.[1] ?? '';
const formTopics = new Set([...topicSelect.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]));

// Worker side.
const workerFields = new Set([...worker.matchAll(/field\('([^']+)'\)/g)].map((m) => m[1]));
const workerTopics = new Set([...block('TOPICS').matchAll(/^\s*(\w+):/gm)].map((m) => m[1]));
const limits = Object.fromEntries([...block('LIMITS').matchAll(/(\w+):\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));

sameSet('field names', formFields, workerFields);
sameSet('topic values', formTopics, workerTopics);
sameSet('length limits', new Set(Object.keys(formMax)), new Set(Object.keys(limits)));
for (const [name, max] of Object.entries(limits)) {
  if (name in formMax && formMax[name] !== max) problems.push(`maxlength for "${name}": form ${formMax[name]}, Worker ${max}`);
}

for (const p of problems) console.error(`FAIL  ${p}`);
console.log(
  `Contact form: ${formFields.size} fields, ${formTopics.size} topics, ${Object.keys(limits).length} limits checked; ${problems.length} problem(s).`,
);
process.exit(problems.length ? 1 : 0);
