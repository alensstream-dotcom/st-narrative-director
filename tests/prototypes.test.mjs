import test from 'node:test';
import assert from 'node:assert/strict';
import {prototypeCandidates,prototypeTag} from '../prototypes.mjs';
const facts=(hair,eyes,style,feature='')=>[
  {field:'hair_color',value:hair},{field:'eye_color',value:eyes},
  {field:'hair_style',value:style},{field:'distinctive_features',value:feature}
];
test('visual prototype needs matching known fixed traits, not just hair color',()=>{
  assert.equal(prototypeCandidates(facts('blonde','blue','long hair'))[0]?.id,'violet');
  assert.deepEqual(prototypeCandidates(facts('silver','green','short hair')),[]);
  assert.deepEqual(prototypeCandidates([{field:'hair_color',value:'blonde'}]),[]);
});
test('nonhuman features require story evidence before matching',()=>{
  assert.deepEqual(prototypeCandidates(facts('silver','green','long hair')),[]);
  assert.equal(prototypeCandidates(facts('silver','green','long hair','pointed elf ears'))[0]?.id,'frieren');
});
test('prototype tag is limited to the matching renderer and can be turned off',()=>{
  const character={prototypeId:'violet',prototypeMode:'auto',visualFacts:{hair_color:'blonde',eye_color:'blue',hair_style:'long hair'}};
  assert.match(prototypeTag(character,'comfyui','miaomiaoHarem_29BBETA10.safetensors'),/violet evergarden/);
  assert.equal(prototypeTag(character,'banana','miaomiaoHarem_29BBETA10.safetensors'),'');
  character.prototypeMode='none';assert.equal(prototypeTag(character,'comfyui','miaomiaoHarem_29BBETA10.safetensors'),'');
});
