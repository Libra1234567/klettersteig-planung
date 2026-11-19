export function coordinatesOf(point) {
  if (!point || typeof point !== 'object') return null;
  const parse = (value, min, max) => {
    if (value == null || typeof value === 'boolean' || (typeof value === 'string' && value.trim() === '')) return null;
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
  };
  const latitude = parse(point.latitude ?? point.lat, -90, 90);
  const longitude = parse(point.longitude ?? point.lon ?? point.lng, -180, 180);
  return latitude == null || longitude == null ? null : { latitude, longitude };
}

export function haversineKm(a, b) {
  const pointA = coordinatesOf(a), pointB = coordinatesOf(b);
  if (!pointA || !pointB) return null;
  const rad = n => n * Math.PI / 180;
  const dLat = rad(pointB.latitude - pointA.latitude), dLon = rad(pointB.longitude - pointA.longitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(pointA.latitude)) * Math.cos(rad(pointB.latitude)) * Math.sin(dLon / 2) ** 2;
  const bounded = Math.min(1, Math.max(0, x));
  return 6371 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded));
}
