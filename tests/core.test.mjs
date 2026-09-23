import test from 'node:test';
import assert from 'node:assert/strict';
import {narrative,completeEnd,locateQuote,validAnchor,assertEnglish,validateScene,AutoBudget,Task} from '../core.mjs';
import {materialize} from '../adapter.mjs';
const raw='她原本想亲吻他，却停下来。她穿着白裙站在门口。';
const scene=()=>({evidence:'她穿着白裙站在门口。',moment:'门口的她',event_key:'woman-standing-door',phase:'static',score:0.9,cast:[{name:'女主',gender:'female',fixed_facts:[]}],positive:'One woman in a white dress stands at the door, her entire head and face visible.',negative:'text, speech balloons, watermark',audit:{grounded:true,one_moment:true,no_invented_dialogue:true}});
test('reasoning and buttons excluded without moving narrative offsets',()=>{
  const text='<think>秘密</think>正文<button>继续</button><analysis>未结束';
  const clean=narrative(text);assert.equal(clean.length,text.length);assert.ok(!clean.includes('秘密'));assert.ok(!clean.includes('继续'));assert.ok(clean.includes('正文'));assert.ok(!clean.includes('未结束'));
});
test('completed sentence boundaries',()=>{assert.equal(completeEnd('她站起来。接着'),5);assert.equal(completeEnd('未完'),0);});
test('anchor exact and refuses duplicate',()=>{
  const a=locateQuote(raw,'她穿着白裙站在门口。');assert.ok(validAnchor(raw,a));assert.ok(!validAnchor(raw.replace('白裙','黑裙'),a));
  assert.throws(()=>locateQuote(raw+raw,'她穿着白裙站在门口。'));
});
test('English-only and bounded prompt',()=>{assert.throws(()=>assertEnglish('beautiful 女孩'));assert.throws(()=>assertEnglish('one '.repeat(250)));});
test('face visibility defaults to both eyes when its exception has no exact source evidence',()=>{
  const value=scene();value.shot={face_visibility:'hidden',face_visibility_evidence:'not in source'};
  const result=validateScene(value,raw,{start:0,end:raw.length},true);
  assert.equal(result.shot.face_visibility,'both_eyes');
  assert.equal(result.shot.face_visibility_evidence,'');
});
test('anchors survive inline formatting and whitespace without revealing hidden text',()=>{
  const raw='她穿着<span>白色长裙</span>，\n站在门口。';const a=locateQuote(raw,'她穿着白色长裙，站在门口。');assert.ok(validAnchor(raw,a));assert.equal(a.quote,raw);
});
test('manual male allowed but automatic rejected',()=>{
  const s=scene();s.cast[0].gender='male';assert.equal(validateScene(s,raw,{start:0,end:raw.length},false),null);assert.ok(validateScene(s,raw,{start:0,end:raw.length},true));
});
test('uncompleted action never accepted',()=>{const s=scene();s.phase='planned';assert.throws(()=>validateScene(s,raw,{start:0,end:raw.length},true));});
test('director negative cannot suppress a required visible prop',()=>{const s=scene();s.negative='text, camera not visible, missing camera, watermark';const checked=validateScene(s,raw,{start:0,end:raw.length},true);assert.equal(checked.negative,'text, watermark');});
test('environment cannot disguise male as subject',()=>{const s=scene();s.subject='environment';s.cast[0].gender='male';assert.equal(validateScene(s,raw,{start:0,end:raw.length}),null);s.cast[0].is_subject=false;assert.ok(validateScene(s,raw,{start:0,end:raw.length}));});
test('budget duplicates and reserved second',()=>{
  const b=new AutoBudget();const s={event_key:'hug',anchor:{start:0,end:10},score:.9};assert.ok(b.accept(s));assert.equal(b.accept(s,true),false);
  const s2={event_key:'battle',anchor:{start:30,end:50},score:.9};assert.equal(b.accept(s2),false);assert.ok(b.accept(s2,true));assert.equal(b.accept({...s2,event_key:'third'},true),false);
});
test('automatic second shot never backfills an earlier moment',()=>{
  const b=new AutoBudget(),late={event_key:'camera',anchor:{start:42,end:120},score:.9},early={event_key:'changing-room',anchor:{start:0,end:42},score:.8};
  assert.ok(b.accept(late));assert.equal(b.canAccept(early,true),false);assert.equal(b.accept(early,true),false);
});
test('adjacent follow-through of the same subject cannot fill the second automatic slot',()=>{
  const b=new AutoBudget(),first={event_key:'camera-shot',anchor:{start:0,end:60},score:.94,cast:[{character_id:'erin',is_subject:true}]};
  assert.ok(b.accept(first));
  const follow={event_key:'camera-lowered',anchor:{start:60,end:100},score:.9,cast:[{character_id:'erin',is_subject:true}]};
  assert.equal(b.canAccept(follow,true),false);
  assert.equal(b.canAccept({...follow,score:.96},true),true);
  assert.equal(b.canAccept({...follow,cast:[{character_id:'other',is_subject:true}]},true),true);
  assert.equal(b.canAccept({...follow,anchor:{start:160,end:200}},true),true);
});
test('terminal states reject late completion',()=>{
  const t=new Task({binding:{},scene:{},origin:'manual'});t.set('cancelled');assert.equal(t.set('done'),false);assert.equal(t.state,'cancelled');
});
test('workflow preserves typed placeholders and escapes prompt safely',()=>{
  const workflow={a:{class_type:'Text',inputs:{text:'%prompt%',seed:'%seed%',other:'prefix %prompt%'}}};
  const out=materialize(workflow,{prompt:'a "quoted" woman\nline',seed:42});assert.equal(out.a.inputs.seed,42);assert.equal(out.a.inputs.text,'a "quoted" woman\nline');assert.equal(workflow.a.inputs.seed,'%seed%');
  assert.throws(()=>materialize(workflow,{prompt:'x'}));
});
