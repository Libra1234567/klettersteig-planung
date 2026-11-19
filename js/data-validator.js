const pointValid = point => Number.isFinite(point?.latitude) && point.latitude >= -90 && point.latitude <= 90 && Number.isFinite(point?.longitude) && point.longitude >= -180 && point.longitude <= 180;
const missing = value => value == null || (typeof value === 'string' && !value.trim());

export function scanLocations(routes) {
  const idCounts = new Map(), nameCounts = new Map();
  for (const route of routes) {
    idCounts.set(route.id, (idCounts.get(route.id) || 0) + 1);
    const key = String(route.name || '').trim().toLocaleLowerCase('de');
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  return routes.map(route => {
    const issues = [], conflicts = [];
    if (missing(route.id)) issues.push('ID fehlt');
    if (missing(route.name)) issues.push('Name fehlt');
    if (missing(route.country)) issues.push('Land fehlt');
    if (missing(route.range)) issues.push('Region fehlt');
    if (missing(route.difficulty)) issues.push('Schwierigkeit fehlt');
    if (missing(route.rating)) issues.push('AlpinVerse-Bewertung fehlt');
    if (missing(route.description)) issues.push('Beschreibung fehlt');
    if (idCounts.get(route.id) > 1) conflicts.push('Doppelte ID');
    if (nameCounts.get(String(route.name || '').trim().toLocaleLowerCase('de')) > 1) conflicts.push('Doppelter Name');
    for (const [key, label] of [['entry', 'Einstieg'], ['summit', 'Gipfel/Ausstieg']]) {
      const p = route[key];
      if (!p || (missing(p.latitude) && missing(p.longitude))) issues.push(`${label}: GPS fehlt`);
      else if (!pointValid(p)) conflicts.push(`${label}: ungültige oder unvollständige GPS-Koordinate`);
      else if (!p.source && !p.label) issues.push(`${label}: GPS-Quelle nicht am Punkt dokumentiert`);
      if (pointValid(p) && p.verified !== true) issues.push(`${label}: GPS nicht verifiziert`);
      if (missing(p?.elevation)) issues.push(`${label}: Höhe fehlt`);
      else if (!Number.isFinite(p.elevation) || p.elevation < -500 || p.elevation > 9000) conflicts.push(`${label}: unplausible Höhe`);
    }
    for (const [key, label] of [['approachMinutes', 'Zustiegszeit'], ['climbMinutes', 'Kletterzeit'], ['descentMinutes', 'Abstiegszeit']]) {
      if (missing(route[key])) issues.push(`${label} fehlt`);
      else if (!Number.isFinite(route[key]) || route[key] <= 0 || route[key] > 1440) conflicts.push(`${label}: unplausibler Wert`);
    }
    if (!Array.isArray(route.links) || !route.links.length) issues.push('Tourenquellen fehlen');
    else if (route.links.some(link => !/^https:\/\//i.test(link?.url || ''))) conflicts.push('Ungültiger externer Link');
    if (route.rating != null && (!Number.isFinite(route.rating) || route.rating < 0 || route.rating > 5)) conflicts.push('Bewertung außerhalb 0–5');
    if (pointValid(route.entry) && pointValid(route.summit)) {
      const same = route.entry.latitude === route.summit.latitude && route.entry.longitude === route.summit.longitude;
      if (same && Math.abs((route.entry.elevation ?? 0) - (route.summit.elevation ?? 0)) > 30) conflicts.push('Einstieg und Ausstieg haben identische GPS-Punkte, aber stark abweichende Höhe');
      if (Number.isFinite(route.entry.elevation) && Number.isFinite(route.summit.elevation) && route.entry.elevation - route.summit.elevation > 500) conflicts.push('Einstieg liegt deutlich höher als Gipfel/Ausstieg – Tourenzuordnung prüfen');
    }
    if (Number.isFinite(route.durationMinutes) && ['approachMinutes','climbMinutes','descentMinutes'].every(key => Number.isFinite(route[key]))) {
      const sum = route.approachMinutes + route.climbMinutes + route.descentMinutes;
      if (Math.abs(route.durationMinutes - sum) > Math.max(30, sum * 0.2)) conflicts.push('Gesamtdauer weicht deutlich von Teilzeiten ab');
    }
    const closure = route.closure;
    if (!closure || closure.status === 'Unbekannt' || !closure.checkedAt) issues.push('Sperrstatus ungeklärt oder nicht datiert');
    else if (closure.validTo && closure.validTo < new Date().toISOString().slice(0, 10)) issues.push('Sperrstatus-Prüfung abgelaufen');
    const quality = conflicts.length ? 'Fehlerhaft' : issues.length === 0 ? 'Vollständig' : issues.length <= 3 ? 'Gut' : issues.length <= 7 ? 'Teilweise' : 'Unvollständig';
    return { id: route.id, name: route.name || '(ohne Namen)', quality, issues, conflicts, entryGps: pointValid(route.entry), summitGps: pointValid(route.summit), missingElevations: ['entry','summit'].filter(key => !Number.isFinite(route[key]?.elevation)).length };
  });
}

export function summarizeScan(rows) {
  const all = rows.length;
  return {
    total: all,
    complete: rows.filter(row => row.quality === 'Vollständig').length,
    incomplete: rows.filter(row => row.quality !== 'Vollständig').length,
    missingEntryGps: rows.filter(row => !row.entryGps).length,
    missingSummitGps: rows.filter(row => !row.summitGps).length,
    missingElevations: rows.reduce((sum, row) => sum + row.missingElevations, 0),
    missingTimes: rows.reduce((sum, row) => sum + row.issues.filter(issue => /zeit fehlt/.test(issue)).length, 0),
    missingSources: rows.filter(row => row.issues.includes('Tourenquellen fehlen')).length,
    conflicts: rows.filter(row => row.conflicts.length).length,
    uncheckedClosures: rows.filter(row => row.issues.some(issue => issue.startsWith('Sperrstatus'))).length
  };
}
