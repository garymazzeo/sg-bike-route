/** Format route distance in miles from meters (Mapbox `route.distance`). */
export function formatMilesFromMeters(meters) {
  const mi = meters / 1609.344;
  if (mi >= 100) return `${mi.toFixed(0)} mi`;
  if (mi >= 10) return `${mi.toFixed(1)} mi`;
  return `${mi.toFixed(2)} mi`;
}

/**
 * Format cycling time: minutes only under 1 hour; otherwise hours + minutes.
 * @param {number} seconds
 */
export function formatDurationHm(seconds) {
  const s = Math.max(0, seconds);
  const totalMin = Math.round(s / 60);
  if (totalMin < 1) return '< 1 min';
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}
