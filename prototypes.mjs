const BANK=[
  {id:'violet',label:'Violet Evergarden',tag:'violet evergarden',gender:'female',hair:'blonde',eyes:'blue',style:'long'},
  {id:'mikasa',label:'Mikasa Ackerman',tag:'mikasa ackerman, shingeki no kyojin',gender:'female',hair:'black',eyes:'gray',style:'short'},
  {id:'mai',label:'Mai Sakurajima',tag:'sakurajima mai, seishun buta yarou',gender:'female',hair:'black',eyes:'blue',style:'long'},
  {id:'kaguya',label:'Kaguya Shinomiya',tag:'shinomiya kaguya, kaguya-sama wa kokurasetai',gender:'female',hair:'black',eyes:'red',style:'long'},
  {id:'rem',label:'Rem',tag:'rem (re:zero), re:zero kara hajimeru isekai seikatsu',gender:'female',hair:'blue',eyes:'blue',style:'short'},
  {id:'ram',label:'Ram',tag:'ram (re:zero), re:zero kara hajimeru isekai seikatsu',gender:'female',hair:'pink',eyes:'red',style:'short'},
  {id:'asuka',label:'Asuka Langley',tag:'souryuu asuka langley, neon genesis evangelion',gender:'female',hair:'red',eyes:'blue',style:'long'},
  {id:'frieren',label:'Frieren',tag:'frieren, sousou no frieren',gender:'female',hair:'silver',eyes:'green',style:'long',feature:'elf'},
  {id:'emilia',label:'Emilia',tag:'emilia (re:zero), re:zero kara hajimeru isekai seikatsu',gender:'female',hair:'silver',eyes:'purple',style:'long',feature:'elf'},
  {id:'zero-two',label:'Zero Two',tag:'zero two (darling in the franxx), darling in the franxx',gender:'female',hair:'pink',eyes:'green',style:'long',feature:'horn'},
  {id:'changli',label:'长离 · 鸣潮',tag:'changli (wuthering waves), wuthering waves',gender:'female',hair:'pink',eyes:'gold',style:'long'},
  {id:'jinhsi',label:'今汐 · 鸣潮',tag:'jinhsi (wuthering waves), wuthering waves',gender:'female',hair:'silver',eyes:['white','gray'],style:'long'},
  {id:'skadi',label:'斯卡蒂 · 明日方舟',tag:'skadi (arknights), arknights',gender:'female',hair:'silver',eyes:'red',style:'long'},
  {id:'amiya',label:'阿米娅 · 明日方舟',tag:'amiya (arknights), arknights',gender:'female',hair:'brown',eyes:'blue',style:'long',feature:'rabbit'},
  {id:'exusiai',label:'能天使 · 明日方舟',tag:'exusiai (arknights), arknights',gender:'female',hair:'red',eyes:'gold',style:'short',feature:'halo'},
  {id:'texas',label:'德克萨斯 · 明日方舟',tag:'texas (arknights), arknights',gender:'female',hair:'black',eyes:'gold',style:'long',feature:'wolf'},
  {id:'lappland',label:'拉普兰德 · 明日方舟',tag:'lappland (arknights), arknights',gender:'female',hair:'silver',eyes:'gray',style:'long',feature:'wolf'}
];
export const prototypeById=id=>BANK.find(p=>p.id===id)||null;
const category=(value,kind)=>{
  const text=String(value||'').toLowerCase();
  const groups=kind==='hair'?[
    ['silver',/silver|white|gray|grey|platinum/],['blonde',/blond|gold|yellow/],['black',/black/],['blue',/blue|azure/],['pink',/pink/],['red',/red|auburn|ginger|orange/],['brown',/brown|chestnut/],['purple',/purple|violet/],['green',/green/]
  ]:[
    ['blue',/blue|azure|teal|aqua/],['green',/green|emerald/],['red',/red|crimson/],['purple',/purple|violet/],['white',/white|pale ivory/],['gray',/gray|grey|silver/],['gold',/gold|amber|yellow|orange/],['brown',/brown/],['black',/black/],['pink',/pink/]
  ];
  return groups.find(([,pattern])=>pattern.test(text))?.[0]||'';
};
export function prototypeCandidates(facts,gender='female'){
  const byField=Object.fromEntries((facts||[]).filter(f=>f?.field&&f.value).map(f=>[f.field,String(f.value)]));
  const hair=category(byField.hair_color,'hair'),eyes=category(byField.eye_color,'eyes');
  if(!hair||!eyes)return [];
  const style=String(byField.hair_style||'').toLowerCase();
  const length=/\b(short|bob|pixie|shoulder.length)\b/.test(style)?'short':/\b(long|waist.length)\b/.test(style)?'long':'';
  const features=String(byField.distinctive_features||'').toLowerCase();
  const nonhuman=/(?:\belf\b|\bwolf\b|\brabbit\b|\bhalo\b|\bhorn\b)/.exec(features)?.[0]||'';
  return BANK.filter(p=>p.gender===gender&&p.hair===hair&&(Array.isArray(p.eyes)?p.eyes.includes(eyes):p.eyes===eyes)&&(!length||p.style===length)
    &&(!nonhuman||p.feature===nonhuman)&&(!p.feature||new RegExp(`\\b${p.feature}\\b`).test(features)));
}
export function automaticPrototype(facts,gender='female'){
  const candidates=prototypeCandidates(facts,gender);
  return candidates.length===1?candidates[0]:null;
}
export function prototypeSearchUrl(character){
  const facts=character?.visualFacts||{},params=new URLSearchParams({mode:'characters'});
  const hair=String(facts.hair_color||'').toLowerCase(),eyes=String(facts.eye_color||'').toLowerCase(),style=String(facts.hair_style||'').toLowerCase();
  const hairFacet=[['silver|platinum','silver hair'],['white','white hair'],['gray|grey','grey hair'],['blond|blonde|gold|yellow','blonde hair'],['black','black hair'],['blue|azure','blue hair'],['pink','pink hair'],['red|auburn|ginger|orange','red hair'],['brown|chestnut','brown hair'],['purple|violet','purple hair'],['green','green hair']].find(([pattern])=>new RegExp(pattern).test(hair))?.[1];
  const eyeFacet=[['blue|azure','blue eyes'],['green|emerald','green eyes'],['red|crimson','red eyes'],['purple|violet','purple eyes'],['gray|grey|silver','grey eyes'],['gold|amber|yellow','yellow eyes'],['brown','brown eyes'],['black','black eyes'],['pink','pink eyes']].find(([pattern])=>new RegExp(pattern).test(eyes))?.[1];
  const lengthFacet=/\b(?:short|bob|pixie|shoulder.length)\b/.test(style)?'short hair':/\bvery long\b/.test(style)?'very long hair':/\bmedium\b/.test(style)?'medium hair':/\b(?:long|waist.length)\b/.test(style)?'long hair':'';
  if(hairFacet)params.append('hair_color',hairFacet);
  if(eyeFacet)params.append('eye_color',eyeFacet);
  if(lengthFacet)params.append('hair_length',lengthFacet);
  if(character?.gender==='female')params.append('gender','1girl');
  else if(character?.gender==='male')params.append('gender','1boy');
  return `https://animadex.net/?${params}`;
}
export function prototypeTag(character,backend,model){
  if(backend!=='comfyui'||!/miaomiao|anima/i.test(model||''))return '';
  if(character?.prototypeMode==='none')return '';
  if(character?.prototypeMode==='custom')return character.prototypeCustom||'';
  const facts=Object.entries(character?.visualFacts||{}).map(([field,value])=>({field,value}));
  const candidate=character?.prototypeMode==='candidate'
    ?prototypeCandidates(facts,character?.gender||'female').find(p=>p.id===character?.prototypeId)
    :automaticPrototype(facts,character?.gender||'female');
  return candidate?.tag||'';
}
