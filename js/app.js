import { fetchForecasts } from './weather.js';
import { evaluate, conditionsLabel } from './scoring.js';
import { haversineKm } from './distance.js';
import { initMap, updateMap } from './map.js';
import { openDetails } from './details.js';
import { closureLabel, effectiveClosure, isRouteActive, mergeLocalDraft, saveWeatherSnapshot } from './admin-data.js';
import { DEFAULT_RAINFALL_HISTORY_URL, rainfallHistoryForRoute } from './wettercom-links.js';

const ORIGINS={oberndorf:{name:'Oberndorf bei Salzburg',latitude:47.9463,longitude:12.9347},hagenberg:{name:'Hagenberg im Mühlkreis',latitude:48.3679,longitude:14.5161}};
const ORIGIN_STORAGE_KEY='steigwetter_selected_origin';
const DISTANCE_STORAGE_KEY='steigwetter_max_distance_km';
const SORT_STORAGE_KEY='steigwetter_sort_mode';
const CLOSURE_NOTICE_STORAGE_KEY='hideStatusNotice';
const SORT_MODES=new Set(['combined','weather','distance']);
const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=(value,digits=0)=>Number.isFinite(value)?new Intl.NumberFormat('de-AT',{maximumFractionDigits:digits,minimumFractionDigits:digits}).format(value):'–';
const iconByStatus={excellent:'☀',good:'◒',limited:'◔',bad:'⌁',unknown:'…'};
const origins=ORIGINS;
const routeDistance=(origin,location)=>haversineKm(origin,location.entry);
let locations=[], forecasts={}, diagnostics={}, lastRequests=null, activeDay=0, selectedOrigin='oberndorf', isRefreshing=false;
let maxDistanceKm=null, sortMode='combined';
let closureNoticeDismissed=false;
let lastFetched=0;
const PAGE_SIZE=10;
let visibleCount=PAGE_SIZE;
const REGION_STORAGE_KEY='steigwetter_selected_regions';
let availableRegions=[],selectedRegions=new Set();
const filters={difficulty:'',country:''};

function initializeOrigin(){
  try{
    const stored=localStorage.getItem(ORIGIN_STORAGE_KEY);
    if(stored&&Object.prototype.hasOwnProperty.call(origins,stored))selectedOrigin=stored;
  }catch(error){console.warn('Gespeicherter Startpunkt konnte nicht gelesen werden:',error);}
  $('#origin-select').value=selectedOrigin;
}

function initializeDistanceAndSort(){
  try{
    const storedDistance=localStorage.getItem(DISTANCE_STORAGE_KEY);
    if(storedDistance!==null&&storedDistance!==''){
      const parsed=Number(storedDistance);
      if([50,100,150].includes(parsed))maxDistanceKm=parsed;
    }
    const storedSort=localStorage.getItem(SORT_STORAGE_KEY);
    if(storedSort&&SORT_MODES.has(storedSort))sortMode=storedSort;
  }catch(error){console.warn('Entfernungs- oder Sortierauswahl konnte nicht gelesen werden:',error);}
  $('#max-distance-filter').value=maxDistanceKm==null?'':String(maxDistanceKm);
  $('#sort-mode-filter').value=sortMode;
}

function persistDistanceAndSort(){
  try{
    if(maxDistanceKm==null)localStorage.removeItem(DISTANCE_STORAGE_KEY);
    else localStorage.setItem(DISTANCE_STORAGE_KEY,String(maxDistanceKm));
    localStorage.setItem(SORT_STORAGE_KEY,sortMode);
  }catch(error){console.warn('Entfernungs- oder Sortierauswahl konnte nicht gespeichert werden:',error);}
}

function saveSelectedOrigin(originId){
  if(!Object.prototype.hasOwnProperty.call(origins,originId))return;
  selectedOrigin=originId;
  try{localStorage.setItem(ORIGIN_STORAGE_KEY,originId);}catch(error){console.warn('Startpunkt konnte nicht gespeichert werden:',error);}
}

function recalculateDistances(originId=selectedOrigin){
  const origin=origins[originId];
  return new Map(locations.map(location=>[location.id,routeDistance(origin,location)]));
}

function initializeClosureNotice(){
  try{closureNoticeDismissed=sessionStorage.getItem(CLOSURE_NOTICE_STORAGE_KEY)==='true';}catch(error){console.warn('Statushinweis-Status konnte nicht gelesen werden:',error);}
  $('#dismiss-closure-notice').addEventListener('click',()=>{
    closureNoticeDismissed=true;
    try{sessionStorage.setItem(CLOSURE_NOTICE_STORAGE_KEY,'true');}catch(error){console.warn('Statushinweis-Status konnte nicht gespeichert werden:',error);}
    const notice=$('#closure-notice');notice.classList.add('is-dismissing');
    window.setTimeout(()=>{notice.hidden=true;notice.classList.remove('is-dismissing');},180);
  });
}

function pageLoaded(){return document.readyState==='loading'?new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true})):Promise.resolve();}
function dateFor(offset){const date=new Date();date.setDate(date.getDate()+offset);return date.toLocaleDateString('sv-SE',{timeZone:'Europe/Vienna'});}
function evaluateDay(date){return Object.fromEntries(locations.map(location=>[location.id,evaluate(location,forecasts[location.id],date)]));}

function totalTourMinutes(location){
  if(Number.isFinite(location.durationMinutes)&&location.durationMinutes>0)return location.durationMinutes;
  const parts=[location.approachMinutes,location.climbMinutes,location.descentMinutes];
  return parts.every(value=>Number.isFinite(value)&&value>=0)?parts.reduce((sum,value)=>sum+value,0):null;
}

function durationLabel(location){
  if(typeof location.durationLabel==='string'&&location.durationLabel.trim())return location.durationLabel;
  const range=location.durationRangeMinutes;
  if(Array.isArray(range)&&range.length===2&&range.every(value=>Number.isFinite(value)&&value>0))return `${n(range[0]/60,0)}–${n(range[1]/60,0)} h`;
  const minutes=totalTourMinutes(location);
  return minutes==null?'Nicht hinterlegt':`${n(minutes/60,1)} h`;
}

function weatherHistoryUrl(location){
  const explicit=location.wetterComUrl;
  if(typeof explicit==='string'){
    try{const url=new URL(explicit);if(url.protocol==='https:'&&/(^|\.)wetter\.com$/i.test(url.hostname))return url.href;}catch{}
  }
  const existing=rainfallHistoryForRoute(location.id).url;
  return existing!==DEFAULT_RAINFALL_HISTORY_URL?existing:`https://www.wetter.com/suche/?q=${encodeURIComponent(location.region||location.range||location.name)}`;
}

function rainBadgeClass(probability, precipitation){
  if(!Number.isFinite(probability))return'neutral';
  if(probability>=65||(Number.isFinite(precipitation)&&precipitation>=5))return'high';
  if(probability>=30||(Number.isFinite(precipitation)&&precipitation>=2))return'medium';
  return'low';
}

function makeCard(location, result, rank, origin, km){
  const score=result.score,historyUrl=weatherHistoryUrl(location),rainClass=rainBadgeClass(result.summit?.precipProb,result.summit?.precip);
  const closure=effectiveClosure(location),closureState=closure.status||'Unbekannt',closureClass=closureState==='Gesperrt'?'closed':closureState==='Teilweise gesperrt'?'partial-closed':closureState==='Eingeschränkt'?'restricted':closureState==='Offen'?'open':'unknown';
  const disabled=score==null;
  const ascent=Number.isFinite(location.ascentMeters)?`${n(location.ascentMeters)} m`:'Nicht hinterlegt';
  const travel=Number.isFinite(location.travelTimeMinutes)?`${n(location.travelTimeMinutes/60,1)} h`:'Nicht hinterlegt';
  return `<article class="tour-card ${disabled?'is-disabled':''}" data-id="${esc(location.id)}" tabindex="0" role="button" aria-label="Details zu ${esc(location.name)}"><div class="tour-main"><div class="tour-card-header"><div class="tour-card-ident"><span class="rank">${disabled?'—':result.complete?String(rank).padStart(2,'0'):'≈'}</span><div class="tour-card-title"><div class="tour-location">${esc(location.range||location.region||'Region unbekannt')} · ${esc(location.country||'Land unbekannt')}</div><h3>${esc(location.name)}</h3></div></div><div class="card-highlights"><div class="score-wrap"><span class="status-icon ${result.status}">${iconByStatus[result.status]}</span><strong>${score??'–'}</strong><small>${result.complete?'WETTER':'TEILWERT'}</small></div></div></div><div class="card-facts" aria-label="Tourenfakten"><div class="route-fact difficulty-fact"><span>🧗</span><b>${esc(location.difficulty||'–')}</b><small>Schwierigkeit</small></div><div class="route-fact"><span>⏱</span><b>${esc(durationLabel(location))}</b><small>Gesamtzeit</small></div><div class="route-fact"><span>↑</span><b>${ascent}</b><small>Höhenmeter</small></div><div class="route-fact"><span>🚗</span><b>${travel}</b><small>Anfahrtszeit</small></div><div class="route-fact"><span>📍</span><b>${km==null?'–':`≈ ${n(km)} km`}</b><small>Luftlinie ab ${esc(origin.name)}</small></div></div><div class="card-badges"><span class="condition-label ${result.status}"><span class="condition-dot"></span>☀ ${conditionsLabel(result.status)}</span><span class="dashboard-closure-chip closure-${closureClass}">Wegstatus: ${esc(closureState)}${closure.manual?' · manuell':''}</span></div><div class="card-metrics"><div class="metric"><span class="metric-icon">⌁</span><span><b class="metric-value">${n(result.entry?.temp,1)}° / ${n(result.summit?.temp,1)}°</b><small>Tal / Berg</small></span></div><div class="metric"><span class="metric-icon">↗</span><span><b class="metric-value">${n(result.summit?.wind)} · Böen ${n(result.summit?.gusts)} km/h</b><small>Wind am Berg</small></span></div><div class="metric"><span class="metric-icon">◌</span><span><b class="metric-value"><span class="rain-badge rain-${rainClass}">${n(result.summit?.precipProb)}%</span> · ${n(result.summit?.precip,1)} mm</b><small>Regenprognose</small></span></div><div class="metric"><span class="metric-icon">☼</span><span><b class="metric-value">${n(result.entry?.sunshineHours,1)} h</b><small>Sonnenschein</small></span></div></div><div class="card-bottom"><div class="card-actions"><a class="tour-weather-history-link" href="${esc(historyUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Wetterrückblick für ${esc(location.name)} auf wetter.com">🌧️ Wetterrückblick (wetter.com)</a><a class="tour-admin-link" href="admin.html?id=${encodeURIComponent(location.id)}" aria-label="${esc(location.name)} im Admin bearbeiten">⚙ Bearbeiten</a></div></div>${result.reasons?.length?`<div class="reason-line"><span>Wetter:</span> ${esc(result.reasons.slice(0,2).join(' · '))}</div>`:''}</div></article>`;
}

function render(resetVisible=false, distanceIndex=null){
  if(!locations.length)return;
  if(resetVisible)visibleCount=PAGE_SIZE;
  const date=dateFor(activeDay), origin=origins[selectedOrigin], evaluations=evaluateDay(date);
  const distances=distanceIndex||recalculateDistances(selectedOrigin);
  const activeLocations=locations.filter(isRouteActive);
  const filtered=activeLocations.filter(location=>(!filters.difficulty||location.difficulty===filters.difficulty)&&(!filters.country||location.country===filters.country)&&(selectedRegions.size===availableRegions.length||selectedRegions.has(location.range))).filter(location=>{if(maxDistanceKm==null)return true;const distance=distances.get(location.id);return distance!==null&&distance<=maxDistanceKm;});
  const closedCount=filtered.filter(location=>closureLabel(location)==='Gesperrt').length,unknownCount=filtered.filter(location=>closureLabel(location)==='Unbekannt').length;
  const recommended=filtered.filter(location=>closureLabel(location)!=='Gesperrt');
  const ranked=recommended.map(location=>({location,result:evaluations[location.id],km:distances.get(location.id)})).sort((a,b)=>{
    const byDistance=(a.km??Infinity)-(b.km??Infinity);
    if(sortMode==='distance')return byDistance||((b.result.score??-1)-(a.result.score??-1));
    const byWeather=()=>{
      if(a.result.complete!==b.result.complete)return a.result.complete?-1:1;
      if(a.result.score==null&&b.result.score!=null)return 1;if(b.result.score==null&&a.result.score!=null)return -1;
      return Number.isFinite(a.result.score)&&Number.isFinite(b.result.score)?b.result.score-a.result.score:0;
    };
    const weatherDifference=byWeather();
    if(sortMode==='weather')return weatherDifference;
    if(!Number.isFinite(a.result.score)||!Number.isFinite(b.result.score))return Number.isFinite(a.result.score)||Number.isFinite(b.result.score)?weatherDifference:sortMode==='combined'?byDistance:weatherDifference;
    if(a.result.complete!==b.result.complete||Math.abs(a.result.score-b.result.score)>5)return weatherDifference;
    // Wetter bleibt führend. Entfernung kann nur Abstände bis maximal fünf Scorepunkte ausgleichen.
    const distanceBonus=km=>km==null?0:Math.max(0,5-Math.min(km,500)/100);
    const priorityDifference=(b.result.score+distanceBonus(b.km))-(a.result.score+distanceBonus(a.km));
    return priorityDifference||byDistance;
  });
  const list=$('#tour-list');list.innerHTML=ranked.slice(0,visibleCount).map((item,index)=>makeCard(item.location,item.result,index+1,origin,item.km)).join('');
  const loadMore=$('#load-more-button'),remaining=Math.max(0,ranked.length-visibleCount);
  loadMore.hidden=remaining===0;
  loadMore.textContent=`Weitere Klettersteige anzeigen (${remaining} übrig)`;
  list.querySelectorAll('.tour-card').forEach(card=>{const show=()=>{const location=locations.find(item=>item.id===card.dataset.id);openDetails(location,evaluations[location.id],date,diagnostics[location.id]);};card.addEventListener('click',event=>{if(event.target.closest('a'))return;show();});card.addEventListener('keydown',event=>{if(event.target.closest('a'))return;if(event.key==='Enter'||event.key===' '){event.preventDefault();show();}});card.querySelectorAll('a').forEach(link=>link.addEventListener('click',event=>event.stopPropagation()));});
  $('#result-count').textContent=`${ranked.filter(item=>item.result.score!=null).length} mit Prognose`;
  $('#recommendation-title').textContent=activeDay===0?'Deine besten Touren':activeDay===1?'Touren für morgen':'Touren für übermorgen';
  $('#forecast-date').textContent=new Date(`${date}T12:00:00`).toLocaleDateString('de-AT',{weekday:'long',day:'numeric',month:'long'});
  $('#map-count').textContent=activeLocations.filter(location=>Number.isFinite(location.entry?.latitude)&&Number.isFinite(location.entry?.longitude)).length;
  updateMap(activeLocations,evaluations,origin,date,location=>openDetails(location,evaluations[location.id],date,diagnostics[location.id]));
  $('#result-count').textContent=`${ranked.length} Touren · ${ranked.filter(item=>item.result.score!=null).length} mit Wetterrang`;
  const closureNotice=$('#closure-notice'),hasClosureNotice=closedCount>0||unknownCount>0;closureNotice.hidden=closureNoticeDismissed||!hasClosureNotice;$('#closure-notice-text').textContent=[closedCount?`${closedCount} gesperrte Tour${closedCount===1?' wird':'en werden'} aus den Empfehlungen ausgeblendet.`:'',unknownCount?`Bei ${unknownCount} angezeigten Tour${unknownCount===1?' ist':'en ist'} der Sperrstatus unbekannt; das bedeutet nicht bestätigt offen.`:''].filter(Boolean).join(' ');
  renderDiagnostics();
}

function renderDiagnostics(){
  if(!diagnostics||!Object.keys(diagnostics).length)return;
  const yesno=value=>value?'Ja':'Nein';
  $('#diagnostic-rows').innerHTML=locations.map(l=>{const d=diagnostics[l.id]||{};return `<tr><td>${esc(l.name)}${isRouteActive(l)?'':' · Inaktiv'}</td><td>${yesno(d.entryGps)}</td><td>${yesno(d.summitGps)}</td><td>${yesno(d.entryElevation)}</td><td>${yesno(d.summitElevation)}</td><td>${yesno(d.entryLoaded)}</td><td>${yesno(d.summitLoaded)}</td><td>${esc(d.error||'–')}</td><td>${esc(d.quality||'Ausstehend')}</td></tr>`;}).join('');
  const values=Object.values(diagnostics),full=values.filter(d=>d.quality==='Vollständig').length,partial=values.filter(d=>d.quality==='Teilweise').length,none=values.filter(d=>d.quality==='Keine Wetterdaten').length,apiErrors=values.filter(d=>d.quality==='API-Fehler').length;
  const skipped=values.filter(d=>d.quality==='Gesperrt — Abfrage ausgelassen').length,inactive=locations.filter(location=>!isRouteActive(location)).length;
  const requests=lastRequests?` · ${lastRequests.total} API-Aufrufe (Wetter ${lastRequests.forecast}, Höhe ${lastRequests.elevation}) · ${lastRequests.cachedPoints} gecachte · ${lastRequests.newlyLoadedPoints} neu geladen · ${lastRequests.failedPoints} fehlgeschlagene Wetterpunkte`:'';
  $('#diagnostic-summary').textContent=`${locations.length} Touren · ${full} vollständig · ${partial} teilweise · ${none} ohne Wetterdaten · ${apiErrors} API-Fehler · ${skipped} gesperrt, nicht abgefragt · ${inactive} inaktiv${requests}`;
}

function fillFilter(id, values){
  const select=$(id);
  select.innerHTML=`<option value="">${id==='#country-filter'?'Alle Länder':'Alle Grade'}</option>`+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
  select.value=filters[id==='#country-filter'?'country':'difficulty'];
}

function initializeFilters(){
  fillFilter('#difficulty-filter',[...new Set(locations.map(item=>item.difficulty).filter(Boolean))].sort());
  fillFilter('#country-filter',[...new Set(locations.map(item=>item.country).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de')));
  initializeRegionFilter();
  for(const [key,id] of Object.entries({difficulty:'#difficulty-filter',country:'#country-filter'})) $(id).addEventListener('change',event=>{filters[key]=event.target.value;render(true);});
  initializeDistanceAndSort();
  $('#max-distance-filter').addEventListener('change',event=>{const value=event.target.value;maxDistanceKm=value===''?null:Number(value);persistDistanceAndSort();render(true);});
  $('#sort-mode-filter').addEventListener('change',event=>{sortMode=SORT_MODES.has(event.target.value)?event.target.value:'combined';persistDistanceAndSort();render(true);});
  $('#clear-filters').addEventListener('click',()=>{for(const key of Object.keys(filters)){filters[key]='';$(`#${key}-filter`).value='';}maxDistanceKm=null;sortMode='combined';$('#max-distance-filter').value='';$('#sort-mode-filter').value=sortMode;persistDistanceAndSort();selectedRegions=new Set(availableRegions);saveSelectedRegions();renderRegionOptions();updateRegionButton();render(true);});
}

function saveSelectedRegions(){try{localStorage.setItem(REGION_STORAGE_KEY,JSON.stringify([...selectedRegions]));}catch(error){console.warn('Regionenauswahl konnte nicht gespeichert werden:',error);}}

function initializeRegionFilter(){
  availableRegions=[...new Set(locations.map(item=>item.range).filter(value=>typeof value==='string'&&value.trim()))].sort((a,b)=>a.localeCompare(b,'de'));
  let saved=null;
  try{const raw=localStorage.getItem(REGION_STORAGE_KEY);if(raw!==null){const parsed=JSON.parse(raw);if(Array.isArray(parsed))saved=parsed.filter(value=>typeof value==='string');}}catch(error){console.warn('Gespeicherte Regionenauswahl ist ungültig:',error);}
  // Neu hinzugekommene Regionen werden automatisch in die gespeicherte Auswahl aufgenommen.
  selectedRegions=new Set(saved===null?availableRegions:[...saved.filter(region=>availableRegions.includes(region)),...availableRegions.filter(region=>!saved.includes(region))]);
  saveSelectedRegions();
  $('#region-filter-button').addEventListener('click',()=>$('#region-dialog').showModal());
  $('#region-dialog-close').addEventListener('click',()=>$('#region-dialog').close());
  $('#region-dialog').addEventListener('click',event=>{if(event.target===$('#region-dialog'))$('#region-dialog').close();});
  $('#select-all-regions').addEventListener('click',()=>setRegionSelection(availableRegions));
  $('#clear-all-regions').addEventListener('click',()=>setRegionSelection([]));
  $('#all-regions-checkbox').addEventListener('change',event=>setRegionSelection(event.target.checked?availableRegions:[]));
  renderRegionOptions();updateRegionButton();
}

function setRegionSelection(regions){selectedRegions=new Set(regions);saveSelectedRegions();renderRegionOptions();updateRegionButton();render(true);}

function renderRegionOptions(){
  const allCheckbox=$('#all-regions-checkbox');
  allCheckbox.checked=availableRegions.length>0&&selectedRegions.size===availableRegions.length;
  allCheckbox.indeterminate=selectedRegions.size>0&&selectedRegions.size<availableRegions.length;
  $('#region-options').innerHTML=availableRegions.map((region,index)=>`<label class="region-option" for="region-option-${index}"><input id="region-option-${index}" type="checkbox" value="${esc(region)}" ${selectedRegions.has(region)?'checked':''}><span>${esc(region)}</span></label>`).join('')||'<p class="region-empty">Keine Regionen vorhanden.</p>';
  $('#region-options').querySelectorAll('input').forEach(input=>input.addEventListener('change',()=>{if(input.checked)selectedRegions.add(input.value);else selectedRegions.delete(input.value);saveSelectedRegions();renderRegionOptions();updateRegionButton();render(true);}));
  $('#selected-region-count').textContent=`Ausgewählt: ${selectedRegions.size} ${selectedRegions.size===1?'Region':'Regionen'}`;
}

function updateRegionButton(){
  const button=$('#region-filter-button');
  button.textContent=selectedRegions.size===availableRegions.length?'Alle Regionen':selectedRegions.size===0?'Keine Regionen':`${selectedRegions.size} Regionen ausgewählt`;
  button.setAttribute('aria-label',`Regionenfilter: ${button.textContent}`);
}

async function refresh(force=false,retryPoints=null){
  if(isRefreshing)return;isRefreshing=true;$('#loading-state').hidden=true;$('#error-banner').hidden=true;
  try{const skipReasons=Object.fromEntries(locations.filter(location=>!isRouteActive(location)||effectiveClosure(location).status==='Gesperrt').map(location=>[location.id,isRouteActive(location)?'Gesperrt':'Inaktiv'])),skipIds=Object.keys(skipReasons);const result=await fetchForecasts(locations,{force,retryPoints,skipIds,skipReasons,existingForecasts:forecasts,onForecastProgress:(completed,total)=>{const state=$('#loading-state');state.querySelector('span:last-child').textContent=`Wetterdaten werden geladen … ${completed} von ${total} Wetterpunkten`;state.hidden=completed>=total;if(completed<total)$('#refresh-button').classList.add('spinning');}});forecasts=result.forecasts;diagnostics=result.diagnostics;saveWeatherSnapshot(diagnostics);lastRequests=result.requests;lastFetched=result.lastUpdatedAt||Date.now();$('#updated-label').textContent=result.lastUpdatedAt?`Wetterstand ${new Date(result.lastUpdatedAt).toLocaleString('de-AT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'Noch keine Wetterdaten';$('#weather-stats').textContent=`Cache ${result.requests.cachedPoints} · neu ${result.requests.newlyLoadedPoints} · Fehler ${result.requests.failedPoints}`;render(true);}
  catch(error){$('#error-banner').innerHTML=`<b>Wetterdaten gerade nicht erreichbar.</b> ${esc(error.message)} <span>Zwischengespeicherte Daten werden angezeigt, falls verfügbar.</span>`;$('#updated-label').textContent='Verbindung fehlgeschlagen';if(!Object.keys(forecasts).length)render();}
  finally{isRefreshing=false;$('#loading-state').hidden=true;$('#refresh-button').classList.remove('spinning');}
}

async function init(){
  try{const response=await fetch('data/locations.json');if(!response.ok)throw new Error(`Tourendatei konnte nicht geladen werden (HTTP ${response.status}).`);locations=mergeLocalDraft(await response.json()).routes;}
  catch(error){$('#loading-state').hidden=true;$('#error-banner').hidden=false;$('#error-banner').textContent=`${error.message} Bitte die Seite über GitHub Pages oder einen lokalen Webserver öffnen (file:// unterstützt kein JSON-Fetch).`;return;}
  await pageLoaded();
  initMap();
  initializeClosureNotice();
  initializeOrigin();
  initializeFilters();
  document.querySelectorAll('.day-tab').forEach(button=>button.addEventListener('click',()=>{activeDay=Number(button.dataset.day);document.querySelectorAll('.day-tab').forEach(tab=>{const active=tab===button;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));});render(true);}));
  $('#origin-select').addEventListener('change',event=>{
    const newOriginId=event.currentTarget.value;
    if(!Object.prototype.hasOwnProperty.call(origins,newOriginId)){event.currentTarget.value=selectedOrigin;return;}
    saveSelectedOrigin(newOriginId);
    const updatedDistanceIndex=recalculateDistances(selectedOrigin);
    visibleCount=PAGE_SIZE;
    render(true,updatedDistanceIndex);
  });
  $('#load-more-button').addEventListener('click',()=>{visibleCount=Math.min(visibleCount+PAGE_SIZE,locations.length);render();});
  $('#refresh-button').addEventListener('click',()=>refresh(true));
  $('#retry-failed-button').addEventListener('click',()=>{const failed=locations.filter(l=>isRouteActive(l)&&effectiveClosure(l).status!=='Gesperrt').flatMap(l=>{const d=diagnostics[l.id];return ['entry','summit'].filter(k=>d?.[`${k}Gps`]&&(d[`${k}Error`]||!d[`${k}Loaded`])).map(k=>`${l.id}:${k}`);});if(failed.length)refresh(true,failed);});
  await refresh(false);
}

init();
