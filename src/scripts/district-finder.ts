// Map-based district lookup for /districts/. Everything runs in the browser:
// the address goes to the Census geocoder (JSONP, since it sends no CORS
// headers) and the resulting point is matched against public/maps/*.json.
import L from 'leaflet';
import { districtAt, nearLine, type DistrictCollection } from '../lib/geo';

type Level = 'us_house' | 'state_senate' | 'state_house';
type RaceIndex = Record<Level, Record<string, { href: string; candidates: number }>>;

const LAYERS: { level: Level; file: string; office: string }[] = [
  { level: 'us_house', file: 'us-house.json', office: 'U.S. House' },
  { level: 'state_senate', file: 'tn-senate.json', office: 'Tennessee Senate' },
  { level: 'state_house', file: 'tn-house.json', office: 'Tennessee House' },
];
const TN_BOUNDS = L.latLngBounds([34.98, -90.31], [36.68, -81.65]);
const VOTER_LOOKUP = 'https://tnmap.tn.gov/voterlookup/';
const GEOCODER = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress';
// OpenStreetMap's standard tiles: free, no key, attribution required.
const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

interface GeocodeMatch {
  matchedAddress: string;
  coordinates: { x: number; y: number };
  addressComponents: { state: string };
}

let jsonpCount = 0;
function geocode(address: string): Promise<GeocodeMatch[]> {
  return new Promise((resolve, reject) => {
    const cb = `__tnGeocode${++jsonpCount}`;
    const script = document.createElement('script');
    const cleanup = () => {
      clearTimeout(timer);
      script.remove();
      delete (window as any)[cb];
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, 15_000);
    (window as any)[cb] = (data: { result?: { addressMatches?: GeocodeMatch[] } }) => {
      cleanup();
      resolve(data.result?.addressMatches ?? []);
    };
    const params = new URLSearchParams({ address, benchmark: 'Public_AR_Current', format: 'jsonp', callback: cb });
    script.src = `${GEOCODER}?${params}`;
    script.onerror = () => {
      cleanup();
      reject(new Error('network'));
    };
    document.head.append(script);
  });
}

export function initDistrictFinder(root: HTMLElement) {
  const races: RaceIndex = JSON.parse(root.dataset.races!);
  const mapsBase = root.dataset.maps!;
  const form = root.querySelector<HTMLFormElement>('.finder-search')!;
  const input = form.querySelector<HTMLInputElement>('input[name="address"]')!;
  const status = form.querySelector<HTMLElement>('.finder-status')!;
  const locate = form.querySelector<HTMLButtonElement>('[data-locate]')!;
  const results = root.querySelector<HTMLElement>('[data-results]')!;
  const statewide = document.querySelector<HTMLTemplateElement>('#statewide-template')!.innerHTML;

  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => css.getPropertyValue(name).trim();

  const map = L.map(root.querySelector<HTMLElement>('.finder-map')!, {
    maxBounds: TN_BOUNDS.pad(0.5),
    minZoom: 6,
    zoomSnap: 0.25,
    scrollWheelZoom: false, // handled below so plain scrolling still moves the page
  }).fitBounds(TN_BOUNDS);
  L.tileLayer(TILES, {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  // Leaflet's default prefix carries a flag; this guide shows no political symbols.
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');

  // A plain scroll moves the page; Ctrl/Shift/⌘ + scroll zooms around the cursor.
  // (Trackpad pinch arrives as Ctrl + wheel, so it zooms too.)
  const container = map.getContainer();
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const hint = L.DomUtil.create('div', 'finder-map-hint', container);
  hint.textContent = isMac ? 'Hold ⌘ or Shift and scroll to zoom' : 'Hold Ctrl or Shift and scroll to zoom';
  hint.setAttribute('aria-hidden', 'true');
  let hintTimer: ReturnType<typeof setTimeout>;
  let wheelZoom = 0;
  container.addEventListener(
    'wheel',
    (e) => {
      if (!(e.ctrlKey || e.shiftKey || e.metaKey)) {
        hint.classList.add('shown');
        clearTimeout(hintTimer);
        hintTimer = setTimeout(() => hint.classList.remove('shown'), 1500);
        return;
      }
      e.preventDefault(); // stop the browser's own Ctrl+scroll page zoom
      hint.classList.remove('shown');
      // Shift+wheel scrolls sideways in most browsers, so the motion may be in deltaX.
      const px = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
      wheelZoom -= px / 200; // one mouse notch (~100px) = half a zoom level
      const step = Math.trunc(wheelZoom / 0.25) * 0.25;
      if (!step) return;
      wheelZoom -= step;
      // No animation: Leaflet drops zoom requests that arrive mid-animation.
      map.setZoomAround(map.mouseEventToContainerPoint(e), map.getZoom() + step, { animate: false });
    },
    { passive: false },
  );

  const baseStyle = (): L.PathOptions => ({ color: color('--ink'), weight: 1.2, opacity: 0.55, fillOpacity: 0 });
  const pickedStyle = (): L.PathOptions => ({ color: color('--accent'), weight: 3, opacity: 1, fillColor: color('--accent'), fillOpacity: 0.15 });

  const data = {} as Record<Level, DistrictCollection>;
  const overlays = {} as Record<Level, L.GeoJSON>;
  let shown = (root.querySelector<HTMLInputElement>('input[name="layer"]:checked')?.value ?? 'state_house') as Level;
  let marker: L.CircleMarker | null = null;
  let picked: Partial<Record<Level, number | null>> = {};

  const restyle = () => {
    for (const { level } of LAYERS) {
      overlays[level]?.eachLayer((l) => {
        const f = (l as L.GeoJSON).feature as GeoJSON.Feature<GeoJSON.Geometry, { d: number }>;
        (l as L.Path).setStyle(f.properties.d === picked[level] ? pickedStyle() : baseStyle());
      });
    }
  };

  const showLayer = (level: Level) => {
    shown = level;
    for (const { level: l } of LAYERS) {
      if (!overlays[l]) continue;
      if (l === level) overlays[l].addTo(map);
      else overlays[l].remove();
    }
    marker?.bringToFront();
  };

  const loaded = Promise.all(
    LAYERS.map(async ({ level, file, office }) => {
      const res = await fetch(`${mapsBase}${file}`);
      if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
      data[level] = await res.json();
      overlays[level] = L.geoJSON(data[level] as any, {
        style: baseStyle,
        onEachFeature: (f, layer) => layer.bindTooltip(`${office} District ${f.properties.d}`, { sticky: true }),
      });
    }),
  ).then(() => {
    showLayer(shown);
    restyle();
  });
  loaded.catch(() => {
    results.innerHTML = `<p>The district map couldn't load. Use the <a href="${VOTER_LOOKUP}">state's voter lookup</a> to find your districts.</p>`;
  });

  root.querySelectorAll<HTMLInputElement>('input[name="layer"]').forEach((r) =>
    r.addEventListener('change', () => r.checked && showLayer(r.value as Level)),
  );

  const render = (lat: number, lng: number, label: string | null) => {
    picked = Object.fromEntries(LAYERS.map(({ level }) => [level, districtAt(data[level], lng, lat)]));
    restyle();
    marker?.remove();
    marker = L.circleMarker([lat, lng], {
      radius: 7,
      color: color('--bg'),
      weight: 2,
      fillColor: color('--ink'),
      fillOpacity: 1,
    }).addTo(map);

    if (LAYERS.every(({ level }) => picked[level] === null)) {
      results.innerHTML = `<p>That spot is outside Tennessee. Search an address or tap somewhere in the state.</p>`;
      return;
    }

    const near = LAYERS.some(({ level }) => nearLine(data[level], lng, lat));
    const items = LAYERS.map(({ level, office }) => {
      const d = picked[level];
      if (d == null) return `<li><span class="office">${office}</span>No district found at this spot.</li>`;
      const race = races[level][d];
      if (!race && level === 'state_senate') {
        return `<li><span class="office">${office}</span><span class="district">District ${d}</span> — not on the ballot this year. Even-numbered Senate districts are next elected in 2028.</li>`;
      }
      if (!race) return `<li><span class="office">${office}</span><span class="district">District ${d}</span></li>`;
      const count = race.candidates === 0 ? 'no candidate qualified' : `${race.candidates} ${race.candidates === 1 ? 'candidate' : 'candidates'}`;
      return `<li><span class="office">${office}</span><a class="district" href="${race.href}">District ${d}</a> <span class="small muted">(${count})</span></li>`;
    }).join('');

    results.innerHTML = [
      label ? `<p class="small muted">Showing races for <strong>${esc(label)}</strong>.</p>` : '',
      `<ul>${items}</ul>`,
      near
        ? `<p class="notice">This spot is close to a district line, and the lines on this map are simplified. Confirm your districts with the <a href="${VOTER_LOOKUP}">state's voter lookup</a>.</p>`
        : '',
      statewide,
    ].join('');
    // On narrow screens the results sit below the map; bring them into view.
    if (!matchMedia('(min-width: 900px)').matches) results.closest('section')!.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const pick = async (lat: number, lng: number, label: string | null, zoom?: number) => {
    await loaded;
    if (zoom) map.setView([lat, lng], Math.max(map.getZoom(), zoom));
    render(lat, lng, label);
  };

  map.on('click', (e: L.LeafletMouseEvent) => {
    status.textContent = '';
    pick(e.latlng.lat, e.latlng.lng, null);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let address = input.value.trim();
    if (!address) return;
    // The geocoder searches the whole country; keep it to Tennessee.
    if (!/\b(TN|Tenn\.?|Tennessee)\b/i.test(address)) address += ', TN';
    const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    button.disabled = true;
    status.textContent = 'Searching…';
    try {
      const match = (await geocode(address)).find((m) => m.addressComponents.state === 'TN');
      if (!match) {
        status.textContent = "Couldn't find that address in Tennessee. Try adding the city or ZIP code, or tap the map instead.";
        return;
      }
      status.textContent = '';
      await pick(match.coordinates.y, match.coordinates.x, match.matchedAddress, 14);
    } catch {
      status.textContent = "The address search isn't responding right now. Tap the map or use your location instead.";
    } finally {
      button.disabled = false;
    }
  });

  if (!('geolocation' in navigator)) locate.hidden = true;
  locate.addEventListener('click', () => {
    locate.disabled = true;
    status.textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        locate.disabled = false;
        status.textContent = '';
        await pick(pos.coords.latitude, pos.coords.longitude, 'your current location', 14);
      },
      () => {
        locate.disabled = false;
        status.textContent = "Couldn't get your location. Search your address or tap the map instead.";
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}
