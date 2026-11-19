const DRAFT_KEY='steigwetter-admin-draft-v1';
const WEATHER_KEY='steigwetter-admin-weather-v1';
export const CLOSURE_STATUSES=['Offen','Gesperrt','Teilweise gesperrt','Eingeschränkt','Unbekannt'];
export const isRouteActive=route=>route?.active!==false;

const serialize=value=>JSON.stringify(value);
const safeRead=(key,fallback)=>{try{const value=localStorage.getItem(key);return value?JSON.parse(value):fallback;}catch{return fallback;}};
const safeWrite=(key,value)=>{try{localStorage.setItem(key,serialize(value));return true;}catch{return false;}};
const clone=value=>JSON.parse(serialize(value));
const normalizeRoutes=routes=>routes.map(route=>({...route,active:route.active!==false}));

export function defaultClosure(){return{status:'Unbekannt',manual:false,reason:'',validFrom:'',validTo:'',source:'',sourceType:'Nicht verifiziert',checkedAt:'',note:'',automatic:null};}
export function routeClosure(route){return{...defaultClosure(),...(route?.closure||{})};}
export function weatherSnapshot(){return safeRead(WEATHER_KEY,{});}
export function saveWeatherSnapshot(diagnostics){safeWrite(WEATHER_KEY,{savedAt:new Date().toISOString(),diagnostics});}

export function mergeLocalDraft(base){
  const normalizedBase=normalizeRoutes(base),draft=safeRead(DRAFT_KEY,null);if(!draft||!Array.isArray(draft.routes)||!Array.isArray(draft.baseline))return{routes:clone(normalizedBase),conflict:false};
  const validDraftRoutes=list=>list.every(route=>route&&typeof route==='object'&&route.id&&route.name&&route.entry&&route.summit);
  if(!validDraftRoutes(draft.routes)||!validDraftRoutes(draft.baseline))return{routes:clone(normalizedBase),conflict:false,recoveredDraft:true};
  if(draft.routes.length===0&&normalizedBase.length>0)return{routes:clone(normalizedBase),conflict:false,recoveredEmptyDraft:true};
  const normalizedBaseline=normalizeRoutes(draft.baseline),normalizedLocal=normalizeRoutes(draft.routes);
  if(draft.baseSignature===serialize(base)||serialize(normalizedBaseline)===serialize(normalizedBase))return{routes:clone(normalizedLocal),conflict:false};
  const baseline=new Map(normalizedBaseline.map(route=>[route.id,route])),local=new Map(normalizedLocal.map(route=>[route.id,route])),remote=new Map(normalizedBase.map(route=>[route.id,clone(route)]));let conflict=false;
  for(const [id,before] of baseline){const current=remote.get(id);if(!local.has(id)){if(current&&serialize(current)!==serialize(before))conflict=true;remote.delete(id);}}
  for(const route of normalizedLocal){const before=baseline.get(route.id),current=remote.get(route.id),changed=!before||serialize(before)!==serialize(route);if(changed){if(current&&before&&serialize(current)!==serialize(before)&&serialize(current)!==serialize(route))conflict=true;remote.set(route.id,clone(route));}}
  const order=normalizedLocal.map(route=>route.id),merged=[...remote.values()].sort((a,b)=>{const ai=order.indexOf(a.id),bi=order.indexOf(b.id);return(ai<0?Number.MAX_SAFE_INTEGER:ai)-(bi<0?Number.MAX_SAFE_INTEGER:bi);});
  return{routes:merged,conflict};
}

export function saveLocalDraft(baseline,routes){
  return safeWrite(DRAFT_KEY,{version:1,baseSignature:serialize(baseline),baseline:clone(baseline),routes:clone(routes),savedAt:new Date().toISOString()});
}

export function effectiveClosure(route){
  const closure=routeClosure(route);
  const active=closure.manual?closure:closure.automatic?.status&&CLOSURE_STATUSES.includes(closure.automatic.status)?{...closure,...closure.automatic,manual:false}:closure;
  const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Vienna'});
  if(active.status!=='Unbekannt'&&((active.validFrom&&today<active.validFrom)||(active.validTo&&today>active.validTo)))return{...active,status:'Unbekannt',expired:true};
  return active;
}

export function closureLabel(route){const status=effectiveClosure(route).status;return CLOSURE_STATUSES.includes(status)?status:'Unbekannt';}
