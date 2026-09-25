import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {searchCharacterCatalog} from '../catalog.mjs';

const rows=JSON.parse(readFileSync(new URL('../data/animadex-characters.json',import.meta.url)));

test('bundled AnimaDex search covers the full character catalogue, not a short fixed list',()=>{
  assert.ok(rows.length>36000);
  for(const [name,tag] of [['Changli','changli (wuthering waves)'],['Amiya','amiya (arknights)'],['Shorekeeper','shorekeeper (wuthering waves)']]){
    const found=searchCharacterCatalog(rows,{query:name});
    assert.ok(found.results.some(entry=>entry.trigger.includes(tag)),name);
  }
  assert.ok(searchCharacterCatalog(rows,{query:'守岸人'}).results.some(entry=>entry.slug==='the_shorekeeper_(wuthering_waves)'));
});

test('appearance matching ranks plausible characters while preserving their Anima trigger words',()=>{
  const found=searchCharacterCatalog(rows,{query:'arknights',gender:'female',facts:{hair_color:'brown',eye_color:'blue',hair_style:'long hair',distinctive_features:'rabbit ears'}},18);
  assert.ok(found.results.some(entry=>entry.slug==='amiya_(arknights)'&&entry.matched>=3));
  assert.ok(found.results.every(entry=>entry.trigger&&!entry.tags.includes('1boy')));
});
