import { scanLocations, summarizeScan } from './data-validator.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const STORAGE = 'steigwetter.ai-manager.v1';
const EXPORTABLE_FIELDS = new Set(['entry.latitude','entry.longitude','entry.elevation','summit.latitude','summit.longitude','summit.elevation','difficulty','description','approachMinutes','climbMinutes','descentMinutes','durationMinutes','range','country','closure.status','closure.reason','closure.source','closure.validFrom','closure.validTo']);
let routes = [], scanRows = [], results = [], state = { decisions: {}, history: [] }, activeMetric = '';
const today = () => new Date().toISOString();

function notice(message, type = 'info') { const node = $('#manager-notice'); node.textContent = message; node.className = `admin-notice ${type}`; node.hidden = false; }
function persist() { localStorage.setItem(STORAGE, JSON.stringify(state)); }
function routeName(id) { return routes.find(route => route.id === id)?.name || id || 'Unbekannter Klettersteig'; }
function pointOK(p) { return Number.isFinite(p?.latitude) && p.latitude >= -90 && p.latitude <= 90 && Number.isFinite(p?.longitude) && p.longitude >= -180 && p.longitude <= 180; }
function metric(label, value, key) { return `<button class="ai-metric ${activeMetric === key ? 'active' : ''}" data-metric="${esc(key)}"><b>${esc(value)}</b><span>${esc(label)}</span></button>`; }
function renderMetrics() {
  const summary = summarizeScan(scanRows), missingTimes = summary.missingTimes;
  const values = [
    ['Klettersteige', summary.total, 'all'], ['Vollständig', summary.complete, 'Vollständig'], ['Unvollständig', summary.incomplete, 'incomplete'],
    ['Einstieg GPS fehlt', summary.missingEntryGps, 'entry-gps'], ['Gipfel GPS fehlt', summary.missingSummitGps, 'summit-gps'],
    ['Höhen fehlen', summary.missingElevations, 'elevation'], ['Tourenzeiten fehlen', missingTimes, 'times'], ['Quellen fehlen', summary.missingSources, 'sources'],
    ['Widersprüche', summary.conflicts, 'conflicts'], ['Sperrstatus ungeklärt', summary.uncheckedClosures, 'closure'],
    ['Vorschläge in Prüfung', results.reduce((n, r) => n + (r.fields || []).length, 0), 'proposals'], ['Zuletzt recherchiert', results.length ? results.map(r => r.researchedAt || '').filter(Boolean).sort().at(-1)?.slice(0,10) || '–' : '–', 'recent']
  ];
  $('#metrics').innerHTML = values.map(([label,value,key]) => metric(label,value,key)).join('');
  document.querySelectorAll('[data-metric]').forEach(button => button.addEventListener('click', () => { activeMetric = activeMetric === button.dataset.metric ? '' : button.dataset.metric; renderMetrics(); renderScan(); }));
}
function matchesMetric(row, route) {
  const issues = row.issues, conflicts = row.conflicts;
  switch (activeMetric) {
    case 'all': return true;
    case 'Vollständig': return row.quality === 'Vollständig';
    case 'incomplete': return row.quality !== 'Vollständig';
    case 'entry-gps': return !row.entryGps;
    case 'summit-gps': return !row.summitGps;
    case 'elevation': return row.missingElevations > 0;
    case 'times': return issues.some(issue => /zeit fehlt/.test(issue));
    case 'sources': return issues.includes('Tourenquellen fehlen');
    case 'conflicts': return conflicts.length > 0;
    case 'closure': return issues.some(issue => issue.startsWith('Sperrstatus'));
    case 'proposals': return results.some(result => result.routeId === route.id && result.fields?.length);
    case 'recent': return results.some(result => result.routeId === route.id);
    default: return true;
  }
}
function filteredRows() {
  const query = $('#route-search').value.trim().toLocaleLowerCase('de'), quality = $('#quality-filter').value;
  return scanRows.filter(row => {
    const route = routes.find(candidate => candidate.id === row.id);
    return matchesMetric(row, route || {}) && (!quality || row.quality === quality) && (!query || row.name.toLocaleLowerCase('de').includes(query));
  });
}
function renderScan() {
  const rows = filteredRows();
  $('#scan-rows').innerHTML = rows.map(row => `<tr><td><strong>${esc(row.name)}</strong><small>${esc(row.id)}</small></td><td><span class="ai-quality quality-${esc(row.quality)}">${esc(row.quality)}</span></td><td>${row.entryGps?'✓':'–'} / ${row.summitGps?'✓':'–'}</td><td><small>${esc(row.issues.join(' · ') || 'Keine fehlenden Pflichtangaben')}</small></td><td><small>${esc(row.conflicts.join(' · ') || '–')}</small></td><td><button class="ai-row-button" data-route="${esc(row.id)}">Details</button></td></tr>`).join('');
  $('#scan-cards').innerHTML = rows.map(row => `<article class="ai-route-card"><h3>${esc(row.name)} · ${esc(row.quality)}</h3><p>GPS Einstieg/Gipfel: ${row.entryGps?'Ja':'Nein'} / ${row.summitGps?'Ja':'Nein'}<br>${esc([...row.issues,...row.conflicts].join(' · ') || 'Keine offenen Prüfpunkte')}</p></article>`).join('');
  $('#empty-state').hidden = rows.length > 0;
  document.querySelectorAll('[data-route]').forEach(button => button.addEventListener('click', () => {
    const row = scanRows.find(item => item.id === button.dataset.route), route = routes.find(item => item.id === button.dataset.route);
    notice(`${route.name}: ${[...row.issues,...row.conflicts].join(' · ') || 'Keine gefundenen Prüfpunkte.'}`);
  }));
}
function sourceList(field, result) {
  const sources = field.sources?.length ? field.sources : result.sources || [];
  return sources.map(source => {
    const url = typeof source === 'string' ? source : source.url;
    const label = typeof source === 'string' ? source : source.title || source.url;
    return /^https:\/\//i.test(url || '') ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)}</a>` : '';
  }).join('');
}
function fieldPath(field) { return String(field.path || ''); }
function renderProposals() {
  const fields = results.flatMap(result => (result.fields || []).map((field, index) => ({ result, field, index })));
  $('#proposal-empty').hidden = fields.length > 0;
  $('#proposal-list').innerHTML = fields.map(({result,field,index}) => {
    const key = `${result.routeId}:${fieldPath(field)}`, decision = state.decisions[key] || 'open';
    const safe = EXPORTABLE_FIELDS.has(fieldPath(field));
    return `<article class="proposal-card" data-proposal="${esc(key)}"><div class="proposal-heading"><div><h3>${esc(routeName(result.routeId))}</h3><small>${esc(result.researchedAt || 'Recherchezeit unbekannt')} · ${esc(field.verificationStatus || 'nicht verifiziert')} · Vertrauen ${Math.round((field.confidence || 0)*100)}%</small></div><span class="ai-quality ${decision==='approved'?'quality-Gut':''}">${esc(decision==='approved'?'Freigegeben (lokal)':decision==='rejected'?'Abgelehnt':decision==='deferred'?'Später prüfen':'Prüfung offen')}</span></div>
      <div class="proposal-field"><b>${esc(fieldPath(field))}</b><span class="proposal-value"><del>${esc(JSON.stringify(field.currentValue ?? null))}</del></span><span class="proposal-value" data-value>${esc(JSON.stringify(field.proposedValue ?? null))}</span></div>
      <div class="proposal-field"><b>Quellen &amp; Begründung</b><span class="proposal-value proposal-sources">${sourceList(field,result) || 'Keine anklickbare Quelle mitgeliefert'}</span><span class="proposal-value">${esc(field.rationale || result.summary || 'Keine Begründung')}</span></div>
      <div class="proposal-controls"><label><input type="checkbox" data-approve ${decision==='approved'?'checked':''} ${safe?'':'disabled'}> Diesen Feldwert freigeben</label><button type="button" data-decision="rejected">Ablehnen</button><button type="button" data-decision="deferred">Später prüfen</button><input type="text" aria-label="Manuell bearbeiteter Wert" placeholder="Manuell bearbeiten (JSON-Wert)" data-manual><input type="url" aria-label="Quelle für manuelle Bearbeitung" placeholder="Prüfquelle https://…" data-manual-source><button type="button" data-save-manual>Wert übernehmen</button><span class="proposal-status">${field.conflict?'Quellenkonflikt — manuelle Prüfung erforderlich':safe?'':'Feld nicht exportierbar'}</span></div></article>`;
  }).join('');
  document.querySelectorAll('[data-approve]').forEach(input => input.addEventListener('change', () => setDecision(input.closest('[data-proposal]').dataset.proposal, input.checked ? 'approved' : 'open')));
  document.querySelectorAll('[data-decision]').forEach(button => button.addEventListener('click', () => setDecision(button.closest('[data-proposal]').dataset.proposal, button.dataset.decision)));
  document.querySelectorAll('[data-save-manual]').forEach(button => button.addEventListener('click', () => {
    const card = button.closest('[data-proposal]'), fieldRef = findProposal(card.dataset.proposal), input = card.querySelector('[data-manual]');
    try { const parsed = JSON.parse(input.value); const source = card.querySelector('[data-manual-source]').value.trim(); if (!/^https:\/\//i.test(source)) throw new Error('Bitte eine HTTPS-Prüfquelle angeben.'); fieldRef.field.proposedValue = parsed; fieldRef.field.confidence = 1; fieldRef.field.verificationStatus = 'manuell geprüft'; fieldRef.field.conflict = false; fieldRef.field.sources = [{url:source,title:'Manuell geprüfte Quelle',reliability:'manuell geprüft'}]; card.querySelector('[data-value]').textContent = JSON.stringify(parsed); fieldRef.field.manual = true; state.history.unshift({ at: today(), routeId: fieldRef.result.routeId, field: fieldPath(fieldRef.field), action: 'Manuell bearbeitet', value: parsed, source }); persist(); renderMetrics(); renderProposals(); }
    catch { notice('Der manuelle Wert muss gültiges JSON sein, etwa 47.6344, true oder "Text".','warning'); }
  }));
}
function findProposal(key) { for (const result of results) for (const field of result.fields || []) if (`${result.routeId}:${fieldPath(field)}` === key) return {result,field}; return null; }
function setDecision(key, decision) {
  const ref = findProposal(key); if (!ref) return;
  if (decision === 'approved' && (ref.field.conflict || !ref.field.sources?.length && !ref.result.sources?.length)) { notice('Dieser Vorschlag hat einen Quellenkonflikt oder keine Quelle; löse den Konflikt und bearbeite den Wert manuell, bevor du ihn freigibst.','warning'); return; }
  state.decisions[key] = decision;
  state.history.unshift({ at: today(), routeId: ref.result.routeId, field: fieldPath(ref.field), oldValue: ref.field.currentValue, newValue: ref.field.proposedValue, sources: ref.field.sources || ref.result.sources || [], action: decision });
  persist(); renderMetrics(); renderProposals(); renderHistory();
}
function proposeAllClear() {
  let count = 0;
  for (const result of results) for (const field of result.fields || []) {
    const key = `${result.routeId}:${fieldPath(field)}`;
    if (EXPORTABLE_FIELDS.has(fieldPath(field)) && !field.conflict && field.confidence >= 0.9 && ['source-confirmed','verified','official'].includes(String(field.verificationStatus).toLowerCase()) && (field.sources?.length || result.sources?.length)) { state.decisions[key] = 'approved'; count++; }
  }
  persist(); renderMetrics(); renderProposals(); notice(`${count} eindeutig belegte Felder lokal freigegeben. Export und Pull Request bleiben separate Schritte.`,'success');
}
function exportApproved() {
  const changes = [];
  for (const result of results) for (const field of result.fields || []) {
    const key = `${result.routeId}:${fieldPath(field)}`;
    if (state.decisions[key] !== 'approved') continue;
    changes.push({ routeId: result.routeId, path: fieldPath(field), expectedValue: field.currentValue ?? null, value: field.proposedValue, source: field.sources?.[0]?.url || field.sources?.[0] || result.sources?.[0]?.url || result.sources?.[0] || '', confidence: field.confidence || 0, verificationStatus: field.verificationStatus || 'unverified', approvedAt: today() });
  }
  if (!changes.length) { notice('Es gibt keine freigegebenen Feldwerte zum Export.','warning'); return; }
  download({ schemaVersion:1, generatedAt:today(), changes }, 'approved-changes.json');
  notice(`${changes.length} freigegebene Änderungen exportiert. Lege data/approved-changes.json im Repository ab; die Action validiert die Änderungen und erstellt einen Pull Request.`,'success');
}
function renderHistory() {
  const history = state.history.slice(0,100);
  $('#history-list').innerHTML = history.length ? history.map(item => `<div class="ai-history-item"><time>${esc(item.at || '')}</time><span><b>${esc(routeName(item.routeId))}</b> · ${esc(item.field || '')} · ${esc(item.action || '')}${item.newValue !== undefined ? ` · ${esc(JSON.stringify(item.newValue))}` : ''}</span></div>`).join('') : '<p class="ai-muted">Noch keine lokalen Prüfaktionen protokolliert.</p>';
}
function download(value, filename) { const blob = new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename;a.click();URL.revokeObjectURL(url); }
async function importFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed.results)) throw new Error('Die Datei enthält kein results-Array.');
    results = parsed.results.filter(result => routes.some(route => route.id === result.routeId));
    for (const result of results) for (const field of result.fields || []) {
      if (field.currentValue === undefined) field.currentValue = valueAt(routes.find(route => route.id === result.routeId),fieldPath(field));
      if (!field.sources?.length && Array.isArray(result.sources)) field.sources = result.sources;
    }
    persist(); renderMetrics(); renderProposals(); renderHistory();
    notice(`${results.length} Rechercheergebnisse importiert. Prüfe Quellen, Konflikte und jeden Feldwert vor Freigabe.`, 'success');
  } catch(error) { notice(`Import fehlgeschlagen: ${error.message}`,'error'); }
  finally { $('#results-file').value=''; }
}
function valueAt(object,path) { return path.split('.').reduce((value,key)=>value?.[key],object); }
function workflowSetup() {
  const host = location.hostname, segments = location.pathname.split('/').filter(Boolean), repo = segments[0];
  const button = $('#actions-link'), setup = $('#workflow-setup');
  if ((host.endsWith('github.io') || host === 'github.com') && repo) { const owner = host.split('.')[0]; button.href = `https://github.com/${owner}/${repo}/actions`; setup.textContent = 'GitHub Actions benötigt das Repository-Secret OPENAI_API_KEY und Workflow-Berechtigungen für Pull Requests.'; }
  else { setup.textContent = 'GitHub-Repository ist aus dieser lokalen Adresse nicht ermittelbar. Öffne Actions im Repository nach dem Push der Workflow-Dateien.'; }
}
function events() {
  $('#scan-button').addEventListener('click', () => runScan());
  $('#route-search').addEventListener('input',renderScan); $('#quality-filter').addEventListener('change',renderScan);
  $('#research-mode').addEventListener('change',() => { $('#route-select').disabled = $('#research-mode').value !== 'single'; });
  $('#import-results-button').addEventListener('click',() => $('#results-file').click());
  $('#results-file').addEventListener('change',event => importFile(event.target.files[0]));
  $('#approve-clear-button').addEventListener('click',proposeAllClear); $('#export-approved-button').addEventListener('click',exportApproved);
  $('#export-history-button').addEventListener('click',() => download({ exportedAt:today(),history:state.history },'research-review-history.json'));
}
function runScan() {
  const progress = $('#scan-progress'), bar=$('#progress-bar'), label=$('#progress-label'), count=$('#progress-count');
  progress.hidden=false; scanRows=[]; const chunk=5; let index=0;
  const step=() => {
    const end=Math.min(index+chunk,routes.length);
    for(;index<end;index++) scanRows.push(scanLocations([routes[index]])[0]);
    bar.value=routes.length?Math.round(index/routes.length*100):100; count.textContent=`${index} / ${routes.length}`; label.textContent=index<routes.length?`Prüfe ${routes[index]?.name || 'Datensätze'}…`:'Scan abgeschlossen';
    renderMetrics(); renderScan();
    if(index<routes.length) requestAnimationFrame(step); else { state.history.unshift({at:today(),action:'Datenbank-Scan',field:`${routes.length} Datensätze`}); persist(); renderHistory(); }
  };
  requestAnimationFrame(step);
}
async function init() {
  try {
    const response=await fetch('../data/locations.json'); if(!response.ok) throw new Error(`locations.json nicht geladen: HTTP ${response.status}`);
    routes=await response.json();
    const raw=localStorage.getItem(STORAGE); if(raw) state={...state,...JSON.parse(raw)};
    try { const resultsResponse=await fetch('../data/research-results.json'); if(resultsResponse.ok) { const file=await resultsResponse.json(); if(Array.isArray(file.results)&&file.results.length) results=file.results.filter(result=>routes.some(route=>route.id===result.routeId)); } } catch { /* importing a research file remains available offline */ }
    try { const historyResponse=await fetch('../data/research-history.json'); if(historyResponse.ok) { const file=await historyResponse.json(); const byKey=new Map(); for(const item of [...(file.entries||[]),...(state.history||[])]) byKey.set(`${item.at}|${item.routeId}|${item.action}|${item.field||''}`,item); state.history=[...byKey.values()].slice(-300).reverse(); } } catch { /* local history is retained */ }
    scanRows=scanLocations(routes);
    $('#route-select').innerHTML='<option value="">Klettersteig wählen</option>'+routes.map(route=>`<option value="${esc(route.id)}">${esc(route.name)}</option>`).join('');
    events(); workflowSetup(); renderMetrics(); renderScan(); renderProposals(); renderHistory();
    $('#route-select').disabled=true;
  } catch(error) { notice(`${error.message} Öffne die Seite über GitHub Pages oder einen lokalen Webserver.`,'error'); }
}
init();
