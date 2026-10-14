// Point-in-polygon lookup over the district GeoJSON in public/maps/.
// Coordinates are [lng, lat]; polygons may have holes (even-odd rule).

type Ring = [number, number][];
type Geometry = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };
export interface DistrictFeature {
  type: 'Feature';
  properties: { d: number };
  geometry: Geometry;
}
export interface DistrictCollection {
  type: 'FeatureCollection';
  features: DistrictFeature[];
}

function inRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lng: number, lat: number, rings: Ring[]): boolean {
  return rings.reduce((inside, ring) => (inRing(lng, lat, ring) ? !inside : inside), false);
}

export function contains(f: DistrictFeature, lng: number, lat: number): boolean {
  const g = f.geometry;
  return g.type === 'Polygon' ? inPolygon(lng, lat, g.coordinates) : g.coordinates.some((p) => inPolygon(lng, lat, p));
}

/** District number containing the point, or null when it's outside every district. */
export function districtAt(fc: DistrictCollection, lng: number, lat: number): number | null {
  return fc.features.find((f) => contains(f, lng, lat))?.properties.d ?? null;
}

/**
 * True when a different district (or the state line) lies within `meters` of the
 * point. The map files are simplified, so answers this close to a line need
 * confirming with the state's lookup.
 */
export function nearLine(fc: DistrictCollection, lng: number, lat: number, meters = 200): boolean {
  const here = districtAt(fc, lng, lat);
  const dLat = meters / 111_320;
  const dLng = dLat / Math.cos((lat * Math.PI) / 180);
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    if (districtAt(fc, lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)) !== here) return true;
  }
  return false;
}
