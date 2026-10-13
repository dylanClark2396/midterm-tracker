// Editorial rules shared by the content schema and the CI scripts.
import { readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

// Resolved from the project root (builds and CI scripts run there), since this
// module is bundled into a different directory at build time.
const root = pathToFileURL(join(process.cwd(), 'src', 'data') + sep);

export interface Category {
  id: string;
  label: string;
}

export const categories: Category[] = parse(readFileSync(new URL('categories.yaml', root), 'utf8'));
export const categoryIds = categories.map((c) => c.id);

const blocklist: string[] = parse(readFileSync(new URL('config/blocklist.yaml', root), 'utf8')).terms;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blockPatterns = blocklist.map((term) => {
  const wildcard = term.endsWith('*');
  const body = escape(wildcard ? term.slice(0, -1) : term).replace(/\s+/g, String.raw`\s+`);
  return { term, re: new RegExp(String.raw`\b${body}` + (wildcard ? String.raw`\w*` : String.raw`\b`), 'i') };
});

/** Returns the blocklisted terms found in `text`, if any. */
export function blockedTerms(text: string): string[] {
  return blockPatterns.filter(({ re }) => re.test(text)).map(({ term }) => term);
}

export const PLATFORM_MAX = 8;
