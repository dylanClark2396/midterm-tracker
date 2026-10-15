import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { blockedTerms, categoryIds, PLATFORM_MAX } from './lib/rules';
import { LEVEL_IDS } from './lib/levels';

const date = z.coerce.date();

const source = z.object({
  url: z.url(),
  title: z.string().min(1),
  accessed: date,
});

// At least one source, always. Unsourced content does not ship.
const sources = z.array(source).min(1, 'needs at least one source URL');

const argumentText = z
  .string()
  .min(20)
  .superRefine((text, ctx) => {
    const hits = blockedTerms(text);
    if (hits.length) {
      ctx.addIssue({
        code: 'custom',
        message: `argument text contains label terms (${hits.join(', ')}); rewrite as a plain claim`,
      });
    }
  });

const argument = <T extends readonly [string, ...string[]]>(stances: T) =>
  z.object({
    stance: z.enum(stances),
    text: argumentText,
    sources,
  });

// A plain sourced statement (bio facts, platform planks, reasons for running).
const sourcedText = z.object({ text: z.string().min(1), sources });

const amendments = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/data/amendments' }),
  schema: z
    .object({
      id: z.string(),
      number: z.number().int().positive(),
      title: z.string(),
      article: z.string(),
      resolutions: z.array(z.object({ name: z.string(), url: z.url() })).min(1),
      ballot_question: z.string().min(1),
      official_summary: z.string().min(1),
      summary_plain: z.string().min(1),
      fiscal_note: z.object({ summary: z.string(), url: z.url() }),
      legislative_votes: z
        .array(
          z.object({
            resolution: z.string(),
            chamber: z.enum(['Senate', 'House']),
            date,
            yes: z.number().int().nonnegative(),
            no: z.number().int().nonnegative(),
            present_not_voting: z.number().int().nonnegative().default(0),
            url: z.url(),
          }),
        )
        .min(1),
      official_source: z.url().refine((u) => new URL(u).hostname.endsWith('.gov'), 'official source must be a .gov URL'),
      arguments: z.array(argument(['yes', 'no'] as const)),
      last_verified: date,
    })
    .superRefine((a, ctx) => {
      for (const url of [a.fiscal_note.url, ...a.resolutions.map((r) => r.url), ...a.legislative_votes.map((v) => v.url)]) {
        const host = new URL(url).hostname;
        if (!host.endsWith('.gov') && !host.endsWith('tnsosfiles.com')) {
          ctx.addIssue({ code: 'custom', message: `official fact must come from a government source: ${url}` });
        }
      }
    }),
});

const candidate = z.object({
  name: z.string(),
  // As printed on the official ballot. Shown as a plain fact, never on arguments.
  ballot_party: z.enum(['Republican', 'Democratic', 'Independent']),
  city: z.string().optional(),
  incumbent: z.boolean().optional(),
  website: z.url().nullable().default(null),
  bio_facts: z.array(sourcedText).default([]),
  // null text = "No stated reason found" (with the race's last_verified date).
  why_running: z
    .object({ text: z.string().nullable(), sources: z.array(source) })
    .refine((w) => w.text === null || w.sources.length > 0, 'why_running needs a source from the candidate')
    .default({ text: null, sources: [] }),
  platform: z
    .array(sourcedText.extend({ category: z.enum(categoryIds as [string, ...string[]]) }))
    .max(PLATFORM_MAX, `at most ${PLATFORM_MAX} planks per candidate`)
    .refine((p) => new Set(p.map((x) => x.category)).size === p.length, 'one plank per category')
    .default([]),
  arguments: z.array(argument(['for', 'against'] as const)).default([]),
});

const races = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/data/races' }),
  schema: z.object({
    id: z.string(),
    office: z.string(),
    level: z.enum(LEVEL_IDS),
    district: z.number().int().positive().nullable(),
    // complete = platforms and arguments researched; pending = official candidate list only.
    research_status: z.enum(['complete', 'pending']),
    candidate_list_source: z.url(),
    // Empty when no candidate qualified for the ballot.
    candidates: z.array(candidate),
    last_verified: date,
  }),
});

export const collections = { amendments, races };
