/** Haversine distance in km (good enough for ordering stops). */
export function haversineKm(lon1, lat1, lon2, lat2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray casting; ring is open or closed ([first] repeated at end). */
export function pointInPolygon(lng, lat, ring) {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  const n = ring.length;
  const closed =
    ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1] ? n - 1 : n;
  for (let i = 0, j = closed - 1; i < closed; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect =
      yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** @param {Array<{lon:number,lat:number,props?:object}>} points */
export function nearestNeighborOrder(points) {
  if (points.length <= 1) return [...points];
  const unvisited = new Set(points.map((_, i) => i));
  const orderIdx = [0];
  unvisited.delete(0);
  while (unvisited.size) {
    const last = orderIdx[orderIdx.length - 1];
    const a = points[last];
    let bestJ = null;
    let bestD = Infinity;
    for (const j of unvisited) {
      const b = points[j];
      const d = haversineKm(a.lon, a.lat, b.lon, b.lat);
      if (d < bestD) {
        bestD = d;
        bestJ = j;
      }
    }
    orderIdx.push(bestJ);
    unvisited.delete(bestJ);
  }
  return orderIdx.map((i) => points[i]);
}

/** Greedy nearest-neighbor starting at a fixed seed (e.g. a library), visiting every point in pool once. */
export function nearestNeighborFromSeed(seed, pool) {
  if (!pool.length) return [seed];
  const remaining = [...pool];
  const order = [seed];
  while (remaining.length) {
    const last = order[order.length - 1];
    let bestI = 0;
    let bestD = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineKm(last.lon, last.lat, remaining[i].lon, remaining[i].lat);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    order.push(remaining.splice(bestI, 1)[0]);
  }
  return order;
}

/**
 * Order lawn stops (nearest-neighbor), optionally inserting an AADL branch.
 * @param {'none'|'start'|'end'|'mid'} libraryMode
 * @param library null | { lat: number, lon: number, name: string }
 */
export function orderStopsWithLibrary(inside, library, libraryMode) {
  if (!library || libraryMode === 'none') {
    return nearestNeighborOrder(inside);
  }
  const libStop = {
    lat: library.lat,
    lon: library.lon,
    label: library.name,
  };
  if (libraryMode === 'end') {
    return [...nearestNeighborOrder(inside), libStop];
  }
  if (libraryMode === 'start') {
    return nearestNeighborFromSeed(libStop, inside);
  }
  if (libraryMode === 'mid') {
    const mid = nearestNeighborOrder(inside);
    const idx = Math.max(0, Math.floor(mid.length / 2));
    const out = [...mid];
    out.splice(idx, 0, libStop);
    return out;
  }
  return nearestNeighborOrder(inside);
}

/** Split [A,B,C,...,Z] into segments of at most maxPoints coords; segments overlap at one endpoint. */
export function chunkWaypointSegments(coords, maxPoints = 25) {
  if (coords.length < 2) return [];
  const segments = [];
  let i = 0;
  while (i < coords.length - 1) {
    const end = Math.min(i + maxPoints, coords.length);
    segments.push(coords.slice(i, end));
    if (end === coords.length) break;
    i = end - 1;
  }
  return segments;
}

export function mergeLineStringGeometries(geometries) {
  if (!geometries.length) return null;
  const coords = [];
  for (let g = 0; g < geometries.length; g++) {
    const c = geometries[g].coordinates;
    if (g === 0) coords.push(...c);
    else if (c.length) coords.push(...c.slice(1));
  }
  return { type: 'LineString', coordinates: coords };
}
