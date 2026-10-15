#!/usr/bin/env python3
"""Seed race files from the Secretary of State's certified candidate lists.

Downloads the certified November 3, 2026 candidate lists (Excel) from
https://sos.tn.gov/elections/2026-candidate-lists, groups candidates into
races, and writes one YAML per race to src/data/races/ with empty
why_running / platform / arguments (research_status: pending).

Safety rules:
  * A file that already has research content (research_status: complete, or
    any bio_facts / why_running / platform / arguments) is never overwritten.
    Differences from the certified list are reported as conflicts instead.
  * A pending (seed-only) file is rewritten only if the certified list changed.

Cross-checks U.S. House and Senate candidates against the FEC API when
FEC_API_KEY is set. Writes a report to data-staging/seed-report.md.

Standard library only. Usage:
    python scripts/seed-from-certified-list.py [--dry-run]
"""
from __future__ import annotations

import datetime as dt
import html
import io
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RACES_DIR = ROOT / "src" / "data" / "races"
REPORT = ROOT / "data-staging" / "seed-report.md"
BASE = "https://sos-prod.tnsosgovfiles.com/s3fs-public/document/"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"
PARTIES = {"Republican", "Democratic", "Independent"}

# (file stem, level, id format, office format; None = statewide, single race)
# Levels must match LEVEL_IDS in src/lib/levels.ts.
LISTS = [
    ("Governor", "statewide", "governor", "Governor"),
    ("USSenate", "statewide", "us-senate", "U.S. Senate"),
    ("USHouse", "us_house", "us-house-{:02d}", "U.S. House, District {}"),
    ("TNSenate", "state_senate", "tn-senate-{:02d}", "Tennessee Senate, District {}"),
    ("TNHouse", "state_house", "tn-house-{:03d}", "Tennessee House, District {}"),
]
CONTENT_KEYS = re.compile(r"^\s+(bio_facts|why_running|platform|arguments):", re.M)


def fetch(url: str, headers: dict | None = None) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as res:
        return res.read()


def read_xlsx(data: bytes) -> list[list[str]]:
    """Minimal reader for the first worksheet of an .xlsx file."""
    z = zipfile.ZipFile(io.BytesIO(data))
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        xml = z.read("xl/sharedStrings.xml").decode("utf-8")
        for si in re.findall(r"<si>(.*?)</si>", xml, re.S):
            shared.append(html.unescape("".join(re.findall(r"<t[^>]*>(.*?)</t>", si, re.S))))
    xml = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    rows = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", xml, re.S):
        cells = []
        for attrs, _, body in re.findall(r"<c ([^>]*?)(/>|>(.*?)</c>)", row, re.S):
            v = re.search(r"<v>(.*?)</v>", body or "", re.S)
            t = re.search(r"<t[^>]*>(.*?)</t>", body or "", re.S)
            val = v.group(1) if v else (t.group(1) if t else "")
            if 't="s"' in attrs and v:
                val = shared[int(val)]
            cells.append(html.unescape(val).strip())
        rows.append(cells)
    return rows


def load_certified() -> dict[str, dict]:
    races: dict[str, dict] = {}
    for stem, level, id_fmt, office_fmt in LISTS:
        rows = read_xlsx(fetch(f"{BASE}{stem}_Nov2026.xlsx"))[1:]  # skip header
        for row in rows:
            if not row or not row[0]:
                continue
            m = re.search(r"District (\d+)", row[0])
            district = int(m.group(1)) if m else None
            rid = id_fmt.format(district) if district else id_fmt
            race = races.setdefault(rid, {
                "id": rid,
                "office": office_fmt.format(district) if district else office_fmt,
                "level": level,
                "district": district,
                "source": f"{BASE}{stem}_Nov2026.pdf",
                "candidates": [],
            })
            if len(row) < 4 or row[1] == "No Candidate Qualified":
                continue  # race exists on the list with no qualified candidate
            name, party, city = row[1], row[2], row[3]
            if party not in PARTIES:
                raise SystemExit(f"Unexpected party {party!r} for {name} in {stem}")
            race["candidates"].append({"name": name, "ballot_party": party, "city": city})
    return races


def render(race: dict, today: str) -> str:
    q = lambda s: json.dumps(s, ensure_ascii=False)  # noqa: E731 - JSON strings are valid YAML
    lines = [
        "# Seeded from the Secretary of State's certified candidate list by",
        "# scripts/seed-from-certified-list.py. research_status: pending —",
        "# platforms and arguments not yet compiled.",
        f"id: {race['id']}",
        f"office: {q(race['office'])}",
        f"level: {race['level']}",
        f"district: {race['district'] if race['district'] is not None else 'null'}",
        "research_status: pending",
        f"candidate_list_source: {q(race['source'])}",
    ]
    if not race["candidates"]:
        lines.append("candidates: []  # No candidate qualified")
    else:
        lines.append("candidates:")
        for c in race["candidates"]:
            lines += [
                f"  - name: {q(c['name'])}",
                f"    ballot_party: {c['ballot_party']}",
                f"    city: {q(c['city'])}",
                "    why_running: { text: null, sources: [] }",
                "    platform: []",
                "    arguments: []",
            ]
    lines.append(f"last_verified: {today}")
    return "\n".join(lines) + "\n"


def existing_candidates(text: str) -> list[tuple[str, str]]:
    names = [json.loads(f'"{n}"') for n in re.findall(r'^\s+- name: "((?:[^"\\]|\\.)*)"', text, re.M)]
    parties = re.findall(r"^\s+ballot_party: (\w+)", text, re.M)
    return list(zip(names, parties))


def has_content(text: str) -> bool:
    if re.search(r"^research_status: complete", text, re.M):
        return True
    # Seed output contains the empty forms `platform: []` etc.; anything else is content.
    for m in CONTENT_KEYS.finditer(text):
        rest = text[m.end():].split("\n", 1)[0].strip()
        if rest not in ("[]", "{ text: null, sources: [] }"):
            return True
    return False


def fec_check(races: dict[str, dict]) -> list[str]:
    key = os.environ.get("FEC_API_KEY")
    if not key:
        return ["FEC cross-check skipped: `FEC_API_KEY` is not set."]
    notes = []
    for office in ("S", "H"):
        params = urllib.parse.urlencode({
            "api_key": key, "state": "TN", "office": office, "election_year": 2026,
            "candidate_status": "C", "per_page": 100,
        })
        data = json.loads(fetch(f"https://api.open.fec.gov/v1/candidates/?{params}"))
        fec = {}
        for r in data.get("results", []):
            last = r["name"].split(",")[0].strip().lower()
            dist = int(r["district"]) if office == "H" and r.get("district", "00").isdigit() else None
            fec.setdefault((dist, last), []).append(r["name"])
        for race in races.values():
            if (office == "S") != (race["id"] == "us-senate") or (office == "H" and race["level"] != "us_house"):
                continue
            for c in race["candidates"]:
                last = re.sub(r",? (Jr\.?|Sr\.?|I{2,3}|IV)$", "", c["name"]).split()[-1].strip('"').lower()
                if (race["district"], last) not in fec:
                    notes.append(f"- {race['office']}: **{c['name']}** not matched in FEC 2026 candidate filings")
    return notes or ["FEC cross-check: every federal candidate matched an FEC filing by district and last name."]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    dry = "--dry-run" in sys.argv
    today = dt.date.today().isoformat()
    certified = load_certified()
    created, rewritten, unchanged, conflicts = [], [], [], []

    for rid, race in sorted(certified.items()):
        path = RACES_DIR / f"{rid}.yaml"
        want = [(c["name"], c["ballot_party"]) for c in race["candidates"]]
        if not path.exists():
            created.append(rid)
            if not dry:
                path.write_text(render(race, today), encoding="utf-8", newline="\n")
            continue
        text = path.read_text(encoding="utf-8")
        have = existing_candidates(text)
        strip_date = lambda s: re.sub(r"^last_verified:.*$", "", s, flags=re.M)  # noqa: E731
        if not has_content(text) and strip_date(text) != strip_date(render(race, today)):
            # Seed-only file that is out of date (list or seed format changed): safe to rewrite.
            rewritten.append(rid)
            if not dry:
                path.write_text(render(race, today), encoding="utf-8", newline="\n")
        elif have == want:
            unchanged.append(rid)
        elif has_content(text):
            added = [n for n in want if n not in have]
            removed = [n for n in have if n not in want]
            conflicts.append(f"- `{rid}` has research content; not overwritten. Added on list: {added or 'none'}; "
                             f"missing from list: {removed or 'none'}; order differs: {not added and not removed}")
        else:
            rewritten.append(rid)
            if not dry:
                path.write_text(render(race, today), encoding="utf-8", newline="\n")

    orphans = sorted(p.stem for p in RACES_DIR.glob("*.yaml") if p.stem not in certified)
    no_candidate = sorted(rid for rid, r in certified.items() if not r["candidates"])
    n_cands = sum(len(r["candidates"]) for r in certified.values())

    report = [
        "# Seed report",
        "",
        f"Run: {dt.datetime.now().isoformat(timespec='seconds')}{' (dry run)' if dry else ''}  ",
        "Source: certified candidate lists, https://sos.tn.gov/elections/2026-candidate-lists",
        "",
        f"- Races on the certified lists: **{len(certified)}** ({n_cands} candidates)",
        f"- Created: {len(created)} · Re-seeded (seed-only file out of date): {len(rewritten)} · Unchanged: {len(unchanged)}",
        f"- Conflicts (file has research content and differs from the list): {len(conflicts)}",
        f"- Races with no qualified candidate: {', '.join(no_candidate) or 'none'}",
        f"- Race files not on any certified list: {', '.join(orphans) or 'none'}",
        "",
        "## Conflicts",
        "",
        *(conflicts or ["None."]),
        "",
        "## Federal cross-check",
        "",
        *fec_check(certified),
        "",
        "## Notes",
        "",
        "- The certified lists do not indicate incumbency, so the seed leaves `incumbent` unset; it is filled in during research.",
        "- Party is taken exactly as printed on the list (`Republican`, `Democratic`, `Independent`).",
    ]
    if created or rewritten:
        report += ["", "## Files written", "", *[f"- {r} (new)" for r in created], *[f"- {r} (re-seeded)" for r in rewritten]]
    REPORT.parent.mkdir(exist_ok=True)
    REPORT.write_text("\n".join(report) + "\n", encoding="utf-8", newline="\n")
    print("\n".join(report[4:10]))
    print(f"Report: {REPORT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
