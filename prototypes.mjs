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
  {id:'zero-two',label:'Zero Two',tag:'zero two (darling in the franxx), darling in the franxx',gender:'female',hair:'pink',eyes:'green',style:'long',feature:'horn'}
];
export const prototypeById=id=>BANK.find(p=>p.id===id)||null;
const category=(value,kind)=>{
  const text=String(value||'').toLowerCase();
  const groups=kind==='hair'?[
    ['silver',/silver|white|gray|grey|platinum/],['blonde',/blond|gold|yellow/],['black',/black/],['blue',/blue|azure/],['pink',/pink/],['red',/red|auburn|ginger|orange/],['brown',/brown|chestnut/],['purple',/purple|violet/],['green',/green/]
  ]:[
    ['blue',/blue|azure/],['green',/green|emerald/],['red',/red|crimson/],['purple',/purple|violet/],['gray',/gray|grey|silver/],['gold',/gold|amber|yellow/],['brown',/brown/],['black',/black/],['pink',/pink/]
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
  return BANK.filter(p=>p.gender===gender&&p.hair===hair&&p.eyes===eyes&&(!length||p.style===length)&&(!p.feature||features.includes(p.feature)));
}
export function prototypeTag(character,backend,model){
  if(backend!=='comfyui'||!/miaomiao|anima/i.test(model||''))return '';
  if(character?.prototypeMode==='none')return '';
  if(character?.prototypeMode==='custom')return character.prototypeCustom||'';
  const facts=Object.entries(character?.visualFacts||{}).map(([field,value])=>({field,value}));
  return prototypeCandidates(facts).find(p=>p.id===character?.prototypeId)?.tag||'';
}
