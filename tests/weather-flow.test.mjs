import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchForecasts } from '../js/weather.js';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key,value) { this.values.set(key,String(value)); }
}

test('loads entry and summit forecasts for the two updated routes independently', async () => {
  globalThis.localStorage = new MemoryStorage();
  const calls=[];
  globalThis.fetch = async url => {
    calls.push(String(url));
    const count = new URL(String(url)).searchParams.get('latitude').split(',').length;
    const payload=Array.from({length:count},(_,i)=>({hourly:{time:['2026-11-18T08:00'],temperature_2m:[1]},elevation:900+i}));
    return {ok:true,json:async()=>payload};
  };
  const routes=[
    {id:'wilde-gams',name:'Wilde Gams',entry:{latitude:47.515694,longitude:12.758389,elevation:670},summit:{latitude:47.509695,longitude:12.762486,elevation:830}},
    {id:'isidor-klettersteig-gruenstein',name:'Isidor',entry:{latitude:47.591057,longitude:12.987299,elevation:860},summit:{latitude:47.594309,longitude:12.965505,elevation:1304}}
  ];
  const result=await fetchForecasts(routes);
  assert.equal(calls.length,1);
  assert.equal(result.requests.forecast,1);
  assert.equal(result.requests.forecastFailed,0);
  for(const route of routes){
    assert.equal(result.diagnostics[route.id].entryLoaded,true);
    assert.equal(result.diagnostics[route.id].summitLoaded,true);
    assert.equal(result.diagnostics[route.id].quality,'Vollständig');
  }
  const repeated=await fetchForecasts(routes);
  assert.equal(calls.length,1);
  assert.equal(repeated.requests.forecast,0);
  assert.equal(repeated.requests.cachedPoints,4);
  const saved=JSON.parse(globalThis.localStorage.getItem('steigwetter-cache-v3'));
  for(const entry of Object.values(saved)) entry.at=Date.now()-61*60*1000;
  globalThis.localStorage.setItem('steigwetter-cache-v3',JSON.stringify(saved));
  const expired=await fetchForecasts(routes);
  assert.equal(calls.length,2);
  assert.equal(expired.requests.newlyLoadedPoints,4);
  const forced=await fetchForecasts(routes,{force:true});
  assert.equal(calls.length,3);
  assert.equal(forced.requests.newlyLoadedPoints,4);
});

test('still returns the available point when the other route point is missing', async () => {
  globalThis.localStorage = new MemoryStorage();
  globalThis.fetch = async url => ({ok:true,json:async()=>({hourly:{time:['2026-11-18T08:00'],temperature_2m:[3]},elevation:1000})});
  const result=await fetchForecasts([{id:'partial',name:'Partial',entry:{latitude:null,longitude:null},summit:{latitude:47.7,longitude:13.1,elevation:1500}}]);
  assert.equal(result.diagnostics.partial.entryLoaded,false);
  assert.equal(result.diagnostics.partial.summitLoaded,true);
  assert.equal(result.diagnostics.partial.quality,'Teilweise');
});

test('isolates a single weather-point failure and keeps the other forecasts', async () => {
  globalThis.localStorage = new MemoryStorage();
  const originalWarn=console.warn; console.warn=()=>{};
  globalThis.fetch = async url => {
    const params=new URL(String(url)).searchParams, lat=params.get('latitude').split(','), lon=params.get('longitude').split(',');
    if(lat.length>1) throw new Error('simulated batch failure');
    if(Number(lat[0])===47.515694) throw new Error('simulated point failure');
    const count=lat.length, hourly={time:['2026-11-18T08:00'],temperature_2m:Array(count).fill(1)};
    return {ok:true,json:async()=>Array.from({length:count},(_,i)=>({hourly,elevation:900+i}))};
  };
  try {
    const result=await fetchForecasts([
      {id:'wilde-gams',entry:{latitude:47.515694,longitude:12.758389,elevation:670},summit:{latitude:47.509695,longitude:12.762486,elevation:830}},
      {id:'isidor',entry:{latitude:47.591057,longitude:12.987299,elevation:860},summit:{latitude:47.594309,longitude:12.965505,elevation:1304}}
    ]);
    assert.equal(result.diagnostics['wilde-gams'].entryLoaded,false);
    assert.equal(result.diagnostics['wilde-gams'].summitLoaded,true);
    assert.equal(result.diagnostics.isidor.entryLoaded,true);
    assert.equal(result.diagnostics.isidor.summitLoaded,true);
    assert.ok(result.errors['wilde-gams:entry']);
  } finally { console.warn=originalWarn; }
});

const sampleRoute = id => ({id,name:id,entry:{latitude:47.5,longitude:12.7,elevation:800},summit:{latitude:47.51,longitude:12.71,elevation:1200}});
function installForecastMock(calls) {
  globalThis.fetch=async url=>{calls.push(String(url));const params=new URL(String(url)).searchParams,count=params.get('latitude').split(',').length;return{ok:true,json:async()=>Array.from({length:count},()=>({hourly:{time:['2026-11-18T08:00'],temperature_2m:[4]}}))};};
}

test('full forecast cache skips network requests and loading progress', async () => {
  globalThis.localStorage=new MemoryStorage();const calls=[],route=sampleRoute('cached');installForecastMock(calls);
  const initial=await fetchForecasts([route]);assert.equal(initial.requests.newlyLoadedPoints,2);
  const progress=[];const cached=await fetchForecasts([route],{onForecastProgress:(done,total)=>progress.push([done,total])});
  assert.equal(calls.length,1);assert.equal(cached.requests.forecast,0);assert.equal(cached.requests.cachedPoints,2);assert.deepEqual(progress,[]);
});

test('partial cache requests only missing points and reports their progress', async () => {
  globalThis.localStorage=new MemoryStorage();const route=sampleRoute('partial-cache'),entryKey=`partial-cache:entry:47.50000,12.70000:800`;
  globalThis.localStorage.setItem('steigwetter-cache-v3',JSON.stringify({[entryKey]:{at:Date.now(),data:{hourly:{time:['2026-11-18T08:00'],temperature_2m:[3]}}}}));
  const calls=[],progress=[];installForecastMock(calls);
  const result=await fetchForecasts([route],{onForecastProgress:(done,total)=>progress.push([done,total])});
  assert.equal(calls.length,1);assert.equal(result.requests.cachedPoints,1);assert.equal(result.requests.newlyLoadedPoints,1);assert.deepEqual(progress,[[0,1],[1,1]]);
});

test('empty cache reports pending forecast points until all requests settle', async () => {
  globalThis.localStorage=new MemoryStorage();const calls=[],progress=[];installForecastMock(calls);
  const result=await fetchForecasts([sampleRoute('empty-cache')],{onForecastProgress:(done,total)=>progress.push([done,total])});
  assert.equal(result.requests.newlyLoadedPoints,2);assert.deepEqual(progress,[[0,2],[2,2]]);
});

test('closed routes are excluded from weather loading and failure totals', async () => {
  globalThis.localStorage=new MemoryStorage();const calls=[],progress=[];installForecastMock(calls);
  const result=await fetchForecasts([sampleRoute('closed')],{skipIds:['closed'],onForecastProgress:(done,total)=>progress.push([done,total])});
  assert.equal(calls.length,0);assert.deepEqual(progress,[]);assert.equal(result.diagnostics.closed.quality,'Gesperrt — Abfrage ausgelassen');assert.equal(result.requests.failedPoints,0);
});

test('manual force refresh reloads active forecasts and closes progress', async () => {
  globalThis.localStorage=new MemoryStorage();const calls=[],progress=[],route=sampleRoute('manual');installForecastMock(calls);
  const initial=await fetchForecasts([route]);const refreshed=await fetchForecasts([route],{force:true,existingForecasts:initial.forecasts,onForecastProgress:(done,total)=>progress.push([done,total])});
  assert.equal(calls.length,2);assert.equal(refreshed.requests.newlyLoadedPoints,2);assert.deepEqual(progress,[[0,2],[2,2]]);
});
