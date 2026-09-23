import test from 'node:test';
import assert from 'node:assert/strict';
import {Controller} from '../controller.mjs';
import {NS,locateQuote} from '../core.mjs';
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
  const negatives=c.effective({positive:base,negative:'red umbrella, text'},snapshot);
  assert.match(negatives.negative,/red umbrella/);assert.match(negatives.negative,/watermark/);
  assert.equal(negatives.negative.split(', ').filter(tag=>tag==='text').length,1);
});
test('historical state cannot include later outfit',()=>{
  const {context,c}=setup();const raw=context.chat[0].mes,meta=c.meta(context.chat[0]);
  const b=c.bind(0,raw,raw.length);meta.states=[{swipe:0,end:raw.length,prefix:b.prefix,value:{outfit:'black uniform'}}];
  assert.equal(c.historyAt(0,2).states.length,0);assert.equal(c.historyAt(0,raw.length).states.length,1);
});
test('character state remains available after one hundred intervening messages',()=>{
  const {context,c}=setup(),first=context.chat[0],raw=first.mes;
  c.scope().characters.elin={id:'elin',name:'艾琳',aliases:[],profile:null};
  const binding=c.bind(0,raw,raw.length);c.meta(first).states=[{swipe:0,end:raw.length,prefix:binding.prefix,value:{characters:[{name:'艾琳',outfit:'white dress',location:'station'}]}}];
  for(let i=0;i<105;i++)context.chat.push({mes:`无关对话 ${i}`,swipe_id:0});
  const last='艾琳再次出现。';context.chat.push({mes:last,swipe_id:0});
  assert.equal(c.historyAt(context.chat.length-1,last.length).states[0].characters[0].outfit,'white dress');
  assert.equal(c.historyAt(0,0).states.length,0);
});
test('new profile does not change original enable list or user profile',()=>{
  const {context,c}=setup();const settings=context.extensionSettings['st-chatu8'];settings.characterEnablePresets={a:{characters:['kept']}};settings.characterPresets.kept={nameCN:'已有',characterTraits:'green eyes'};
  c.adapter.upsertProfile('new','新人','blue eyes');assert.deepEqual(settings.characterEnablePresets,{a:{characters:['kept']}});assert.equal(settings.characterPresets.kept.characterTraits,'green eyes');
  c.adapter.upsertProfile('new','新人','red eyes');assert.equal(settings.characterPresets.nd_new.characterTraits,'blue eyes');
});
test('director-owned profile fills new facts and preserves later user edits',()=>{
  const {context,c}=setup(),s=context.extensionSettings['st-chatu8'];
  const id=c.adapter.upsertProfile('character-a','艾琳','',undefined,c.chatKey());
  c.adapter.syncOwnedFacts(id,'character-a',[{field:'hair_color',value:'silver',evidence:'银发'}]);
  assert.match(s.characterPresets[id].characterTraits,/silver/);
  c.adapter.syncOwnedFacts(id,'character-a',[{field:'eye_color',value:'green',evidence:'绿眼'}]);
  assert.match(s.characterPresets[id].characterTraits,/green/);
  s.characterPresets[id].characterTraits='User edited, do not replace';
  assert.equal(c.adapter.syncOwnedFacts(id,'character-a',[{field:'face',value:'round',evidence:'圆脸'}]).reason,'user-edited');
  assert.equal(s.characterPresets[id].characterTraits,'User edited, do not replace');
});
test('outfit presets are linked only to the matching profile and never alter global enable lists',()=>{
  const {context,c}=setup(),s=context.extensionSettings['st-chatu8'];
  s.outfitEnablePresets={kept:{outfits:['user-outfit']}};
  s.outfitPresets={'user-outfit':{nameCN:'原有服装',fullBody:'white dress'}};
  const a=c.adapter.upsertProfile('a','艾琳',''),b=c.adapter.upsertProfile('b','贝拉','');
  const first=c.adapter.upsertOutfit('a',a,'艾琳','black coat',c.chatKey());
  assert.ok(first.startsWith('nd_outfit_a_'));
  assert.equal(c.adapter.upsertOutfit('a',a,'艾琳',' black   coat ',c.chatKey()),first);
  const detailed=c.adapter.upsertOutfit('a',a,'艾琳','black long-sleeved jacket and long pants',c.chatKey());
  assert.equal(c.adapter.upsertOutfit('a',a,'艾琳','black long-sleeved jacket and black long pants',c.chatKey()),detailed);
  assert.notEqual(c.adapter.upsertOutfit('a',a,'艾琳','black long-sleeved jacket and red scarf',c.chatKey()),detailed);
  assert.equal(c.adapter.upsertOutfit('b',b,'贝拉','black coat',c.chatKey())===first,false);
  assert.equal(s.characterPresets[a].outfits.filter(id=>id===first).length,1);
  assert.equal(s.characterPresets[b].outfits.length,1);
  assert.deepEqual(s.outfitEnablePresets,{kept:{outfits:['user-outfit']}});
  assert.equal(s.outfitPresets['user-outfit'].fullBody,'white dress');
  s.outfitPresets[first].fullBody='user edited navy coat';
  c.adapter.upsertOutfit('a',a,'艾琳','black coat',c.chatKey());
  assert.equal(s.outfitPresets[first].fullBody,'user edited navy coat');
  const changed=c.adapter.upsertOutfit('a',a,'艾琳','red battle suit',c.chatKey());
  assert.notEqual(changed,first);assert.equal(s.outfitPresets[first].fullBody,'user edited navy coat');
});
test('outfit is saved only when an evidenced scene is submitted',async()=>{
  const {context,c}=setup(),s=context.extensionSettings['st-chatu8'];
  const raw='艾琳穿着黑色外套站在门口。';context.chat[0].mes=raw;
  const cast={name:'艾琳',aliases:[],gender:'female',fixed_facts:[],outfit:'black coat',outfit_evidence:'穿着黑色外套'};
  const scene={cast:[cast],positive:'A woman in a black coat stands at the door.',negative:'text',anchor:locateQuote(raw,raw)};
  c.prepareCharacters(scene,{CURRENT_TEXT:raw,PREVIOUS_CONTEXT:{recent:'',states:[]}});
  assert.equal(cast.outfit_grounded,true);assert.equal(c.adapter.outfitsForProfile(cast.profile_ref).length,0);
  c.adapter.generate=async()=>({imageId:'/test.png',params:{}});
  const binding=c.bind(0,raw,raw.length);c.enqueue(binding,scene,'manual',{backend:'comfyui',model:'test'});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(c.adapter.outfitsForProfile(cast.profile_ref).length,1);
  assert.equal(c.meta(context.chat[0]).images[0].scene.cast[0].outfit_ref,cast.outfit_ref);
  const ungrounded={...cast,outfit:'green hat',outfit_evidence:'never mentioned'};
  c.prepareCharacters({cast:[ungrounded]},{CURRENT_TEXT:raw,PREVIOUS_CONTEXT:{recent:'',states:[]}});
  assert.equal(ungrounded.outfit_grounded,false);assert.equal(c.adapter.outfitsForProfile(cast.profile_ref).length,1);
  assert.ok(s.outfitPresets[cast.outfit_ref]);
});
test('another character outfit preset is not evidence for this character',()=>{
  const {c}=setup(),profileA=c.adapter.upsertProfile('a','艾琳',''),profileB=c.adapter.upsertProfile('b','贝拉','');
  c.scope().characters.a={id:'a',name:'艾琳',aliases:[],profile:profileA,lock:null};
  const cast={name:'艾琳',aliases:[],gender:'female',fixed_facts:[],outfit:'blue coat',outfit_evidence:'blue coat'};
  c.prepareCharacters({cast:[cast]},{CURRENT_TEXT:'艾琳站在门口。',PREVIOUS_CONTEXT:{recent:'',states:[]},original_outfits:[{profile_ref:profileB,outfits:[{description:'blue coat'}]}]});
  assert.equal(cast.outfit_grounded,false);
});
test('profile association is per character and locked associations require an explicit unlock',()=>{
  const {context,c}=setup(),profiles=context.extensionSettings['st-chatu8'].characterPresets;
  profiles.a={nameCN:'艾琳',characterTraits:'silver hair'};profiles.b={nameCN:'贝拉',characterTraits:'brown hair'};
  const registry=c.scope().characters;registry.first={id:'first',name:'艾琳',profile:'a',aliases:[],lock:null};registry.second={id:'second',name:'贝拉',profile:'b',aliases:[],lock:null};
  c.linkProfile('first','b');assert.equal(registry.first.profile,'b');assert.equal(registry.second.profile,'b');
  registry.first.lock={facts:[]};assert.throws(()=>c.linkProfile('first','a'),/解除/);
});
test('matching Anima character tag persists without changing story clothing or a locked choice',()=>{
  const {c}=setup(),cast={name:'薇儿',gender:'female',aliases:[],fixed_facts:[
    {field:'hair_color',value:'blonde',evidence:'blonde hair'},
    {field:'eye_color',value:'blue',evidence:'blue eyes'},
    {field:'hair_style',value:'long hair',evidence:'long hair'}]};
  c.prepareCharacters({cast:[cast]},{source:'blonde hair, blue eyes, long hair'});
  const character=c.scope().characters[cast.character_id];assert.equal(character.prototypeId,'violet');
  const scene={positive:'She wears a black coat and opens a red umbrella.',negative:'text',cast:[cast]};
  const snapshot={backend:'comfyui',model:'miaomiaoHarem_29BBETA10.safetensors',prefix:'best quality',suffix:'',negative:'text'};
  const result=c.effective(scene,snapshot);assert.match(result.positive,/violet evergarden/);assert.match(result.positive,/black coat/);
  c.setPrototype(character.id,'none');assert.doesNotMatch(c.effective(scene,snapshot).positive,/violet evergarden/);
  c.setPrototype(character.id,'candidate','violet');assert.match(c.effective(scene,snapshot).positive,/violet evergarden/);
  character.lock={facts:[]};assert.throws(()=>c.setPrototype(character.id,'none'),/解除/);
});
test('manual quota is independent and cancelled queued task cannot complete',async()=>{
  const {context,c}=setup(),raw=context.chat[0].mes,b=c.bind(0,raw,raw.length);
  let finish;c.adapter.generate=async()=>new Promise(r=>finish=r);
  const scene={positive:'A woman standing in a white dress.',negative:'text',anchor:{start:0,end:raw.length,quote:raw}};
  const task=c.enqueue(b,scene,'manual',{backend:'comfyui'});c.cancel(task);finish({imageId:'/x.png'});await new Promise(r=>setTimeout(r,10));
  assert.equal(task.state,'cancelled');assert.equal(c.meta(context.chat[0]).images.length,0);
});
test('reserved second scene is submitted after the reply ends',async()=>{
  const {context,c}=setup(),first='窗边阳光照亮空旷的车站大厅。'.repeat(8)+'艾琳举起银色相机拍了一张照片。',second='外面突然下起大雨，车站门口的石阶闪着水光。'.repeat(8)+'艾琳撑开一把鲜红的雨伞。';
  context.chat[0].mes=first;c.config().enabled=true;
  const sent=[];
  c.analyze=async(index,raw,start,end)=>({scenes:[{event_key:start?'umbrella':'camera',score:.9,anchor:locateQuote(raw,start?second.slice(-14):first.slice(-16),start,end),positive:'A woman with an object.',negative:'text'}]});
  c.adapter.inspectComfy=async()=>({});c.adapter.snapshot=()=>({backend:'comfyui',prefix:'',suffix:'',negative:'',model:'test'});
  c.enqueue=(binding,scene)=>{sent.push(scene.event_key);return {}};
  c.startRound('normal',{},false);const round=c.round;
  await c.pump(round);assert.deepEqual(sent,['camera']);
  context.chat[0].mes+=second;round.lastCall=0;
  await c.pump(round);assert.deepEqual(sent,['camera']);assert.equal(round.pending.length,1);
  round.final=true;await c.pump(round);assert.deepEqual(sent,['camera','umbrella']);
});
test('inactive same-name profile does not cross chat identity; lock follows confirmed facts',()=>{
  const {context,c}=setup();context.extensionSettings['st-chatu8'].characterPresets.old={nameCN:'艾琳',characterTraits:'purple eyes, long hair'};
  const cast={name:'艾琳',aliases:[],fixed_facts:[{field:'eye_color',value:'green',evidence:'绿色眼睛'}]},scene={cast:[cast]};
  c.prepareCharacters(scene,{source:'绿色眼睛'});assert.notEqual(cast.profile_ref,'old');
  c.toggleLock({scene,imageId:'/image.png'},cast);
  const lock=c.scope().characters[cast.character_id].lock;assert.match(lock.traits,/green/);assert.doesNotMatch(lock.traits,/purple/);
  assert.equal(context.extensionSettings['st-chatu8'].characterPresets.old.characterTraits,'purple eyes, long hair');
});
