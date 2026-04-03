/** Strip simple HTML tags from lawn-code labels for GPX names. */
export function stripHtml(html) {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Build a GPX 1.1 document with a track and optional named waypoints (visit order).
 * @param {{ name: string, trackName: string, coordinates: [number,number][], waypoints?: { lat: number, lon: number, name: string }[] }} opts
 */
export function buildGpx({ name, trackName, coordinates, waypoints = [] }) {
  const time = new Date().toISOString();
  const wptLines = waypoints.map(
    (w) =>
      `  <wpt lat="${w.lat}" lon="${w.lon}"><name>${escapeXml(w.name)}</name></wpt>`
  );
  const trkpts = coordinates.map(([lon, lat]) => {
    const lo = Number(lon).toFixed(7);
    const la = Number(lat).toFixed(7);
    return `    <trkpt lat="${la}" lon="${lo}"></trkpt>`;
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="sg-bike-route"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${time}</time>
  </metadata>
${wptLines.join('\n')}
  <trk>
    <name>${escapeXml(trackName)}</name>
    <trkseg>
${trkpts.join('\n')}
    </trkseg>
  </trk>
</gpx>
`;
}

export function downloadTextFile(filename, text, mime = 'application/gpx+xml') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
