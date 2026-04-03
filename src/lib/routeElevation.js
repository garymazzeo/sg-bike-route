const FT_PER_M = 3.28084;

/** Evenly sample coordinates along a LineString (max `maxPoints` vertices). */
export function sampleLineStringCoords(coords, maxPoints) {
  if (!coords?.length) return [];
  if (coords.length <= maxPoints) return coords;
  const out = [];
  const n = maxPoints;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const idx = Math.round(t * (coords.length - 1));
    out.push(coords[idx]);
  }
  return out;
}

/**
 * Min/max elevation and cumulative climb along sampled route (meters → feet).
 * Uses Mapbox terrain DEM via `map.queryTerrainElevation` (needs raster-dem + setTerrain).
 * @returns {null | { minFt: number, maxFt: number, climbFt: number }}
 */
export function summarizeRouteElevationFeet(map, coordinates, maxSamples = 72) {
  if (!map || !coordinates?.length) return null;
  const sampled = sampleLineStringCoords(coordinates, maxSamples);
  const elevationsM = [];
  for (const c of sampled) {
    const lng = c[0];
    const lat = c[1];
    const el = map.queryTerrainElevation([lng, lat], { exaggerated: false });
    if (el != null && Number.isFinite(el)) elevationsM.push(el);
  }
  if (elevationsM.length < 3) return null;

  const minM = Math.min(...elevationsM);
  const maxM = Math.max(...elevationsM);
  let gainM = 0;
  for (let i = 1; i < elevationsM.length; i++) {
    const d = elevationsM[i] - elevationsM[i - 1];
    if (d > 0) gainM += d;
  }

  return {
    minFt: Math.round(minM * FT_PER_M),
    maxFt: Math.round(maxM * FT_PER_M),
    climbFt: Math.round(gainM * FT_PER_M),
  };
}
