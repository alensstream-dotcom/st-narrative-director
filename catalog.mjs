let catalogPromise;

export async function loadCharacterCatalog(){
  catalogPromise ||= fetch(new URL('./data/animadex-characters.json',import.meta.url)).then(response=>{
    if(!response.ok)throw new Error(`角色目录读取失败（HTTP ${response.status}）`);
    return response.json();
  }).catch(error=>{catalogPromise=null;throw error;});
  return catalogPromise;
}

const aliases={鸣潮:'wuthering waves',明日方舟:'arknights',长离:'changli',今汐:'jinhsi',守岸人:'the shorekeeper',
  斯卡蒂:'skadi',阿米娅:'amiya',能天使:'exusiai',德克萨斯:'texas',拉普兰德:'lappland'};
const simplify=value=>String(value||'').toLowerCase().replaceAll('_',' ').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const appearanceTerms={
  hair_color:{silver:['white hair','grey hair','silver hair'],white:['white hair','silver hair'],gray:['grey hair','silver hair'],
    blonde:['blonde hair'],black:['black hair'],blue:['blue hair','aqua hair'],pink:['pink hair'],red:['red hair'],brown:['brown hair'],purple:['purple hair'],green:['green hair']},
  eye_color:{silver:['grey eyes'],white:['white eyes'],gray:['grey eyes'],blue:['blue eyes','aqua eyes'],green:['green eyes'],red:['red eyes'],
    gold:['yellow eyes','orange eyes'],yellow:['yellow eyes'],orange:['orange eyes','yellow eyes'],brown:['brown eyes'],black:['black eyes'],pink:['pink eyes'],purple:['purple eyes']},
};
function expectedTags(facts={}){
  const expected=[];
  for(const [field,groups] of Object.entries(appearanceTerms)){
    const value=simplify(facts[field]);
    const key=Object.keys(groups).find(token=>new RegExp(`\\b${token}\\b`).test(value));
    if(key)expected.push(groups[key]);
  }
  const style=simplify(facts.hair_style);
  if(/\b(?:short|bob|pixie)\b/.test(style))expected.push(['short hair']);
  else if(/\b(?:long|waist)\b/.test(style))expected.push(['long hair','very long hair']);
  const features=simplify(facts.distinctive_features);
  for(const feature of ['wolf ears','rabbit ears','elf ears','halo','horns'])if(features.includes(feature))expected.push([feature]);
  return expected;
}

export function searchCharacterCatalog(rows,{query='',facts={},gender=''}={},limit=18){
  const normalized=simplify(aliases[query.trim()]||query);
  const terms=normalized.split(' ').filter(Boolean);
  const expected=expectedTags(facts);
  const matches=[];
  for(const row of rows){
    const [slug,name,series,trigger,tags,count]=row;
    const searchable=simplify(`${name} ${slug} ${series}`);
    if(terms.length&&!terms.every(term=>searchable.includes(term)))continue;
    const tagSet=new Set(tags||[]);
    if(gender==='female'&&tagSet.has('1boy')&&!tagSet.has('1girl'))continue;
    if(gender==='male'&&tagSet.has('1girl')&&!tagSet.has('1boy'))continue;
    const matched=expected.filter(group=>group.some(tag=>tagSet.has(tag))).length;
    if(!terms.length&&expected.length>=2&&matched<2)continue;
    const score=matched*100+Math.log2(1+count)*3+(terms.length&&simplify(name)===normalized?1000:0);
    matches.push({slug,name,series,trigger,tags,count,matched,score});
  }
  matches.sort((a,b)=>b.score-a.score||b.count-a.count||a.name.localeCompare(b.name));
  return {total:matches.length,expected:expected.length,results:matches.slice(0,limit)};
}
