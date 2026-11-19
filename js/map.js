const COLORS = { excellent:'#5c8a60', good:'#8ba86c', limited:'#d5a24b', bad:'#c86b54', unknown:'#98a19a' };
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let map, markerLayer, originMarker;

export function initMap() {
  const node = document.getElementById('map');
  if (!node) return;
  if (!window.L) { node.innerHTML = '<div class="map-fallback">Karte konnte nicht geladen werden.</div>'; return; }
  map = L.map(node, { scrollWheelZoom:false, zoomControl:false }).setView([47.55,13.35],8);
  L.control.zoom({ position:'bottomright' }).addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:19, attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

export function updateMap(locations, evaluations, origin, date, onOpen) {
  if (!map || !markerLayer) return;
  markerLayer.clearLayers(); const bounds=[];
  locations.forEach(location => {
    const point=coordinatesOf(location.entry);
    if (!point) return;
    const status=evaluations[location.id]?.status || 'unknown';
    const marker=L.circleMarker([point.latitude,point.longitude],{radius:9,color:'#fff',weight:3,fillColor:COLORS[status],fillOpacity:1});
    const effective=effectiveClosure(location),closed=effective.status==='Gesperrt';
    marker.bindPopup(`<b>${esc(location.name)}</b><br>${esc(location.difficulty)} · ${evaluations[location.id]?.score ?? '–'} Wetterpunkte<br>${location.entry?.verified===true?'':'<small>GPS-Position nicht verifiziert</small><br>'}<strong>Wegstatus: ${esc(effective.status||'Unbekannt')}</strong><br>${closed?'Nicht als Tourenempfehlung verfügbar.':' '}<button class="popup-link" type="button">Details ansehen →</button>`);
    marker.on('popupopen',()=>{ const button=marker.getPopup().getElement().querySelector('.popup-link'); button?.addEventListener('click',()=>onOpen(location)); });
    marker.addTo(markerLayer); bounds.push([point.latitude,point.longitude]);
  });
  if (originMarker) map.removeLayer(originMarker);
  const validOrigin=coordinatesOf(origin);
  if(validOrigin){originMarker=L.circleMarker([validOrigin.latitude,validOrigin.longitude],{radius:8,color:'#fff',weight:3,fillColor:'#263d33',fillOpacity:1}).bindPopup(`<b>${esc(origin.name)}</b><br>Dein Ausgangspunkt`).addTo(map);bounds.push([validOrigin.latitude,validOrigin.longitude]);}
  if(bounds.length) map.fitBounds(bounds,{padding:[28,28],maxZoom:9});
  setTimeout(()=>map.invalidateSize(),80);
}
import { effectiveClosure } from './admin-data.js';
import { coordinatesOf } from './distance.js';

