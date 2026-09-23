import test from 'node:test';
import assert from 'node:assert/strict';
import {Controller} from '../controller.mjs';
import {NS} from '../core.mjs';
function setup(){
  const context={chat:[{mes:'艾琳穿着白裙站在门口。',swipe_id:0}],chatId:'a',characters:[{avatar:'a.png'}],characterId:0,extensionSettings:{'st-chatu8':{characterPresets:{}}},saveChat:async()=>{},saveSettingsDebounced:()=>{}};
  return {context,c:new Controller(()=>context)};
}
test('stable binding rejects swipe, deleted/replaced message, chat change and source edit',()=>{
  const {context,c}=setup(),raw=context.chat[0].mes,b=c.bind(0,raw,raw.length);
  assert.ok(c.resolve(b));context.chat[0].swipe_id=1;assert.equal(c.resolve(b),null);context.chat[0].swipe_id=0;
  context.chatId='b';assert.equal(c.resolve(b),null);context.chatId='a';context.chat[0].mes=raw.replace('白裙','黑裙');assert.equal(c.resolve(b),null);
  context.chat[0]={mes:raw,swipe_id:0};assert.equal(c.resolve(b),null);
});
test('metadata never changes story text',()=>{const {context,c}=setup(),before=context.chat[0].mes;c.bind(0,before,before.length);assert.equal(context.chat[0].mes,before);assert.ok(context.chat[0].extra[NS].id);});
test('redraw and backend changes do not accumulate renderer styles',()=>{
  const {c}=setup(),base='A woman holding a camera.',snapshot={prefix:'anime illustration',suffix:'soft shading',negative:'watermark'};
  const first=c.effective({positive:base},snapshot);
  const next=c.effective({basePositive:base,positive:first.positive},snapshot);
  assert.equal(next.positive,first.positive);
  const changed=c.effective({basePositive:base,positive:first.positive},{...snapshot,prefix:'ink drawing'});
  assert.ok(!changed.positive.includes('anime illustration'));assert.match(changed.positive,/ink drawing/);
});
test('historical state cannot include later outfit',()=>{
  const {context,c}=setup();const raw=context.chat[0].mes,meta=c.meta(context.chat[0]);
  const b=c.bind(0,raw,raw.length);meta.states=[{swipe:0,end:raw.length,prefix:b.prefix,value:{outfit:'black uniform'}}];
  assert.equal(c.historyAt(0,2).states.length,0);assert.equal(c.historyAt(0,raw.length).states.length,1);
});
test('new profile does not change original enable list or user profile',()=>{
  const {context,c}=setup();const settings=context.extensionSettings['st-chatu8'];settings.characterEnablePresets={a:{characters:['kept']}};settings.characterPresets.kept={nameCN:'已有',characterTraits:'green eyes'};
  c.adapter.upsertProfile('new','新人','blue eyes');assert.deepEqual(settings.characterEnablePresets,{a:{characters:['kept']}});assert.equal(settings.characterPresets.kept.characterTraits,'green eyes');
  c.adapter.upsertProfile('new','新人','red eyes');assert.equal(settings.characterPresets.nd_new.characterTraits,'blue eyes');
});
test('manual quota is independent and cancelled queued task cannot complete',async()=>{
  const {context,c}=setup(),raw=context.chat[0].mes,b=c.bind(0,raw,raw.length);
  let finish;c.adapter.generate=async()=>new Promise(r=>finish=r);
  const scene={positive:'A woman standing in a white dress.',negative:'text',anchor:{start:0,end:raw.length,quote:raw}};
  const task=c.enqueue(b,scene,'manual',{backend:'comfyui'});c.cancel(task);finish({imageId:'/x.png'});await new Promise(r=>setTimeout(r,10));
  assert.equal(task.state,'cancelled');assert.equal(c.meta(context.chat[0]).images.length,0);
});
test('inactive same-name profile does not cross chat identity; lock follows confirmed facts',()=>{
  const {context,c}=setup();context.extensionSettings['st-chatu8'].characterPresets.old={nameCN:'艾琳',characterTraits:'purple eyes, long hair'};
  const cast={name:'艾琳',aliases:[],fixed_facts:[{field:'eye_color',value:'green',evidence:'绿色眼睛'}]},scene={cast:[cast]};
  c.prepareCharacters(scene,{source:'绿色眼睛'});assert.notEqual(cast.profile_ref,'old');
  c.toggleLock({scene,imageId:'/image.png'},cast);
  const lock=c.scope().characters[cast.character_id].lock;assert.match(lock.traits,/green/);assert.doesNotMatch(lock.traits,/purple/);
  assert.equal(context.extensionSettings['st-chatu8'].characterPresets.old.characterTraits,'purple eyes, long hair');
});
