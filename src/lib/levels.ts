// Race levels: the one list the schema, pages and browser code share. Keep this
// file free of Astro and Node imports so the district finder can use it too.
// The seed script (scripts/seed-from-certified-list.py) keeps its own copy in LISTS.

export const LEVEL_IDS = ['statewide', 'us_house', 'state_senate', 'state_house'] as const;
export type Level = (typeof LEVEL_IDS)[number];

/** Levels elected by district, in display order (U.S. House, TN Senate, TN House). */
export const DISTRICT_LEVELS = ['us_house', 'state_senate', 'state_house'] as const satisfies readonly Level[];
export type DistrictLevel = (typeof DISTRICT_LEVELS)[number];
