import test from 'node:test';
import assert from 'node:assert/strict';
import {MIAOMIAO,pairedWorkflow} from '../workflows.mjs';
import {ChatuAdapter,materialize} from '../adapter.mjs';
import {NS} from '../core.mjs';

function setup(){
  const original={mode:'comfyui',comfyuiUrl:'http://localhost:8188',worker:'{}',workerid:'old',MODEL_NAME:'old.safetensors',yusheid_comfyui:'style',yushe:{style:{fixedPrompt:'anime illustration'}}};
  const context={extensionSettings:{'st-chatu8':original,[NS]:{}}};
  return {original,context,adapter:new ChatuAdapter(()=>context)};
}
test('paired graph preserves user sampler, dimensions, LoRA and model sampling',()=>{
  const graph=materialize(MIAOMIAO.workflow,{seed:12,prompt:'A woman with a camera.',negative_prompt:'text'});
  assert.equal(graph['157'].inputs.unet_name,MIAOMIAO.model);
  assert.equal(graph['148'].inputs.steps,12);assert.equal(graph['148'].inputs.cfg,2.5);
  assert.equal(graph['148'].inputs.scheduler,'simple');assert.equal(graph['148'].inputs.sampler_name,'euler');
  assert.equal(graph['158'].inputs.strength_model,0.8);assert.equal(graph['152'].inputs.shift,3);
  assert.equal(graph['150'].inputs.width,896);assert.equal(graph['150'].inputs.height,1152);
  assert.deepEqual(graph['148'].inputs.model,['152',0]);assert.equal(graph['151'].inputs.text,'A woman with a camera.');
  assert.equal(MIAOMIAO.workflow['151'].inputs.text,'%prompt%');
});
test('snapshot defaults to paired model without mutating original configuration',()=>{
  const {adapter,original,context}=setup(),before=JSON.stringify(original),snapshot=adapter.snapshot('comfyui');
  assert.equal(snapshot.model,MIAOMIAO.model);assert.deepEqual(snapshot.parameters,MIAOMIAO.parameters);
  context.extensionSettings[NS].comfyWorkflow='chatu';original.MODEL_NAME='another.safetensors';
  assert.equal(snapshot.model,MIAOMIAO.model);assert.equal(snapshot.parameters.steps,12);
  original.MODEL_NAME='old.safetensors';assert.equal(JSON.stringify(original),before);
  assert.equal(adapter.snapshot('comfyui').model,'old.safetensors');
});
test('missing paired model fails instead of replacing it with the only available model',async()=>{
  const {adapter}=setup(),previous=globalThis.fetch;
  globalThis.fetch=async()=>({ok:true,json:async()=>({UNETLoader:{input:{required:{unet_name:[['other.safetensors']]}}}})});
  try{await adapter.inspectComfy();assert.throws(()=>adapter.snapshot('comfyui'),/不会自动换模型/);}finally{globalThis.fetch=previous;}
});
test('unknown workflow is not silently replaced',()=>{assert.throws(()=>pairedWorkflow({comfyWorkflow:'missing'}));});
