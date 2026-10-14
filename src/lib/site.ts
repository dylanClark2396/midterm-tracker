import type { CollectionEntry } from 'astro:content';

export const ELECTION_DATE = new Date('2026-11-03T12:00:00Z');
export const GOVOTETN = 'https://sos.tn.gov/govotetn';
export const REPO_URL = 'https://github.com/dylanClark2396/midterm-tracker';
export const CORRECTION_URL = `${REPO_URL}/issues/new?template=correction.yml`;
export const CONTACT_EMAIL = 'contact@tnelection.org';

/** Prefix an internal path with the configured base path. */
export function url(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const clean = path.replace(/^\//, '');
  if (!clean) return `${base}/`;
  return `${base}/${clean}${clean.endsWith('/') || clean.includes('#') ? '' : '/'}`;
}

export function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

// ---------------------------------------------------------------------------
// Ordering: arguments are shuffled with a fixed seed per item at build time, so
// order never signals priority or origin, and stays stable between visits.

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rand = mulberry32(hash(seed));
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Footnotes: sources are numbered by first appearance on the page and listed in
// a collapsed "Sources" section. Source names never appear next to text.

export interface Source {
  url: string;
  title: string;
  accessed: Date;
}

export class Footnotes {
  readonly list: Source[] = [];
  private byUrl = new Map<string, number>();

  ref(sources: readonly Source[]): number[] {
    const nums = sources.map((s) => {
      let n = this.byUrl.get(s.url);
      if (n === undefined) {
        this.list.push(s);
        n = this.list.length;
        this.byUrl.set(s.url, n);
      }
      return n;
    });
    return [...new Set(nums)].sort((a, b) => a - b);
  }
}

export interface Item {
  text: string;
  refs: number[];
}

// ---------------------------------------------------------------------------
// View models. Built in render order so footnote numbers follow the page.

type Amendment = CollectionEntry<'amendments'>['data'];

export function prepareAmendment(a: Amendment) {
  const notes = new Footnotes();
  const column = (stance: 'yes' | 'no'): Item[] =>
    seededShuffle(
      a.arguments.filter((x) => x.stance === stance),
      `${a.id}:${stance}`,
    ).map((x) => ({ text: x.text, refs: notes.ref(x.sources) }));
  const yes = column('yes');
  const no = column('no');
  return { yes, no, sources: notes.list };
}

type Race = CollectionEntry<'races'>['data'];
type Candidate = Race['candidates'][number];

export function hasProfile(c: Candidate): boolean {
  return c.platform.length > 0 || c.why_running.text !== null || c.arguments.length > 0 || c.bio_facts.length > 0;
}

export function prepareRace(race: Race, categoryOrder: string[]) {
  const notes = new Footnotes();
  const withPlatform = race.candidates.filter((c) => c.platform.length > 0);

  // 1. Compare table (rows = categories at least one candidate addressed).
  const usedCategories = categoryOrder.filter((cat) => withPlatform.some((c) => c.platform.some((p) => p.category === cat)));
  const planks = new Map<Candidate, Map<string, Item>>();
  for (const c of withPlatform) planks.set(c, new Map());
  for (const cat of usedCategories) {
    for (const c of withPlatform) {
      const p = c.platform.find((x) => x.category === cat);
      if (p) planks.get(c)!.set(cat, { text: p.text, refs: notes.ref(p.sources) });
    }
  }

  // 2. Candidate sections, in official candidate-list order.
  const candidates = race.candidates.map((c) => {
    const bio = c.bio_facts.map((b) => ({ text: b.text, refs: notes.ref(b.sources) }));
    const why = c.why_running.text ? { text: c.why_running.text, refs: notes.ref(c.why_running.sources) } : null;
    const platform = categoryOrder
      .filter((cat) => c.platform.some((p) => p.category === cat))
      .map((cat) => ({ category: cat, ...planks.get(c)!.get(cat)! }));
    const column = (stance: 'for' | 'against'): Item[] =>
      seededShuffle(
        c.arguments.filter((x) => x.stance === stance),
        `${race.id}:${c.name}:${stance}`,
      ).map((x) => ({ text: x.text, refs: notes.ref(x.sources) }));
    const forArgs = column('for');
    const againstArgs = column('against');
    return { ...c, bio, why, platformItems: platform, forArgs, againstArgs, planks: planks.get(c) };
  });

  return {
    usedCategories,
    tableCandidates: candidates.filter((c) => c.platform.length > 0),
    noPlatform: candidates.filter((c) => c.platform.length === 0),
    candidates,
    sources: notes.list,
  };
}

export const LEVELS = {
  statewide: 'Statewide',
  us_house: 'U.S. House of Representatives',
  state_senate: 'Tennessee Senate',
  state_house: 'Tennessee House of Representatives',
} as const;
