import { useEffect, useRef, useState, useCallback } from 'preact/hooks';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { RotateCw, Route, Trash2, MapPin, Pentagon, Download } from 'lucide-preact';
import {
  pointInPolygon,
  orderStopsWithLibrary,
  chunkWaypointSegments,
  mergeLineStringGeometries,
} from '../lib/geo.js';
import { buildGpx, downloadTextFile, stripHtml } from '../lib/gpx.js';
import { formatMilesFromMeters, formatDurationHm } from '../lib/formatImperial.js';
import { summarizeRouteElevationFeet } from '../lib/routeElevation.js';
import aadlData from '../data/aadl-libraries.json';

const DEFAULT_CENTER = [-83.77, 42.26];
const DEFAULT_ZOOM = 11;
const MAX_WAYPOINTS_PER_REQUEST = 25;
const MAX_STOPS_FOR_ROUTE = 500;

const DATA_URL =
  import.meta.env.PUBLIC_DATA_URL || '/data/SummerGame2025.json';

function toNum(x) {
  const n = typeof x === 'number' ? x : parseFloat(x);
  return Number.isFinite(n) ? n : NaN;
}

function homecodesToStops(homecodes) {
  const stops = [];
  for (const item of homecodes) {
    const lat = toNum(item.lat);
    const lon = toNum(item.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    stops.push({
      lat,
      lon,
      label: item.homecode || String(item.code_id || ''),
    });
  }
  return stops;
}

function stopsToFeatureCollection(stops) {
  return {
    type: 'FeatureCollection',
    features: stops.map((s, i) => ({
      type: 'Feature',
      id: i,
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { label: s.label, i },
    })),
  };
}

function ensureClosedRing(ring) {
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, [first[0], first[1]]];
}

function inclusionFeature(ring, closed) {
  if (!ring.length) {
    return { type: 'FeatureCollection', features: [] };
  }
  if (closed) {
    const closedRing = ensureClosedRing(ring);
    if (!closedRing) {
      return { type: 'FeatureCollection', features: [] };
    }
    return {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [closedRing] },
      properties: {},
    };
  }
  return {
    type: 'Feature',
    geometry: { type: 'LineString', coordinates: ring },
    properties: {},
  };
}

function setInclusionSourceData(map, ring, closed) {
  if (!map?.getSource('inclusion')) return;
  const feat = inclusionFeature(ring, closed);
  const data =
    feat.type === 'FeatureCollection'
      ? feat
      : { type: 'FeatureCollection', features: [feat] };
  map.getSource('inclusion').setData(data);
}

function countStopsInRing(stops, ring) {
  if (ring.length < 3) return 0;
  const closed = ensureClosedRing(ring);
  if (!closed) return 0;
  let n = 0;
  for (const s of stops) {
    if (pointInPolygon(s.lon, s.lat, closed)) n += 1;
  }
  return n;
}

const LIBRARY_FC = {
  type: 'FeatureCollection',
  features: aadlData.libraries.map((lib) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lib.lon, lib.lat] },
    properties: {
      id: lib.id,
      name: lib.name,
      address: lib.address,
    },
  })),
};

export default function MapboxMap() {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const drawingRef = useRef(false);
  const ringRef = useRef([]);
  const stopsRef = useRef([]);
  const polygonClosedRef = useRef(false);
  const routeGenRef = useRef(0);

  const [loadingData, setLoadingData] = useState(true);
  const [routeLoading, setRouteLoading] = useState(false);
  const [error, setError] = useState(null);
  const [polygonClosed, setPolygonClosed] = useState(false);
  const [stopsInArea, setStopsInArea] = useState(null);
  const [routeSummary, setRouteSummary] = useState(null);
  const [libraryId, setLibraryId] = useState('');
  const [libraryRole, setLibraryRole] = useState('none');
  const [routeGpx, setRouteGpx] = useState(null);

  const updateStopsInAreaCount = useCallback(() => {
    if (!polygonClosedRef.current || ringRef.current.length < 3) {
      setStopsInArea(null);
      return;
    }
    setStopsInArea(countStopsInRing(stopsRef.current, ringRef.current));
  }, []);

  const loadPointsData = useCallback(async () => {
    setLoadingData(true);
    setError(null);
    try {
      const response = await fetch(DATA_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      const homecodes = json.homecodes || [];
      const stops = homecodesToStops(homecodes);
      stopsRef.current = stops;
      const map = mapRef.current;
      if (map?.getSource('points')) {
        map.getSource('points').setData(stopsToFeatureCollection(stops));
        const bounds = new mapboxgl.LngLatBounds();
        for (const s of stops) bounds.extend([s.lon, s.lat]);
        if (!stops.length) {
          map.setCenter(DEFAULT_CENTER);
          map.setZoom(DEFAULT_ZOOM);
        } else {
          map.fitBounds(bounds, { padding: 48, maxZoom: 14 });
        }
      }
      updateStopsInAreaCount();
    } catch (err) {
      console.error(err);
      setError('Could not load location data.');
    } finally {
      setLoadingData(false);
    }
  }, [updateStopsInAreaCount]);

  useEffect(() => {
    const token = import.meta.env.PUBLIC_MAPBOX_TOKEN;
    if (!token) {
      setError('Missing PUBLIC_MAPBOX_TOKEN. Add it to .env');
      setLoadingData(false);
      return;
    }
    mapboxgl.accessToken = token;

    const map = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: DEFAULT_CENTER,
      zoom: DEFAULT_ZOOM,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    map.on('load', () => {
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512,
          maxzoom: 14,
        });
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1 });
      }

      map.addSource('points', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'points-layer',
        type: 'circle',
        source: 'points',
        paint: {
          'circle-radius': 5,
          'circle-color': '#e53935',
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
      });

      map.addSource('libraries', {
        type: 'geojson',
        data: LIBRARY_FC,
      });
      map.addLayer({
        id: 'libraries-layer',
        type: 'circle',
        source: 'libraries',
        paint: {
          'circle-radius': 9,
          'circle-color': '#6a1b9a',
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      });

      map.addSource('inclusion', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'inclusion-draft-line',
        type: 'line',
        source: 'inclusion',
        filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#1565c0',
          'line-width': 2,
          'line-dasharray': [2, 1],
        },
      });
      map.addLayer({
        id: 'inclusion-fill',
        type: 'fill',
        source: 'inclusion',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: {
          'fill-color': '#1976d2',
          'fill-opacity': 0.12,
        },
      });
      map.addLayer({
        id: 'inclusion-outline',
        type: 'line',
        source: 'inclusion',
        filter: ['==', ['geometry-type'], 'Polygon'],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#1565c0',
          'line-width': 2,
        },
      });

      map.addSource('route', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      map.addLayer({
        id: 'route-line',
        type: 'line',
        source: 'route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': '#3887be',
          'line-width': 5,
          'line-opacity': 0.85,
        },
      });

      map.on('click', 'points-layer', (e) => {
        if (drawingRef.current) return;
        const f = e.features?.[0];
        if (!f) return;
        const label = f.properties?.label || '';
        new mapboxgl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(`<div class="map-popup"><strong>${label}</strong></div>`)
          .addTo(map);
      });

      map.on('click', 'libraries-layer', (e) => {
        if (drawingRef.current) return;
        const f = e.features?.[0];
        if (!f) return;
        const name = f.properties?.name || '';
        const addr = f.properties?.address || '';
        new mapboxgl.Popup({ closeButton: true })
          .setLngLat(e.lngLat)
          .setHTML(
            `<div class="map-popup"><strong>${name}</strong><br/><span style="font-size:12px">${addr}</span></div>`
          )
          .addTo(map);
      });

      map.on('click', (e) => {
        if (!drawingRef.current) return;
        ringRef.current.push([e.lngLat.lng, e.lngLat.lat]);
        polygonClosedRef.current = false;
        setPolygonClosed(false);
        setInclusionSourceData(map, ringRef.current, false);
      });

      map.on('mouseenter', 'points-layer', () => {
        if (drawingRef.current) map.getCanvas().style.cursor = 'crosshair';
        else map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'points-layer', () => {
        map.getCanvas().style.cursor = drawingRef.current ? 'crosshair' : '';
      });
      map.on('mouseenter', 'libraries-layer', () => {
        if (drawingRef.current) map.getCanvas().style.cursor = 'crosshair';
        else map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'libraries-layer', () => {
        map.getCanvas().style.cursor = drawingRef.current ? 'crosshair' : '';
      });

      loadPointsData();
    });

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [loadPointsData]);

  const startDrawing = () => {
    drawingRef.current = true;
    polygonClosedRef.current = false;
    ringRef.current = [];
    setPolygonClosed(false);
    setStopsInArea(null);
    setRouteSummary(null);
    setRouteGpx(null);
    const map = mapRef.current;
    if (map) {
      setInclusionSourceData(map, [], false);
      map.getCanvas().style.cursor = 'crosshair';
    }
  };

  const closePolygon = () => {
    const ring = ringRef.current;
    if (ring.length < 3) {
      setError('Need at least three corners for an area.');
      return;
    }
    setError(null);
    drawingRef.current = false;
    polygonClosedRef.current = true;
    setPolygonClosed(true);
    const map = mapRef.current;
    if (map) {
      map.getCanvas().style.cursor = '';
      setInclusionSourceData(map, ringRef.current, true);
    }
    setStopsInArea(countStopsInRing(stopsRef.current, ringRef.current));
  };

  const clearPolygon = () => {
    drawingRef.current = false;
    polygonClosedRef.current = false;
    ringRef.current = [];
    setPolygonClosed(false);
    setStopsInArea(null);
    setRouteSummary(null);
    setRouteGpx(null);
    const map = mapRef.current;
    if (map) {
      setInclusionSourceData(map, [], false);
      if (map.getSource('route')) {
        map.getSource('route').setData({ type: 'FeatureCollection', features: [] });
      }
      map.getCanvas().style.cursor = '';
    }
  };

  const calculateRoute = async () => {
    const token = mapboxgl.accessToken;
    if (!token) return;

    if (!polygonClosedRef.current || ringRef.current.length < 3) {
      setError('Close an inclusion area first (draw, then “Close area”).');
      return;
    }
    const closedRing = ensureClosedRing(ringRef.current);
    if (!closedRing) {
      setError('Invalid polygon.');
      return;
    }

    const all = stopsRef.current;
    const inside = all.filter((s) => pointInPolygon(s.lon, s.lat, closedRing));

    const hasLibrary = Boolean(libraryId && libraryRole !== 'none');
    const selectedLib = hasLibrary
      ? aadlData.libraries.find((l) => l.id === libraryId)
      : null;
    if (hasLibrary && !selectedLib) {
      setError('Choose a library branch.');
      return;
    }

    const minInside = hasLibrary ? 1 : 2;
    if (inside.length < minInside) {
      setError(
        hasLibrary
          ? 'Need at least one lawn stop in the area when a library is included.'
          : 'Need at least two stops inside the area.'
      );
      return;
    }
    if (inside.length > MAX_STOPS_FOR_ROUTE) {
      setError(
        `Too many stops (${inside.length}). Draw a smaller area (max ${MAX_STOPS_FOR_ROUTE} stops).`
      );
      return;
    }

    setRouteLoading(true);
    setError(null);
    setRouteSummary(null);
    setRouteGpx(null);

    try {
      const mode = hasLibrary ? libraryRole : 'none';
      const ordered = orderStopsWithLibrary(inside, selectedLib || null, mode);
      const coords = ordered.map((s) => [s.lon, s.lat]);
      const segments = chunkWaypointSegments(coords, MAX_WAYPOINTS_PER_REQUEST);
      const geometries = [];
      let totalM = 0;
      let totalS = 0;

      for (const segment of segments) {
        const path = segment.map(([lng, lat]) => `${lng},${lat}`).join(';');
        const url = `https://api.mapbox.com/directions/v5/mapbox/cycling/${path}?geometries=geojson&overview=full&access_token=${token}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data.routes?.[0]) {
          const msg = data.message || 'No route returned';
          throw new Error(msg);
        }
        const route = data.routes[0];
        geometries.push(route.geometry);
        totalM += route.distance ?? 0;
        totalS += route.duration ?? 0;
      }

      const merged = mergeLineStringGeometries(geometries);
      const map = mapRef.current;
      const routeGen = ++routeGenRef.current;
      if (map?.getSource('route')) {
        map.getSource('route').setData({
          type: 'Feature',
          geometry: merged,
          properties: {},
        });
        const coordsArr = merged.coordinates;
        if (coordsArr?.length) {
          const b = new mapboxgl.LngLatBounds();
          for (const c of coordsArr) b.extend(c);
          map.fitBounds(b, { padding: 60, maxZoom: 15 });
        }
      }

      setRouteSummary({
        distanceLabel: formatMilesFromMeters(totalM),
        durationLabel: formatDurationHm(totalS),
        stops: inside.length,
        libraryNote: hasLibrary ? selectedLib?.name : null,
        visitOrder: ordered.length,
        elevation: null,
        _gen: routeGen,
      });
      setRouteGpx({
        coordinates: merged.coordinates,
        waypoints: ordered.map((s) => ({
          lat: s.lat,
          lon: s.lon,
          name: stripHtml(s.label),
        })),
      });

      if (map && merged?.coordinates?.length) {
        const tryElevation = () => {
          if (routeGenRef.current !== routeGen || !mapRef.current) return;
          setRouteSummary((prev) => {
            if (!prev || prev._gen !== routeGen) return prev;
            if (prev.elevation) return prev;
            const elev = summarizeRouteElevationFeet(map, merged.coordinates);
            if (!elev) return prev;
            return { ...prev, elevation: elev };
          });
        };
        map.once('idle', tryElevation);
        setTimeout(tryElevation, 2500);
      }
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to compute route.');
    } finally {
      setRouteLoading(false);
    }
  };

  const busy = loadingData || routeLoading;

  const hasLibraryLeg = Boolean(libraryId && libraryRole !== 'none');
  const minStopsForButton = hasLibraryLeg ? 1 : 2;

  const exportGpx = () => {
    if (!routeGpx?.coordinates?.length) return;
    const gpx = buildGpx({
      name: 'Summer Game bike route',
      trackName: 'Cycling route',
      coordinates: routeGpx.coordinates,
      waypoints: routeGpx.waypoints,
    });
    const filename = `bike-route-${new Date().toISOString().slice(0, 10)}.gpx`;
    downloadTextFile(filename, gpx);
  };

  return (
    <div class="space-y-4 max-w-5xl mx-auto p-4">
      {error && (
        <div class="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-md text-sm">
          {error}
        </div>
      )}

      <div class="flex flex-wrap gap-2 items-center text-sm text-slate-600">
        <MapPin class="w-4 h-4 shrink-0" />
        <span>
          Data: <code class="bg-slate-100 px-1 rounded">{DATA_URL}</code>
        </span>
        {stopsInArea != null && polygonClosed && (
          <span class="text-slate-800">
            · <strong>{stopsInArea}</strong> stops in area
          </span>
        )}
        {routeSummary && (
          <span class="text-slate-800">
            · Route <strong>{routeSummary.distanceLabel}</strong>,{' '}
            <strong>{routeSummary.durationLabel}</strong> (
            {routeSummary.stops} lawn stops
            {routeSummary.libraryNote ? (
              <span>
                , <strong>{routeSummary.libraryNote}</strong> as library leg
              </span>
            ) : null}
            , {routeSummary.visitOrder} visit points)
            {routeSummary.elevation ? (
              <span class="text-slate-700">
                {' '}
                · Elev. ~{routeSummary.elevation.minFt.toLocaleString()}–
                {routeSummary.elevation.maxFt.toLocaleString()} ft, climb ~
                {routeSummary.elevation.climbFt.toLocaleString()} ft
                <span class="text-slate-500 font-normal"> (terrain est.)</span>
              </span>
            ) : null}
          </span>
        )}
      </div>

      <div class="relative">
        <div
          ref={mapContainer}
          class="h-[min(70vh,560px)] w-full rounded-lg shadow border border-slate-200"
        />
        {busy && (
          <div class="absolute inset-0 bg-white/70 flex items-center justify-center rounded-lg z-10">
            <RotateCw class="w-8 h-8 animate-spin text-blue-600" />
          </div>
        )}
      </div>

      <div class="flex flex-wrap gap-2 items-center">
        <button
          type="button"
          onClick={loadPointsData}
          disabled={busy}
          class="inline-flex items-center gap-2 px-3 py-2 bg-slate-700 text-white rounded-md text-sm hover:bg-slate-800 disabled:opacity-50"
        >
          <RotateCw class={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} />
          Reload data
        </button>

        <button
          type="button"
          onClick={startDrawing}
          disabled={busy}
          class="inline-flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          <Pentagon class="w-4 h-4" />
          Draw inclusion area
        </button>
        <button
          type="button"
          onClick={closePolygon}
          disabled={busy}
          class="inline-flex items-center gap-2 px-3 py-2 bg-blue-100 text-blue-900 rounded-md text-sm hover:bg-blue-200 disabled:opacity-50"
        >
          Close area
        </button>
        <button
          type="button"
          onClick={clearPolygon}
          disabled={busy}
          class="inline-flex items-center gap-2 px-3 py-2 border border-slate-300 rounded-md text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <Trash2 class="w-4 h-4" />
          Clear area
        </button>

        <button
          type="button"
          onClick={calculateRoute}
          disabled={
            busy ||
            !polygonClosed ||
            stopsInArea == null ||
            stopsInArea < minStopsForButton
          }
          class="inline-flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-md text-sm hover:bg-emerald-700 disabled:opacity-50"
        >
          <Route class="w-4 h-4" />
          Bike route for stops in area
        </button>

        <button
          type="button"
          onClick={exportGpx}
          disabled={!routeGpx?.coordinates?.length}
          class="inline-flex items-center gap-2 px-3 py-2 border border-emerald-700 text-emerald-800 rounded-md text-sm hover:bg-emerald-50 disabled:opacity-50"
        >
          <Download class="w-4 h-4" />
          Export GPX
        </button>
      </div>

      <div class="flex flex-wrap gap-3 items-end text-sm">
        <label class="flex flex-col gap-1">
          <span class="text-slate-600">AADL branch (optional)</span>
          <select
            class="border border-slate-300 rounded-md px-2 py-1.5 bg-white min-w-[12rem]"
            value={libraryId}
            onChange={(e) => {
              const v = e.currentTarget.value;
              setLibraryId(v);
              if (!v) setLibraryRole('none');
              else if (libraryRole === 'none') setLibraryRole('end');
            }}
          >
            <option value="">None</option>
            {aadlData.libraries.map((lib) => (
              <option key={lib.id} value={lib.id}>
                {lib.name}
              </option>
            ))}
          </select>
        </label>
        <label class="flex flex-col gap-1">
          <span class="text-slate-600">Library in route</span>
          <select
            class="border border-slate-300 rounded-md px-2 py-1.5 bg-white min-w-[11rem] disabled:opacity-50"
            value={libraryRole}
            disabled={!libraryId}
            onChange={(e) => setLibraryRole(e.currentTarget.value)}
          >
            <option value="none">Not used</option>
            <option value="start">Start ride here</option>
            <option value="mid">Roughly halfway</option>
            <option value="end">End ride here</option>
          </select>
        </label>
      </div>

      <p class="text-xs text-slate-500 leading-relaxed">
        Purple dots are Ann Arbor District Library branches (from{' '}
        <a
          class="text-blue-700 underline"
          href="https://aadl.org/aboutus/locations"
          target="_blank"
          rel="noopener noreferrer"
        >
          aadl.org
        </a>
        ). Click the map to add corners while drawing. Choose &ldquo;Close area&rdquo; when done.
        Distance and time use U.S. units (miles; under an hour shows minutes only, otherwise hours
        and minutes). Elevation range and climb come from Mapbox terrain (DEM) sampled along the
        route—useful as an estimate, not survey-grade. The route uses nearest-neighbor order on lawn
        stops, then Mapbox cycling directions in segments of up to {MAX_WAYPOINTS_PER_REQUEST}{' '}
        waypoints. GPX includes the track and waypoints in visit order.
      </p>
    </div>
  );
}
