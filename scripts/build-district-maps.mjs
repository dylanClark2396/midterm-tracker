#!/usr/bin/env node
// Rebuild the district boundary files used by the map on /districts/.
//
//  - U.S. House: the plan adopted May 7, 2026 (HB 7003), from the Comptroller of
//    the Treasury. The download sits behind a click-through disclaimer, which
//    just sets a cookie.
//  - Tennessee Senate and House: the 2022 plans (upheld December 2025), from the
//    Census Bureau's 2024 TIGER/Line files (full detail; the cartographic
//    boundary files are pre-generalized and misplace more addresses).
//
// Writes public/maps/{us-house,tn-senate,tn-house}.json: GeoJSON with one
// property, `d` (district number). Shapes are simplified to keep the download
// small, so lookups within ~100 m of a boundary can be off. The page checks
// 200 m around each lookup and, if a line is that close, says to confirm with
// the state's voter lookup (that radius caught every mismatch in testing).
//
// Usage: node scripts/build-district-maps.mjs   (needs network and npx)
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const MAPSHAPER = 'mapshaper@0.7.86';
const OUT = 'public/maps';

const layers = [
  {
    name: 'us-house',
    url: 'https://comptroller.tn.gov/content/dam/cot/pa/documents/district-maps/congress-districts/NewCongressional26.zip',
    headers: { cookie: 'disclaimer--2096581727=true' },
    district: 'DISTRICT',
    keep: '8%',
  },
  {
    name: 'tn-senate',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/SLDU/tl_2024_47_sldu.zip',
    district: '+SLDUST',
    keep: '6%',
  },
  {
    name: 'tn-house',
    url: 'https://www2.census.gov/geo/tiger/TIGER2024/SLDL/tl_2024_47_sldl.zip',
    district: '+SLDLST',
    keep: '6%',
  },
];

const work = mkdtempSync(join(tmpdir(), 'district-maps-'));
mkdirSync(OUT, { recursive: true });
try {
  for (const layer of layers) {
    const res = await fetch(layer.url, { headers: { 'user-agent': UA, ...layer.headers } });
    if (!res.ok) throw new Error(`${layer.url}: HTTP ${res.status}`);
    const zip = join(work, `${layer.name}.zip`);
    writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
    execFileSync(
      'npx',
      [
        '--yes',
        MAPSHAPER,
        zip,
        '-proj', 'wgs84',
        '-each', `"d=${layer.district}"`,
        '-filter-fields', 'd',
        '-simplify', layer.keep, 'keep-shapes',
        '-o', join(OUT, `${layer.name}.json`), 'format=geojson', 'precision=0.00001', 'force',
      ],
      { stdio: 'inherit', shell: true },
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
