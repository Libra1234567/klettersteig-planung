const CACHE_KEY = 'steigwetter-cache-v3';
const TTL = 60 * 60 * 1000;
const ELEVATION_TTL = 30 * 24 * 60 * 60 * 1000;
export const HOURLY = ['temperature_2m','precipitation_probability','precipitation','rain','snowfall','snow_depth','wind_speed_10m','wind_direction_10m','wind_gusts_10m','cape','cloud_cover','sunshine_duration','weather_code'];

function readCache(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function writeCache(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ } }
const validPoint = point => Number.isFinite(point?.latitude) && point.latitude >= -90 && point.latitude <= 90 && Number.isFinite(point?.longitude) && point.longitude >= -180 && point.longitude <= 180;
const hasCoordinates = point => point?.latitude != null || point?.longitude != null;
const coordKey = point => `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;

async function requestElevation(points, stats) {
  const store = readCache('steigwetter-elevation-v1'), now = Date.now(), missing = [...new Map(points.filter(p => p.point.elevation == null).map(p => [coordKey(p.point), p])).values()].filter(p => !store[coordKey(p.point)] || now-store[coordKey(p.point)].at >= ELEVATION_TTL);
  if (!missing.length) return;
  for (let offset=0; offset<missing.length; offset+=100) {
    const batch=missing.slice(offset,offset+100);
    try {
      stats.elevation++;
      const qs=new URLSearchParams({latitude:batch.map(p=>p.point.latitude).join(','),longitude:batch.map(p=>p.point.longitude).join(',')});
      const response=await fetch(`https://api.open-meteo.com/v1/elevation?${qs}`,{headers:{Accept:'application/json'}});
      if(!response.ok) throw new Error(`Elevation API HTTP ${response.status}`);
      const payload=await response.json(), values=payload?.elevation;
      if(!Array.isArray(values)||values.length!==batch.length) throw new Error(`Ungültige Höhenantwort (${Array.isArray(values)?values.length:'kein Array'}/${batch.length})`);
      values.forEach((raw,i)=>{const value=raw==null?NaN:Number(raw);if(Number.isFinite(value)){store[coordKey(batch[i].point)]={value,at:now};}else{batch[i].diag[`${batch[i].pointName}ElevationError`]='Open-Meteo lieferte für diesen Punkt keine Höhe';}});
    } catch(error) { stats.elevationFailed++;console.warn('Höhenabfrage fehlgeschlagen:',error); batch.forEach(p=>{p.diag[`${p.pointName}ElevationError`]=error.message;stats.errors[`${p.locationId}:${p.pointName}:elevation`]=error.message;}); }
  }
  writeCache('steigwetter-elevation-v1',store);
}

export async function fetchForecasts(locations, options = {}) {
  if(typeof options==='boolean') options={force:options};
  const {force=false,retryPoints=null,existingForecasts={},onForecastProgress,skipIds=[],skipReasons={}}=options||{}, skippedIds=new Set(skipIds), forecasts={...existingForecasts}, stats={forecast:0,elevation:0,forecastFailed:0,elevationFailed:0,cachedPoints:0,newlyLoadedPoints:0,errors:{}}, valid=[];
  const diagnostics=Object.fromEntries(locations.map(l=>[l.id,{id:l.id,name:l.name,entryGps:validPoint(l.entry),summitGps:validPoint(l.summit),entryElevation:Number.isFinite(l.entry?.elevation),summitElevation:Number.isFinite(l.summit?.elevation),entryLoaded:false,summitLoaded:false,entryError:null,summitError:null,entryInvalid:false,summitInvalid:false,quality:'Unvollständig'}]));
  for(const location of locations) for(const pointName of ['entry','summit']) {
    const point=location[pointName], diag=diagnostics[location.id];
    if(!validPoint(point)){const invalid=hasCoordinates(point);diag[`${pointName}Invalid`]=invalid;diag[`${pointName}Error`]=invalid?'Ungültige GPS-Koordinaten':'GPS-Koordinaten fehlen';continue;}
    const cachedForecast=forecasts[location.id]?.[pointName], retryThis=retryPoints?.includes(`${location.id}:${pointName}`);
    if(cachedForecast&&(!force||Array.isArray(retryPoints)&&!retryThis)){diag[`${pointName}Loaded`]=true;stats.cachedPoints++;continue;}
    valid.push({locationId:location.id,pointName,point,diag,skipFetch:skippedIds.has(location.id)});
  }
  await requestElevation(valid.filter(item=>!item.skipFetch),stats);
  const elevationCache=readCache('steigwetter-elevation-v1');
  const pointByKey=new Map();
  for(const item of valid){const elev=item.point.elevation??elevationCache[coordKey(item.point)]?.value; item.elevation=elev;item.elevationSource=item.point.elevationSource|| (item.point.elevation!=null?'Tourendaten':Number.isFinite(elev)?'Open-Meteo Elevation API':'Open-Meteo Modellhöhe'); item.key=`${coordKey(item.point)}:${Number.isFinite(elev)?Math.round(elev):'nan'}`;item.cacheKey=`${item.locationId}:${item.pointName}:${item.key}`;(pointByKey.get(item.key)||pointByKey.set(item.key,[]).get(item.key)).push(item);}
  const unique=[...pointByKey.values()].map(items=>items[0]), cache=readCache(CACHE_KEY), now=Date.now(), pending=[];
  for(const key of Object.keys(cache))if(!cache[key]?.at||now-cache[key].at>=TTL)delete cache[key];
  for(const item of unique){const targets=pointByKey.get(item.key),skipOnly=targets.every(target=>target.skipFetch),retryThis=targets.some(target=>retryPoints?.includes(`${target.locationId}:${target.pointName}`)),useCache=skipOnly||!force||Array.isArray(retryPoints)&&!retryThis,saved=useCache&&targets.map(target=>cache[target.cacheKey]).find(entry=>entry?.at&&now-entry.at>=0&&now-entry.at<TTL);if(saved){for(const target of targets){(forecasts[target.locationId]||={})[target.pointName]=saved.data;target.diag[`${target.pointName}Loaded`]=true;cache[target.cacheKey]={at:saved.at,data:saved.data};stats.cachedPoints++;}continue;}if(skipOnly){for(const target of targets)target.diag.skipped=true;continue;}pending.push(item);}
  let completedPoints=0;
  const reportForecastProgress=()=>{if(pending.length)onForecastProgress?.(completedPoints,pending.length);};
  reportForecastProgress();
  async function fetchBatch(batch){
    stats.forecast++;
    try{
      const qs=new URLSearchParams({latitude:batch.map(p=>p.point.latitude).join(','),longitude:batch.map(p=>p.point.longitude).join(','),elevation:batch.map(p=>Number.isFinite(p.elevation)?Math.round(p.elevation):'nan').join(','),hourly:HOURLY.join(','),daily:'sunrise,sunset,sunshine_duration,precipitation_probability_max',forecast_days:'4',timezone:'auto',wind_speed_unit:'kmh'});
      const response=await fetch(`https://api.open-meteo.com/v1/forecast?${qs}`,{headers:{Accept:'application/json'}});
      if(!response.ok)throw new Error(`Wetter API HTTP ${response.status}`);
      const payload=await response.json(),items=Array.isArray(payload)?payload:[payload];
      if(items.length!==batch.length)throw new Error(`Unerwartete Antwortanzahl (${items.length}/${batch.length})`);
      const validated=items.map((data,i)=>{const hourly=data?.hourly,time=hourly?.time;if(!Array.isArray(time)||!time.length||time.some(t=>typeof t!=='string'||!t.includes('T')))throw new Error(`Ungültige oder fehlende Zeitreihe für ${batch[i].key}`);let validValues=0;for(const field of HOURLY){const values=hourly[field];if(values==null)continue;if(!Array.isArray(values)||values.length!==time.length||values.some(v=>v!=null&&!Number.isFinite(v)))throw new Error(`Ungültige Wetterwerte (${field}) für ${batch[i].key}`);validValues+=values.filter(Number.isFinite).length;}if(!validValues)throw new Error(`Keine gültigen Wetterwerte für ${batch[i].key}`);return data;});
      validated.forEach((data,i)=>{const item=batch[i],at=Date.now();data.elevationSource=item.elevationSource;for(const target of pointByKey.get(item.key)){cache[target.cacheKey]={at,data};(forecasts[target.locationId]||={})[target.pointName]=data;target.diag[`${target.pointName}Loaded`]=true;stats.newlyLoadedPoints++;}});
    }catch(error){stats.forecastFailed++;throw error;}
  }
  const batches=[];for(let i=0;i<pending.length;i+=40)batches.push(pending.slice(i,i+40));
  await Promise.all(batches.map(async batch=>{
    try{await fetchBatch(batch);completedPoints+=batch.length;reportForecastProgress();}
    catch(error){const reason=error?.message||'Unbekannter API-Fehler';console.warn('Gebündelte Wetterabfrage fehlgeschlagen; versuche Einzelabfragen:',reason);const retry=await Promise.allSettled(batch.map(item=>fetchBatch([item])));retry.forEach((result,i)=>{if(result.status==='rejected'){const item=batch[i];stats.errors[`${item.locationId}:${item.pointName}`]=result.reason?.message||reason;item.diag[`${item.pointName}Error`]=stats.errors[`${item.locationId}:${item.pointName}`];console.warn(`Wetter für ${item.locationId} (${item.pointName}) fehlgeschlagen:`,result.reason);}});completedPoints+=batch.length;reportForecastProgress();}
  }));
  writeCache(CACHE_KEY,cache);
  for(const location of locations){const d=diagnostics[location.id], entry=forecasts[location.id]?.entry,summit=forecasts[location.id]?.summit; d.entryLoaded=!!entry;d.summitLoaded=!!summit;d.entryElevation=Number.isFinite(location.entry?.elevation)||Number.isFinite(entry?.elevation);d.summitElevation=Number.isFinite(location.summit?.elevation)||Number.isFinite(summit?.elevation);const hasGps=d.entryGps||d.summitGps,hasApiError=!!(d.entryGps&&d.entryError||d.summitGps&&d.summitError),skipReason=skipReasons[location.id]||(skippedIds.has(location.id)?'Gesperrt':null);d.quality=hasApiError?'API-Fehler':entry&&summit?'Vollständig':entry||summit?'Teilweise':skipReason?`${skipReason} — Abfrage ausgelassen`:hasGps?'API-Fehler':'Keine Wetterdaten';d.error=!hasGps?'Keine GPS-Koordinaten vorhanden':[...new Set([d.entryError,d.summitError].filter(Boolean))].join(' · ')||(skipReason&&(!entry||!summit)?`Wetter wegen ${skipReason.toLowerCase()} nicht aktualisiert`:!entry&&!summit?'Keine Wetterprognose verfügbar':null);}
  const failed=stats.forecastFailed+stats.elevationFailed;
  const timestamps=valid.map(item=>cache[item.cacheKey]?.at).filter(Number.isFinite);
  const failedPoints=Object.values(diagnostics).reduce((sum,d)=>sum+(skippedIds.has(d.id)?0:['entry','summit'].filter(point=>d[`${point}Gps`]&&(d[`${point}Error`]||!d[`${point}Loaded`])).length),0);
  return {forecasts,diagnostics,cacheHit:pending.length===0,fetchedAt:Date.now(),lastUpdatedAt:timestamps.length?Math.max(...timestamps):null,requests:{forecast:stats.forecast,elevation:stats.elevation,total:stats.forecast+stats.elevation,forecastFailed:stats.forecastFailed,elevationFailed:stats.elevationFailed,failed,failedPoints,cachedPoints:stats.cachedPoints,newlyLoadedPoints:stats.newlyLoadedPoints},errors:stats.errors};
}

export function dayHours(data, date) {
  const hourly = data?.hourly; if (!hourly) return [];
  return hourly.time.map((time, i) => ({ time, index: i, date: time.slice(0, 10), hour: Number(time.slice(11, 13)),temperature:hourly.temperature_2m?.[i]??null,precipProbability:hourly.precipitation_probability?.[i]??null,precipitation:hourly.precipitation?.[i]??null,rain:hourly.rain?.[i]??null,snowfall:hourly.snowfall?.[i]??null,snowDepth:Number.isFinite(hourly.snow_depth?.[i])?hourly.snow_depth[i]*100:null,wind:hourly.wind_speed_10m?.[i]??null,windDirection:hourly.wind_direction_10m?.[i]??null,gusts:hourly.wind_gusts_10m?.[i]??null,cape:hourly.cape?.[i]??null,cloud:hourly.cloud_cover?.[i]??null,sunshine:hourly.sunshine_duration?.[i]??null,code:hourly.weather_code?.[i]??null})).filter(row=>row.date===date&&row.hour>=6&&row.hour<=19);
}
export function daylight(data,date){const daily=data?.daily,i=daily?.time?.indexOf(date)??-1;return i<0?{}:{sunrise:daily.sunrise?.[i],sunset:daily.sunset?.[i],sunshine:Number.isFinite(daily.sunshine_duration?.[i])?daily.sunshine_duration[i]/3600:null};}
