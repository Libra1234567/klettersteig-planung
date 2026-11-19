import { dayHours, daylight } from './weather.js';
const clamp=n=>Math.max(0,Math.min(100,n));
function mean(values){const nums=values.filter(Number.isFinite);return nums.length?nums.reduce((a,b)=>a+b,0)/nums.length:null;}
function aggregate(rows,key,mode='sum'){const vals=rows.map(r=>r[key]).filter(Number.isFinite);if(!vals.length)return null;return mode==='max'?Math.max(...vals):mode==='min'?Math.min(...vals):vals.reduce((a,b)=>a+b,0);}
function pointStats(data,date){const rows=dayHours(data,date);if(!rows.length)return null;const sum=k=>aggregate(rows,k),max=k=>aggregate(rows,k,'max');return{rows,elevation:Number.isFinite(data?.elevation)?data.elevation:null,elevationSource:data?.elevationSource||null,temp:mean(rows.map(r=>r.temperature)),minTemp:aggregate(rows,'temperature','min'),maxTemp:max('temperature'),precipProb:max('precipProbability'),precip:sum('precipitation'),rain:sum('rain'),snowfall:sum('snowfall'),snowDepth:max('snowDepth'),wind:max('wind'),windDirection:mean(rows.map(r=>r.windDirection)),gusts:max('gusts'),cape:max('cape'),cloud:mean(rows.map(r=>r.cloud)),sunshineHours:sum('sunshine')==null?null:sum('sunshine')/3600,...daylight(data,date)};}
function combinedReasons(...groups){
 const rainLabels=['Kritisches Regenrisiko','Hohes Regenrisiko','Erheblicher Niederschlag','Regen wahrscheinlich'];
 const all=[...new Set(groups.flat())],strongestRain=rainLabels.find(label=>all.includes(label));
 return strongestRain?[strongestRain,...all.filter(label=>!rainLabels.includes(label))]:all;
}
function scorePart(p){
 if(!p)return{score:null,reasons:['Keine Prognose für diesen Tag'],parts:null,coverage:0};
 const rainProb=Number.isFinite(p.precipProb)?p.precipProb:null,rainAmount=Number.isFinite(p.precip)?p.precip:null,rainReasons=[];
 const criticalRain=(rainProb!==null&&rainProb>=85)||(rainAmount!==null&&rainAmount>=8);
 if(criticalRain)rainReasons.push('Kritisches Regenrisiko');
 else if((rainProb!==null&&rainProb>50)||(rainAmount!==null&&rainAmount>=5))rainReasons.push('Hohes Regenrisiko');
 else if(rainAmount!==null&&rainAmount>=2)rainReasons.push('Erheblicher Niederschlag');
 else if(rainProb!==null&&rainProb>=30)rainReasons.push('Regen wahrscheinlich');
 const reasons=[...rainReasons],criteria=[];
 const add=(name,value,weight)=>{if(Number.isFinite(value))criteria.push({name,value:clamp(value),weight});};
 if(rainProb!==null||rainAmount!==null){const probabilityPenalty=rainProb===null?0:rainProb*1.15+Math.max(0,rainProb-50)*.45,amountPenalty=rainAmount===null?0:rainAmount*14;add('rain',100-Math.max(probabilityPenalty,amountPenalty),.30);}
 if(Number.isFinite(p.gusts)||Number.isFinite(p.wind))add('wind',100-(Number.isFinite(p.gusts)?Math.max(0,p.gusts-20)*3.2:0)-(Number.isFinite(p.wind)?Math.max(0,p.wind-12)*1.2:0),.17);
 if(Number.isFinite(p.cape)||Number.isFinite(p.precipProb))add('storm',100-(Number.isFinite(p.cape)?Math.max(0,p.cape-200)/14:0)-(Number.isFinite(p.precipProb)?Math.max(0,p.precipProb-40)*.45:0),.17);
 if(Number.isFinite(p.temp))add('temp',p.temp < -2?12:p.temp<2?42:p.temp<5?65:p.temp>28?55:p.temp>24?78:100,.13);
 if(Number.isFinite(p.snowDepth)||Number.isFinite(p.snowfall)||Number.isFinite(p.minTemp)&&Number.isFinite(p.rain))add('snow',100-(Number.isFinite(p.snowDepth)?p.snowDepth*22:0)-(Number.isFinite(p.snowfall)?p.snowfall*28:0)-(p.minTemp<0&&p.rain>.2?35:0),.13);
 if(Number.isFinite(p.cloud)||Number.isFinite(p.sunshineHours))add('sun',100-(Number.isFinite(p.cloud)?p.cloud*.72:0)+(Number.isFinite(p.sunshineHours)?Math.min(15,p.sunshineHours*1.2):0),.10);
 if(criteria.length<2)return{score:null,reasons:[...reasons,'Zu wenige tatsächlich verfügbare Wetterwerte'],parts:null,coverage:criteria.reduce((s,c)=>s+c.weight,0)};
 const weight=criteria.reduce((s,c)=>s+c.weight,0),parts=Object.fromEntries(criteria.map(c=>[c.name,c.value]));let score=Math.round(criteria.reduce((s,c)=>s+c.value*c.weight,0)/weight);
 const additionalRainPenalty=(rainProb===null?0:Math.max(0,rainProb-50)*.4)+(rainAmount===null?0:Math.max(0,rainAmount-2)*1.2);
 score=Math.max(0,Math.round(score-additionalRainPenalty));
 if(Number.isFinite(p.cape)&&p.cape>=1200&&Number.isFinite(p.precipProb)&&p.precipProb>=45)reasons.push('Hohes Gewitterrisiko');
 if(Number.isFinite(p.gusts)&&p.gusts>=80)reasons.push('Kritische Böen');
 if(Number.isFinite(p.snowDepth)&&p.snowDepth>=15||Number.isFinite(p.snowfall)&&p.snowfall>=3)reasons.push('Schnee am Berg');
 if(Number.isFinite(p.minTemp)&&p.minTemp<0&&Number.isFinite(p.rain)&&p.rain>.2)reasons.push('Frost bei möglicher Restnässe');
 if(Number.isFinite(p.gusts)&&p.gusts>=60)reasons.push('Starke Windböen');if((p.snowDepth??0)>0||(p.snowfall??0)>0)reasons.push('Schnee laut Modell');if(Number.isFinite(p.cape)&&p.cape>=500)reasons.push('Erhöhte Gewitterenergie');
 if(reasons.some(x=>['Hohes Gewitterrisiko','Kritische Böen','Schnee am Berg'].includes(x)))score=Math.min(score,25);
 if(criticalRain)score=Math.min(score,40);
 if(!reasons.length)reasons.push(score>=70?'Keine markanten Wetterrisiken im Prognosefenster':'Wetterbedingungen sind wechselhaft');
 return{score,reasons,parts,coverage:weight};
}
export function evaluate(location,forecast,date){
 const entry=pointStats(forecast?.entry,date),summit=pointStats(forecast?.summit,date),a=scorePart(entry),b=scorePart(summit),scores=[a.score,b.score].filter(Number.isFinite);
 if(!scores.length)return{score:null,status:'unknown',reasons:combinedReasons(a.reasons,b.reasons),dataQuality:'Unzureichend – keine belastbare Wetterbasis',uncertainty:'Nicht verfügbar',entry,summit,complete:false};
 const complete=!!entry&&!!summit,score=Math.min(...scores),reasons=combinedReasons(a.reasons,b.reasons);
 if(!complete)reasons.unshift(entry?'Nur Einstieg verfügbar – Teilbewertung':'Nur Gipfel/Ausstieg verfügbar – Teilbewertung');
 const status=score>=85?'excellent':score>=70?'good':score>=50?'limited':'bad',verified=(!forecast?.entry||location.entry?.verified!==false)&&(!forecast?.summit||location.summit?.verified!==false);
 const quality=complete?(verified?'Gut – Einstieg und Gipfel':'Eingeschränkt – GPS-Punkt nicht verifiziert'):'Teilweise – nur ein Wetterpunkt';
 const uncertainty=date===new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Vienna'})?'Kurzfristig · mittel':'Mehrere Tage voraus · erhöht';
 return{score,status,reasons,entry,summit,dataQuality:quality,uncertainty,parts:{entry:a.parts,summit:b.parts},complete,coverage:complete?Math.min(a.coverage||0,b.coverage||0):Math.max(a.coverage,b.coverage)};
}
export function conditionsLabel(status){return({excellent:'Sehr gut',good:'Gut',limited:'Eingeschränkt',bad:'Nicht empfohlen',unknown:'Keine Daten'})[status]||'Keine Daten';}
