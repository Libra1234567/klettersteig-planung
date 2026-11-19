import test from 'node:test';
import assert from 'node:assert/strict';
import { coordinatesOf, haversineKm } from '../js/distance.js';
import { initMap, updateMap } from '../js/map.js';

test('normalizes numeric strings and coordinate aliases without accepting missing values', () => {
  assert.deepEqual(coordinatesOf({lat:'47.17473',lng:'11.86107'}),{latitude:47.17473,longitude:11.86107});
  assert.equal(coordinatesOf({latitude:null,longitude:11.8}),null);
  assert.equal(coordinatesOf({latitude:'',longitude:'11.8'}),null);
  assert.equal(coordinatesOf({latitude:91,longitude:11.8}),null);
  assert.equal(coordinatesOf({latitude:47,longitude:181}),null);
});

test('calculates a finite distance for valid unverified coordinates and returns null for invalid points', () => {
  const origin={latitude:47.9463,longitude:12.9347};
  const pfeilspitzwand={latitude:'47.17473',longitude:'11.86107',verified:false};
  const distance=haversineKm(origin,pfeilspitzwand);
  assert.ok(Number.isFinite(distance));
  assert.ok(distance>100&&distance<150);
  assert.equal(haversineKm(origin,{latitude:null,longitude:11.8}),null);
});

test('map renders valid unverified entry coordinates and skips missing or invalid points', () => {
  const markerCoordinates=[],bounds=[],mapObject={setView(){return this;},removeLayer(){},fitBounds(value){bounds.push(value);},invalidateSize(){}};
  const marker=()=>({bindPopup(){return this;},on(){return this;},addTo(){return this;}});
  const layer={addTo(){return this;},clearLayers(){}};
  const leaflet={map:()=>mapObject,control:{zoom:()=>({addTo(){}})},tileLayer:()=>({addTo(){}}),layerGroup:()=>layer,circleMarker(coords){markerCoordinates.push(coords);return marker();}};
  globalThis.window={L:leaflet};globalThis.L=leaflet;globalThis.document={getElementById:()=>({})};
  initMap();
  updateMap([
    {id:'pfeilspitzwand',name:'Pfeilspitzwand',difficulty:'C/D',entry:{latitude:'47.17473',longitude:'11.86107',verified:false}},
    {id:'missing',entry:{latitude:null,longitude:null}},
    {id:'invalid',entry:{latitude:95,longitude:11}}
  ],{pfeilspitzwand:{status:'good',score:80}}, {name:'Oberndorf',latitude:47.9463,longitude:12.9347},'2026-11-18',()=>{});
  assert.deepEqual(markerCoordinates,[[47.17473,11.86107],[47.9463,12.9347]]);
  assert.equal(bounds.length,1);
  assert.equal(bounds[0].length,2);
});
