import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scanLocations, summarizeScan } from '../js/data-validator.js';

const routes = JSON.parse(await readFile(new URL('../data/locations.json', import.meta.url), 'utf8'));

test('loads every existing route and reports GPS gaps without treating them as coordinates', () => {
  assert.equal(routes.length, 37);
  const rows = scanLocations(routes);
  assert.equal(rows.length, 37);
  assert.ok(rows.some(row => row.id === 'tassilo-schermberg' && !row.entryGps));
  assert.ok(rows.every(row => ['Vollständig','Gut','Teilweise','Unvollständig','Fehlerhaft'].includes(row.quality)));
});

test('summarizes missing information and catches duplicate IDs and out-of-range GPS', () => {
  const broken = [
    {id:'dup',name:'A',country:'AT',range:'R',difficulty:'C',entry:{latitude:95,longitude:12},summit:{},links:[]},
    {id:'dup',name:'B',country:'AT',range:'R',difficulty:'C',entry:{},summit:{},links:[]}
  ];
  const rows = scanLocations(broken), summary = summarizeScan(rows);
  assert.equal(summary.total,2);
  assert.ok(rows.every(row => row.conflicts.includes('Doppelte ID')));
  assert.ok(rows[0].conflicts.some(issue => issue.includes('GPS')));
  assert.equal(summary.missingEntryGps,2);
});

test('integrates the user-supplied entry coordinates while retaining known elevations', () => {
  const wilde = routes.find(route => route.id === 'wilde-gams');
  const isidor = routes.find(route => route.id === 'isidor-klettersteig-gruenstein');
  assert.deepEqual([wilde.entry.latitude,wilde.entry.longitude,wilde.entry.elevation],[47.515694,12.758389,670]);
  assert.deepEqual([isidor.entry.latitude,isidor.entry.longitude,isidor.entry.elevation],[47.591057,12.987299,860]);
  assert.equal(wilde.entry.source,'https://www.alpintouren.com/de/touren/klettersteig/tourbeschreibung/tourdaten_27111.html');
  assert.equal(isidor.entry.source,'https://klettersteig.de/klettersteig/x/1742');
});
