import { IMPORT_API_BASE_URL } from './import-config.js';

const $ = selector => document.querySelector(selector);
const fields = {
  name: '#route-name', difficulty: '#route-difficulty', range: '#route-range', country: '#route-country', description: '#route-description',
  'entry.latitude': '#entry-lat', 'entry.longitude': '#entry-lon', 'entry.elevation': '#entry-elevation',
  'summit.latitude': '#summit-lat', 'summit.longitude': '#summit-lon', 'summit.elevation': '#summit-elevation',
  approachMinutes: '#approach-minutes', climbMinutes: '#climb-minutes', durationMinutes: '#duration-minutes'
};
const get = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);
const text = value => String(value ?? '').trim();

function confidenceFor(result, path) {
  if (path.startsWith('entry.')) return result.confidence?.entryGps || 'unknown';
  if (path.startsWith('summit.')) return result.confidence?.summitGps || 'unknown';
  return result.confidence?.[path] || (get(result.data, path) == null ? 'unknown' : 'low');
}

export function fallbackParse(rawText, data = {}) {
  const fallback = { ...data };
  const lineMatch = expression => rawText.match(expression)?.[1]?.trim() || null;
  if (!fallback.difficulty) {
    const match = rawText.match(/(?:Schwierigkeit|Schwierigkeitsgrad|Klettersteiggrad)\s*:?\s*([A-F](?:\s*[\/-–]\s*[A-F]){0,2})/iu);
    if (match) fallback.difficulty = match[1].toUpperCase().replace(/\s/g, '').replace(/–|-/g, '/');
  }
  const minutes = labels => {
    const escaped = labels.join('|');
    const match = rawText.match(new RegExp(`(?:${escaped})\\s*(?:ca\\.?|etwa|:|–|-)*\\s*(\\d+(?:[.,]\\d+)?)\\s*(Stunden?|Std\\.?|h|Minuten?|min\\.?)`, 'iu'));
    if (!match) return null;
    return Math.round(Number(match[1].replace(',', '.')) * (/^(min|minute)/iu.test(match[2]) ? 1 : 60));
  };
  fallback.approachMinutes ??= minutes(['Zustieg', 'Zustiegszeit', 'Zustiegsdauer']);
  fallback.climbMinutes ??= minutes(['Kletterzeit', 'Steigzeit']);
  fallback.durationMinutes ??= minutes(['Gesamtdauer', 'Gesamtzeit', 'Gehzeit gesamt', 'Zeitbedarf']);
  fallback.ascentMeters ??= Number(rawText.match(/(?:Höhenmeter|Höhenunterschied|Aufstieg)\D{0,30}(\d{3,4})\s*(?:hm|m\b)/iu)?.[1]) || null;
  fallback.summit ??= {};
  const labelledPoint = labels => {
    const expression = new RegExp(`(?:${labels})[^\\d-]{0,100}(-?\\d{1,2}\\.\\d{4,})\\s*[,;/ ]\\s*(-?\\d{1,3}\\.\\d{4,})`, 'iu');
    const match = rawText.match(expression);
    if (!match) return null;
    const latitude = Number(match[1]), longitude = Number(match[2]);
    return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180 ? { latitude, longitude } : null;
  };
  fallback.entry ??= {};
  const entryPoint = labelledPoint('Einstieg|Startpunkt|Start-GPS');
  const summitPoint = labelledPoint('Gipfel|Ausstieg|Endpunkt');
  if (entryPoint) { fallback.entry.latitude ??= entryPoint.latitude; fallback.entry.longitude ??= entryPoint.longitude; }
  if (summitPoint) { fallback.summit.latitude ??= summitPoint.latitude; fallback.summit.longitude ??= summitPoint.longitude; }
  fallback.summit.elevation ??= Number(rawText.match(/(?:Gipfelhöhe|Höhe am Gipfel|Ausstiegshöhe)\D{0,30}(\d{3,4})\s*m/iu)?.[1]) || null;
  fallback.range ||= lineMatch(/(?:Gebirgsgruppe|Gebirge|Region)\s*:?\s*([^\n.;]{3,80})/iu);
  fallback.country ||= lineMatch(/Land\s*:\s*(Österreich|Deutschland|Schweiz|Italien|Slowenien|Frankreich)/iu);
  fallback.name ||= lineMatch(/(?:Tour|Klettersteig)\s*:\s*([^\n.]{3,100})/iu);
  return fallback;
}

function renderResult(result, filled, errors) {
  const root = $('#route-import-results');
  const recognized = Object.entries(fields).filter(([path]) => get(result.data, path) != null);
  const messages = [
    `<strong>${filled} leere Formularfelder übernommen.</strong>`,
    recognized.length ? `<ul>${recognized.map(([path]) => `<li>${path.replace('.', ' · ')}: ${escapeHtml(text(get(result.data, path)))}</li>`).join('')}</ul>` : '<p>Es wurden keine passenden Formularwerte erkannt.</p>',
    result.data?.ascentMeters != null ? `<p>Höhenmeter erkannt (${escapeHtml(String(result.data.ascentMeters))} m), aber nicht in ein Feld übernommen: Das bestehende Formular-/Datenmodell hat dafür kein entsprechendes Feld.</p>` : '',
    result.data?.gpsCandidates?.length ? `<p class="import-warning">${result.data.gpsCandidates.length} GPS-Kandidat(en) ohne sichere Zuordnung gefunden; nicht automatisch in Einstieg oder Gipfel eingetragen.</p>` : '',
    result.warnings?.length ? `<ul class="import-warning">${result.warnings.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '',
    errors.length ? `<p class="import-warning">Nicht übernommen, weil bereits ausgefüllt: ${errors.map(escapeHtml).join(', ')}.</p>` : '',
    result.rawText ? `<details><summary>Bereinigten Seitentext anzeigen</summary><p>${escapeHtml(result.rawText.slice(0, 2500))}${result.rawText.length > 2500 ? ' …' : ''}</p></details>` : ''
  ].filter(Boolean);
  root.innerHTML = messages.join('');
  root.hidden = false;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function applyImport(result) {
  const data = fallbackParse(result.rawText || '', result.data || {});
  const conflicts = [], imported = [];
  for (const [path, selector] of Object.entries(fields)) {
    const value = get(data, path);
    const input = $(selector);
    if (value == null || value === '' || !input) continue;
    if (text(input.value)) { conflicts.push(path); continue; }
    input.value = String(value);
    const confidence = confidenceFor(result, path);
    const isGps = path.startsWith('entry.') || path.startsWith('summit.');
    input.classList.add('import-unverified');
    input.title = `Importwert · Vertrauensstufe: ${confidence}. Vor dem Speichern prüfen.`;
    imported.push(path);
    if (isGps) {
      const prefix = path.startsWith('entry.') ? 'entry' : 'summit';
      $(`#${prefix}-verified`).checked = false;
      const note = $(`#${prefix}-verification-note`);
      if (note && !text(note.value)) note.value = `Importkandidat (${confidence}); GPS vor Veröffentlichung manuell prüfen.`;
      const source = $(`#${prefix}-source`);
      if (source && !text(source.value)) source.value = result.sourceUrl || '';
    }
  }
  if (result.sourceUrl) {
    const links = $('#route-links');
    const existing = links.value.split('\n').some(line => line.includes(result.sourceUrl));
    if (!existing) links.value = [links.value.trim(), `Importquelle | ${result.sourceUrl}`].filter(Boolean).join('\n');
  }
  renderResult({ ...result, data }, imported.length, conflicts);
  return imported.length;
}

export function initRouteImport() {
  const button = $('#route-import-button');
  button.addEventListener('click', async () => {
    const input = $('#route-import-url');
    const status = $('#route-import-status');
    const url = text(input.value);
    status.className = 'route-import-status';
    $('#route-import-results').hidden = true;
    if (!/^https?:\/\//i.test(url)) {
      status.textContent = 'Bitte eine vollständige HTTP- oder HTTPS-URL eingeben.';
      status.classList.add('error');
      input.focus();
      return;
    }
    if (IMPORT_API_BASE_URL.includes('YOUR-WEBSPACE-DOMAIN')) {
      status.textContent = 'Bitte zuerst IMPORT_API_BASE_URL in js/import-config.js auf die PHP-API deines Webspaces setzen.';
      status.classList.add('warning');
      return;
    }
    button.disabled = true;
    button.classList.add('spinning');
    status.textContent = 'Tourenseite wird sicher vom Server abgerufen und ausgewertet …';
    try {
      const endpoint = new URL('import.php', IMPORT_API_BASE_URL);
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }), signal: AbortSignal.timeout(22000)
      });
      let result;
      try { result = await response.json(); }
      catch { throw new Error(`Import-API lieferte kein JSON (HTTP ${response.status}).`); }
      if (!response.ok || result.success !== true) throw new Error(result.error || `Import fehlgeschlagen (HTTP ${response.status}).`);
      const filled = applyImport(result);
      status.textContent = `${filled} leere Felder ergänzt. Bitte gelb markierte Werte und Quellen prüfen; es wurde nichts gespeichert.`;
      if (result.warnings?.length || result.data?.gpsCandidates?.length) status.classList.add('warning');
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'Der Import hat zu lange gedauert. Bitte später erneut versuchen.' : `Import nicht möglich: ${error.message}`;
      status.classList.add('error');
    } finally {
      button.disabled = false;
      button.classList.remove('spinning');
    }
  });
  for (const selector of Object.values(fields)) {
    $(selector).addEventListener('input', event => {
      event.currentTarget.classList.remove('import-unverified');
      event.currentTarget.removeAttribute('title');
    });
  }
}
