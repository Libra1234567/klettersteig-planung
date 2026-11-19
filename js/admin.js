import {CLOSURE_STATUSES,defaultClosure,effectiveClosure,isRouteActive,mergeLocalDraft,routeClosure,saveLocalDraft,weatherSnapshot} from './admin-data.js';
import {initRouteImport} from './route-import.js';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const validPoint=p=>Number.isFinite(p?.latitude)&&p.latitude>=-90&&p.latitude<=90&&Number.isFinite(p?.longitude)&&p.longitude>=-180&&p.longitude<=180;
const slug=value=>String(value||'klettersteig').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'klettersteig';
const isoToday=()=>new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Vienna'});
const formatDate=value=>value?new Date(`${value}T12:00:00`).toLocaleDateString('de-AT',{day:'2-digit',month:'2-digit',year:'numeric'}):'–';
let baseline=[],routes=[],weather=weatherSnapshot(),conflict=false,editingId=null,isNew=false,editingActive=true;
let filters={country:'',region:'',difficulty:'',closure:'',gps:'',weather:'',query:''};

function say(message,type='info'){const node=$('#admin-notice');node.textContent=message;node.className=`admin-notice ${type}`;node.hidden=false;}
function save(){if(!saveLocalDraft(baseline,routes)){say('Der Browser konnte die lokalen Änderungen nicht speichern. Prüfe freien Speicherplatz oder exportiere die Daten jetzt.','error');return false;}weather=weatherSnapshot();render();return true;}
function closure(route){return effectiveClosure(route);}
function gpsState(route){const a=validPoint(route.entry),b=validPoint(route.summit);return a&&b?'complete':a||b?'partial':'missing';}
function weatherState(route){const d=weather?.diagnostics?.[route.id];if(!d)return'missing';const a=!!d.entryLoaded,b=!!d.summitLoaded;return a&&b?'complete':a||b?'partial':'missing';}
function stateText(state){return({complete:'Vollständig',partial:'Teilweise',missing:'Fehlend'})[state]||'Fehlend';}
function closureClass(status){return({'Offen':'open','Gesperrt':'closed','Teilweise gesperrt':'partial-closed','Eingeschränkt':'restricted','Unbekannt':'unknown'})[status]||'unknown';}
function gpsText(route){const state=gpsState(route);return `${stateText(state)}${state!=='missing'&&((validPoint(route.entry)&&route.entry.verified===false)||(validPoint(route.summit)&&route.summit.verified===false))?' · unbestätigt':''}`;}
function weatherText(route){return stateText(weatherState(route));}
function checkedDate(route){return closure(route).checkedAt||'';}
function filteredRoutes(){return routes.filter(route=>{
  const status=closure(route).status||'Unbekannt',gps=gpsState(route),wx=weatherState(route);
  return(!filters.query||route.name?.toLocaleLowerCase('de').includes(filters.query.toLocaleLowerCase('de')))&&(!filters.country||route.country===filters.country)&&(!filters.region||route.range===filters.region)&&(!filters.difficulty||route.difficulty===filters.difficulty)&&(!filters.closure||status===filters.closure)&&(!filters.gps||gps===filters.gps)&&(!filters.weather||wx===filters.weather);
});}

function rowMarkup(route){const status=closure(route).status||'Unbekannt';return `<tr><td><strong>${esc(route.name)}</strong>${isRouteActive(route)?'':'<small class="admin-inactive-note">Inaktiv · im Dashboard ausgeblendet</small>'}<small>${esc(route.difficulty||'–')}</small></td><td>${esc(route.range||'–')}<small>${esc(route.country||'–')}</small></td><td><span class="admin-chip gps-${gpsState(route)}">${esc(gpsText(route))}</span></td><td><span class="admin-chip wx-${weatherState(route)}">${esc(weatherText(route))}</span></td><td><span class="admin-chip closure-${closureClass(status)}">${esc(status)}${closure(route).manual?' · manuell':''}</span></td><td>${formatDate(checkedDate(route))}</td><td><button class="row-edit" data-edit="${esc(route.id)}" type="button">Bearbeiten</button></td></tr>`;}
function cardMarkup(route){const status=closure(route).status||'Unbekannt';const check=checkedDate(route);return `<article class="admin-route-card"><div class="admin-route-heading"><div><h3>${esc(route.name)}</h3><p>${esc(route.difficulty||'–')} · ${esc(route.range||'–')} · ${esc(route.country||'–')}</p></div><div class="admin-route-badges"><span class="admin-active-chip ${isRouteActive(route)?'is-active':'is-inactive'}">${isRouteActive(route)?'Aktiv':'Inaktiv'}</span><span class="admin-chip closure-${closureClass(status)}">${esc(status)}${closure(route).manual?' · manuell':''}</span></div></div><div class="admin-route-states"><span><small>GPS</small><b>${esc(gpsText(route))}</b></span><span><small>Wetter</small><b>${esc(weatherText(route))}</b></span><span><small>Letzte Prüfung</small><b>${formatDate(check)}</b></span></div><button class="admin-button secondary card-edit" data-edit="${esc(route.id)}" type="button">Klettersteig bearbeiten</button></article>`;}
function render(){const list=filteredRoutes();$('#admin-table-body').innerHTML=list.map(rowMarkup).join('');$('#admin-card-list').innerHTML=list.map(cardMarkup).join('');$('#admin-empty').hidden=list.length>0;$('#visible-count').textContent=`${list.length} von ${routes.length}`;
  const closed=routes.filter(r=>closure(r).status==='Gesperrt').length,unknown=routes.filter(r=>closure(r).status==='Unbekannt').length,missingGps=routes.filter(r=>gpsState(r)!=='complete').length,inactive=routes.filter(r=>!isRouteActive(r)).length;
  $('#admin-summary').innerHTML=`<div><strong>${routes.length}</strong><span>Klettersteige</span></div><div><strong>${inactive}</strong><span>inaktiv</span></div><div><strong>${closed}</strong><span>gesperrt</span></div><div><strong>${unknown}</strong><span>Status unbekannt</span></div><div><strong>${missingGps}</strong><span>GPS unvollständig</span></div><div><strong>${weather.savedAt?formatDate(weather.savedAt.slice(0,10)):'–'}</strong><span>letzter Wetterlauf</span></div>`;
  document.querySelectorAll('[data-edit]').forEach(button=>button.addEventListener('click',()=>openEditor(button.dataset.edit)));
}
function fillSelect(selector,values,first){const select=$(selector),previous=select.value;select.innerHTML=`<option value="">${esc(first)}</option>`+[...new Set(values.filter(Boolean))].sort((a,b)=>a.localeCompare(b,'de')).map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if([...select.options].some(option=>option.value===previous))select.value=previous;}
function initFilters(){fillSelect('#country-filter',routes.map(r=>r.country),'Alle Länder');fillSelect('#region-filter',routes.map(r=>r.range),'Alle Regionen');fillSelect('#difficulty-filter',routes.map(r=>r.difficulty),'Alle Grade');fillSelect('#closure-filter',CLOSURE_STATUSES,'Alle Status');
  for(const [key,id] of Object.entries({country:'#country-filter',region:'#region-filter',difficulty:'#difficulty-filter',closure:'#closure-filter',gps:'#gps-filter',weather:'#weather-filter'}))$(id).addEventListener('change',e=>{filters[key]=e.target.value;render();});
  $('#search-filter').addEventListener('input',e=>{filters.query=e.target.value;render();});
}
function setInput(id,value){$(id).value=value??'';}
function openEditor(id){const route=routes.find(r=>r.id===id);if(!route)return;editingId=id;isNew=false;fillEditor(route);$('#form-title').textContent='Klettersteig bearbeiten';$('#delete-button').hidden=false;$('#duplicate-button').hidden=false;$('#edit-dialog').showModal();}
function openNew(){editingId=null;isNew=true;fillEditor({id:'',name:'',difficulty:'',range:'',country:'',description:'',entry:{},summit:{},rating:null,active:true,links:[],approachMinutes:null,climbMinutes:null,descentMinutes:null,durationMinutes:null,closure:defaultClosure()});$('#route-import-url').value='';$('#route-import-status').textContent='';$('#route-import-results').hidden=true;$('#form-title').textContent='Neuen Klettersteig anlegen';$('#delete-button').hidden=true;$('#duplicate-button').hidden=true;$('#edit-dialog').showModal();}
function updateActiveToggle(){const button=$('#route-active-toggle');button.classList.toggle('is-active',editingActive);button.classList.toggle('is-inactive',!editingActive);button.setAttribute('aria-pressed',String(editingActive));button.textContent=editingActive?'● Aktiv':'● Inaktiv – ausgeblendet';}
function fillEditor(route){$('#form-error').hidden=true;$('#route-import-panel').hidden=!isNew;for(const input of document.querySelectorAll('#route-form .import-unverified')){input.classList.remove('import-unverified');input.removeAttribute('title');}const c=routeClosure(route);editingActive=isRouteActive(route);updateActiveToggle();setInput('#route-id',route.id);setInput('#route-name',route.name);setInput('#route-difficulty',route.difficulty);setInput('#route-range',route.range);setInput('#route-country',route.country);setInput('#route-rating',route.rating);setInput('#route-description',route.description);
  setInput('#entry-lat',route.entry?.latitude);setInput('#entry-lon',route.entry?.longitude);setInput('#entry-elevation',route.entry?.elevation);$('#entry-verified').checked=route.entry?.verified===true;
  setInput('#entry-source',route.entry?.source);setInput('#entry-verification-note',route.entry?.verificationNote);
  setInput('#summit-lat',route.summit?.latitude);setInput('#summit-lon',route.summit?.longitude);setInput('#summit-elevation',route.summit?.elevation);$('#summit-verified').checked=route.summit?.verified===true;setInput('#summit-source',route.summit?.source);setInput('#summit-verification-note',route.summit?.verificationNote);
  for(const [field,id] of [['approachMinutes','#approach-minutes'],['climbMinutes','#climb-minutes'],['descentMinutes','#descent-minutes'],['durationMinutes','#duration-minutes']])setInput(id,route[field]);
  setInput('#route-links',(route.links||[]).map(link=>`${link.label||''} | ${link.url||''}`).join('\n'));
  $('#closure-status').innerHTML=CLOSURE_STATUSES.map(status=>`<option>${esc(status)}</option>`).join('');setInput('#closure-status',c.status);setInput('#closure-source-type',c.sourceType);setInput('#closure-reason',c.reason);setInput('#closure-from',c.validFrom);setInput('#closure-until',c.validTo);setInput('#closure-source',c.source);setInput('#closure-checked',c.checkedAt);$('#closure-manual').checked=c.manual===true;setInput('#closure-note',c.note);
  const auto=c.automatic;$('#automatic-note').textContent=auto?.status?`Automatischer Quellenfund: ${auto.status}${auto.source?` · ${auto.source}`:''}${auto.checkedAt?` · geprüft ${formatDate(auto.checkedAt)}`:''}. Eine manuelle Festlegung hat Vorrang.`:'Automatische Web-Recherche ist auf GitHub Pages nicht zuverlässig möglich: externe Tourenseiten blockieren Browserzugriffe häufig per CORS. Es wird daher kein Status automatisch geraten. Öffne die verlinkten Quellen, prüfe sie und erfasse Status, Quelle und Prüfdatum.';
}
function numberOrNull(selector){const value=$(selector).value.trim();if(!value)return null;const number=Number(value);return Number.isFinite(number)?number:null;}
function pointFromForm(prefix,old={}){const latitude=numberOrNull(`#${prefix}-lat`),longitude=numberOrNull(`#${prefix}-lon`),elevation=numberOrNull(`#${prefix}-elevation`);return{...old,latitude,longitude,elevation,verified:$('#'+prefix+'-verified').checked,source:$('#'+prefix+'-source').value.trim(),verificationNote:$('#'+prefix+'-verification-note').value.trim(),label:old.label||''};}
function linksFromForm(){return $('#route-links').value.split('\n').map(line=>line.trim()).filter(Boolean).map((line,index)=>{const parts=line.split('|');const label=(parts.shift()||'').trim(),url=parts.join('|').trim();if(!label||!/^https?:\/\//i.test(url))throw new Error(`Externer Link in Zeile ${index+1} braucht eine Bezeichnung und eine http(s)-URL.`);return{label,url};});}
function readForm(old={}){const name=$('#route-name').value.trim(),difficulty=$('#route-difficulty').value.trim(),range=$('#route-range').value.trim(),country=$('#route-country').value.trim();if(!name||!difficulty||!range||!country)throw new Error('Name, Schwierigkeit, Region und Land sind Pflichtfelder.');
  const id=old.id||slug(name),entry=pointFromForm('entry',old.entry),summit=pointFromForm('summit',old.summit);for(const [label,p] of [['Einstieg',entry],['Gipfel/Ausstieg',summit]]){if((p.latitude==null)!==(p.longitude==null))throw new Error(`${label}: Latitude und Longitude müssen gemeinsam eingetragen werden.`);if(p.latitude!=null&&(p.latitude < -90||p.latitude>90||p.longitude < -180||p.longitude>180))throw new Error(`${label}: Koordinate liegt außerhalb des gültigen Wertebereichs.`);}
  const rating=numberOrNull('#route-rating');if(rating!=null&&(rating<0||rating>5))throw new Error('Bewertung muss zwischen 0 und 5 liegen.');const oldClosure=routeClosure(old);
  return{...old,id,name,difficulty,range,country,description:$('#route-description').value.trim(),entry,summit,approachMinutes:numberOrNull('#approach-minutes'),climbMinutes:numberOrNull('#climb-minutes'),descentMinutes:numberOrNull('#descent-minutes'),durationMinutes:numberOrNull('#duration-minutes'),rating,active:editingActive,links:linksFromForm(),closure:{...oldClosure,status:$('#closure-status').value,sourceType:$('#closure-source-type').value,reason:$('#closure-reason').value.trim(),validFrom:$('#closure-from').value||'',validTo:$('#closure-until').value||'',source:$('#closure-source').value.trim(),checkedAt:$('#closure-checked').value||'',manual:$('#closure-manual').checked,note:$('#closure-note').value.trim()}};
}
function persistForm(event){event.preventDefault();$('#form-error').hidden=true;try{const old=routes.find(r=>r.id===editingId)||{};let route=readForm(old);if(isNew){let id=route.id,suffix=2;while(routes.some(r=>r.id===id))id=`${route.id}-${suffix++}`;route.id=id;routes.push(route);}else routes=routes.map(r=>r.id===editingId?route:r);if(save())$('#edit-dialog').close();}catch(error){$('#form-error').textContent=error.message;$('#form-error').hidden=false;}}
function duplicateCurrent(){const original=routes.find(r=>r.id===editingId);if(!original)return;let copy=structuredClone(original);copy.id=`${slug(copy.name)}-kopie`;let n=2;while(routes.some(r=>r.id===copy.id))copy.id=`${slug(copy.name)}-kopie-${n++}`;copy.name=`${copy.name} (Kopie)`;copy.active=true;copy.closure=defaultClosure();routes.push(copy);save();$('#edit-dialog').close();openEditor(copy.id);}
function deleteCurrent(){const route=routes.find(r=>r.id===editingId);if(!route)return;if(!window.confirm(`„${route.name}“ wirklich löschen? Diese Änderung wird erst nach JSON-Export und Veröffentlichung für andere Geräte übernommen.`))return;routes=routes.filter(r=>r.id!==editingId);save();$('#edit-dialog').close();}
function validateDataset(value){if(!Array.isArray(value))throw new Error('JSON muss ein Array von Klettersteigen enthalten.');const ids=new Set();for(const [index,route] of value.entries()){if(!route||typeof route!=='object'||!route.id||!route.name)throw new Error(`Datensatz ${index+1}: ID oder Name fehlt.`);if(ids.has(route.id))throw new Error(`Doppelte ID: ${route.id}`);ids.add(route.id);if(!route.entry||!route.summit)throw new Error(`${route.name}: Einstieg und Gipfel/Ausstieg müssen als Objekte vorhanden sein.`);if(route.active!=null&&typeof route.active!=='boolean')throw new Error(`${route.name}: active muss true oder false sein.`);}return value;}
function exportJson(){const blob=new Blob([JSON.stringify(routes,null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='locations.json';link.click();URL.revokeObjectURL(url);say(`JSON exportiert (${routes.length} Klettersteige). Ersetze damit data/locations.json im Repository und veröffentliche den Commit.`,'success');}
async function importJson(file){if(!file)return;try{const parsed=validateDataset(JSON.parse(await file.text()));if(!window.confirm(`${parsed.length} Datensätze importieren und den aktuellen lokalen Arbeitsstand ersetzen? Exportiere zuerst, falls du ihn behalten willst.`))return;routes=structuredClone(parsed);if(save())say('JSON lokal importiert. Der Datensatz ist noch nicht im GitHub-Repository veröffentlicht.','success');}catch(error){say(`Import abgebrochen: ${error.message}`,'error');}finally{$('#import-file').value='';}}
function events(){initFilters();initRouteImport();$('#route-active-toggle').addEventListener('click',()=>{editingActive=!editingActive;updateActiveToggle();});$('#add-button').addEventListener('click',openNew);$('#route-form').addEventListener('submit',persistForm);$('#close-dialog').addEventListener('click',()=>$('#edit-dialog').close());$('#cancel-button').addEventListener('click',()=>$('#edit-dialog').close());$('#delete-button').addEventListener('click',deleteCurrent);$('#duplicate-button').addEventListener('click',duplicateCurrent);$('#export-button').addEventListener('click',exportJson);$('#import-button').addEventListener('click',()=>$('#import-file').click());$('#import-file').addEventListener('change',event=>importJson(event.target.files[0]));$('#edit-dialog').addEventListener('click',event=>{if(event.target===$('#edit-dialog'))$('#edit-dialog').close();});}
async function init(){
  try{
    const response=await fetch('data/locations.json');
    if(!response.ok)throw new Error(`Stammdaten nicht geladen (HTTP ${response.status}).`);
    baseline=validateDataset(await response.json());
    const merged=mergeLocalDraft(baseline);
    routes=merged.routes;
    conflict=merged.conflict;
    weather=weatherSnapshot();
    if(merged.recoveredEmptyDraft)say('Der lokale Verwaltungsentwurf war leer. Die Touren wurden wieder aus locations.json geladen.','warning');
    else if(merged.recoveredDraft)say('Der lokale Verwaltungsentwurf war ungültig. Die Touren wurden aus locations.json geladen.','warning');
    else if(conflict)say('Die veröffentlichte JSON-Datei wurde seit dem letzten lokalen Speichern verändert. Lokale Datensatzänderungen wurden erhalten und lokal darübergelegt. Prüfe Konflikte vor dem Export.','warning');
    events();
    render();

    const params=new URLSearchParams(window.location.search);
    const requested=params.get('id')||params.get('tour');
    if(requested){
      let route=routes.find(item=>item.id===requested||item.name===requested);
      if(!route){
        route=baseline.find(item=>item.id===requested||item.name===requested);
        if(route){routes.push(structuredClone(route));render();}
      }
      if(route)openEditor(route.id);
      else say(`Kein Klettersteig mit der ID „${requested}“ gefunden.`,'warning');
    }
  }catch(error){say(`${error.message} Öffne die Seite über GitHub Pages oder einen lokalen Webserver.`,'error');}
}
init();
