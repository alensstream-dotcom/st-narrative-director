import {el,command,dialog} from './dom.mjs';
import {prototypeSearchUrl,prototypeById} from './prototypes.mjs';
import {connectionPanel} from './connection-ui.mjs';

const field=(name,input)=>{input.setAttribute('aria-label',name);return el('label',{},name,input);};

export function openSettings(ui,initial='connection'){
  const {dialog:d,body}=dialog('叙景 · 导演控制台'),c=ui.c;
  const nav=el('div',{class:'nd-tabs',role:'tablist','aria-label':'导演设置'}),content=el('div',{class:'nd-panel',role:'tabpanel'});
  body.append(nav,content);
  const views={connection:['API',()=>connectionPanel(ui,content,d)],render:['生图',()=>renderChatuPanel(ui,content)],characters:['人物',()=>characterPanel(ui,content,d)],tasks:['任务',()=>taskPanel(ui,content)]};
  const choose=id=>{
    for(const button of nav.children){const active=button.dataset.tab===id;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;}
    content.replaceChildren();views[id][1]();
  };
  for(const [id,[name]] of Object.entries(views)){const b=el('button',{type:'button',role:'tab',text:name,'data-tab':id,onclick:()=>choose(id)});nav.append(b);}
  nav.onkeydown=e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const ids=Object.keys(views),at=ids.findIndex(id=>nav.querySelector(`[data-tab="${id}"]`).getAttribute('aria-selected')==='true');const id=ids[(at+(e.key==='ArrowRight'?1:ids.length-1))%ids.length];choose(id);nav.querySelector(`[data-tab="${id}"]`).focus();};
  choose(views[initial]?initial:'connection');
  d.addEventListener('close',()=>{ui.statusNode=null;ui.taskList=null;},{once:true});
  return {dialog:d,choose};
}

function renderChatuPanel(ui,body){
  const c=ui.c.config(),adapter=ui.c.adapter;
  const enabled=el('input',{type:'checkbox',checked:c.enabled});
  enabled.onchange=()=>{c.enabled=enabled.checked;ui.c.save();if(!c.enabled&&ui.c.round)ui.c.round.abort.abort();};
  const status=el('p',{class:'nd-status',role:'status'});
  const describe=()=>{
    try{
      const s=adapter.settings();
      const checks=[s.startTag==='image###'&&s.endTag==='###',String(s.zidongdianji)==='true',String(s.zidongdianji2)!=='true',s.mode==='comfyui',s.client==='jiuguan',String(s.workerid||'').startsWith('叙景 Miaomiao Harem')];
      status.textContent=checks.every(Boolean)
        ?`智绘姬已就绪 · ${s.workerid} · ${adapter.promptStyle().model} · ${s.comfyuiUrl}`
        :'智绘姬尚未使用配套设置；应用后会保留已有预设和人物档案。';
    }catch(e){status.textContent=e.message;}
  };
  const apply=command('sliders','应用智绘姬配套设置',()=>{
    try{const info=adapter.configureChatu();restore.disabled=false;describe();status.textContent=`已应用 · ${info.preset} · ${info.model} · ${info.url}`;}
    catch(e){status.textContent=e.message;}
  },'应用配套设置');apply.classList.add('nd-primary');
  const restore=command('clock-rotate-left','恢复应用前设置',()=>{
    try{adapter.restoreChatu();restore.disabled=true;describe();status.textContent='已恢复应用前的智绘姬设置';}
    catch(e){status.textContent=e.message;}
  },'恢复原设置');restore.disabled=!c.chatuRestore;
  const check=command('plug','检查 ComfyUI',async()=>{
    check.disabled=true;status.textContent='正在连接 ComfyUI…';
    try{const info=await adapter.inspectComfy();if(!info)throw new Error('ComfyUI 未响应');status.textContent=`已连接 · ${adapter.settings().MODEL_NAME} · ${info._viaProxy?'酒馆代理':'直连'}`;}
    catch(e){status.textContent=e.message;}finally{check.disabled=false;}
  },'检查连接');
  body.append(el('h4',{text:'生图链路'}),el('label',{class:'nd-toggle'},enabled,'自动选镜头 · 每轮最多两张，尽量至少一张'),
    el('div',{class:'nd-actions-inline'},apply,check,restore),status);
  describe();
}

function taskPanel(ui,body){
  ui.statusNode=el('p',{class:'nd-status',text:ui.c.notice||'当前没有分析任务',role:'status'});
  body.append(ui.statusNode,command('rotate-right','重试本轮分析',()=>{try{ui.c.retryAnalysis();}catch(e){ui.error(e);}},'重试分析'));
  ui.taskList=el('div',{class:'nd-tasks'});body.append(ui.taskList);ui.refresh();
}

function characterPanel(ui,body,d){
  const c=ui.c,registry=c.scope().characters;body.replaceChildren();
  const status=el('p',{class:'nd-status',role:'status'});
  body.append(el('div',{class:'nd-actions-inline'},command('user-gear','打开智绘姬人物与服装管理',()=>{try{c.adapter.openProfiles();d.close();}catch(e){status.textContent=e.message;}},'智绘姬管理'),command('arrows-rotate','重新读取人物资料',()=>characterPanel(ui,body,d),'刷新'),el('a',{href:'https://animadex.net/?mode=characters',target:'_blank',rel:'noopener noreferrer',text:'人物 Tag'}),el('a',{href:'https://tags.latent.moe/en/g/fashion_style',target:'_blank',rel:'noopener noreferrer',text:'服装 Tag'})),status);
  let profiles;try{profiles=c.adapter.profiles();}catch(e){status.textContent=e.message;return;}
  body.append(el('p',{class:'nd-status',text:`当前聊天 ${Object.keys(registry).length} 人 · 智绘姬 ${profiles.length} 份档案`}));
  if(!Object.keys(registry).length)body.append(el('p',{class:'nd-notice',text:'当前聊天尚未识别人物。首次分析剧情时自动关联或建立档案。'}));
  for(const character of Object.values(registry)){
    const profile=c.adapter.profile(character.profile),section=el('section',{class:'nd-person'});
    const select=el('select',{},...profiles.map(p=>el('option',{value:p.id,text:`${p.nameCN||p.nameEN||p.id} · ${p.id}`})));select.value=character.profile;
    const aliases=el('input',{value:(character.aliases||[]).join(', ')});
    const facts=el('textarea',{value:profile?[profile.characterTraits,profile.facialFeatures].filter(Boolean).join('\n'):'关联档案已删除',rows:3,readonly:true});
    const sync=character.sync?.reason==='user-edited'?'检测到用户编辑，停止自动覆盖':profile?.directorOwner===character.id?'本插件建档，可渐进补全未知外貌':'复用现有档案，保持用户编辑';
    section.append(el('div',{class:'nd-person-title'},el('h4',{text:character.name}),el('span',{class:'nd-badge',text:character.lock?'已锁定外貌':'未锁定'})),field('智绘姬档案',select),field('当前档案外貌',facts),el('small',{text:sync}),field('别名（逗号分隔）',aliases));
    const candidates=c.prototypeCandidates(character),automatic=candidates.length===1?candidates[0]:null;
    const prototype=el('select',{},el('option',{value:'auto',text:`自动匹配${automatic?` · ${automatic.label}`:candidates.length>1?' · 多个相似候选，请手选':' · 暂无可靠候选'}`}),el('option',{value:'none',text:'仅使用固定外貌描述'}),...candidates.map(p=>el('option',{value:`candidate:${p.id}`,text:p.label})),el('option',{value:'custom',text:'自定义角色 Tag'}));
    prototype.value=character.prototypeMode==='candidate'?`candidate:${character.prototypeId}`:character.prototypeMode||'auto';
    if(!prototype.value)prototype.value='auto';
    const custom=el('input',{value:character.prototypeCustom||'',placeholder:'例如 violet evergarden',maxlength:100});
    const customField=field('自定义 Anima 角色 Tag',custom);customField.hidden=prototype.value!=='custom';
    const tagPreview=el('small',{class:'nd-hint'});
    const showTag=()=>{
      const tag=prototype.value==='auto'?automatic?.tag:prototype.value.startsWith('candidate:')?prototypeById(prototype.value.slice('candidate:'.length))?.tag:prototype.value==='custom'?custom.value.trim():'';
      tagPreview.textContent=tag?`Anima 角色外貌参考：${tag}。当前剧情服装、动作仍以正文为准。`:'没有可靠角色 Tag 时，仅使用已知固定外貌描述。';
    };
    prototype.disabled=!!character.lock;custom.disabled=!!character.lock;
    prototype.onchange=()=>{customField.hidden=prototype.value!=='custom';showTag();if(prototype.value==='custom')return;try{const [mode,id]=prototype.value.split(':');c.setPrototype(character.id,mode,id);status.textContent='视觉原型已更新，仅影响后续新图和重绘';}catch(e){status.textContent=e.message;}};
    custom.oninput=showTag;
    custom.onchange=()=>{try{c.setPrototype(character.id,'custom','',custom.value);status.textContent='自定义角色 Tag 已更新，仅影响后续新图和重绘';}catch(e){status.textContent=e.message;}};
    showTag();
    section.append(field('Anima 视觉原型',prototype),customField,tagPreview,el('div',{class:'nd-actions-inline'},el('a',{href:prototypeSearchUrl(character),target:'_blank',rel:'noopener noreferrer',text:'按当前外观筛选 ANIMADEX'})),el('small',{text:character.lock?'已锁定；先解除锁定才能换原型':'自动匹配需要足够固定外貌证据；有多个相似候选时手动选择'}));
    const outfits=c.adapter.outfitsForProfile(character.profile),wardrobe=el('details',{},el('summary',{text:`智绘姬服装预设 ${outfits.length}`}));
    for(const outfit of outfits)wardrobe.append(el('div',{class:'nd-profile-row'},el('strong',{text:outfit.nameCN||outfit.nameEN||outfit.id}),el('small',{text:outfit.description||'未填写服装描述'})));
    section.append(wardrobe);
    const actions=el('div',{class:'nd-actions-inline'},command('link','保存人物关联',()=>{
      try{if(select.value!==character.profile)c.linkProfile(character.id,select.value);character.aliases=[...new Set(aliases.value.split(/[,，]/).map(x=>x.trim()).filter(Boolean))];c.save();characterPanel(ui,body,d);body.querySelector('[role="status"]').textContent='人物关联已保存';}catch(e){status.textContent=e.message;}
    },'保存关联'));
    if(character.lock)actions.append(command('lock-open','解除人物锁定',()=>{c.setLock(character,null);characterPanel(ui,body,d);},'解除锁定'));
    if(character.lockHistory?.length)actions.append(command('clock-rotate-left','回滚上次锁定变更',()=>{c.restoreLock(character.id);characterPanel(ui,body,d);},'回滚锁定'));
    section.append(actions);
    if(character.lock){section.append(el('p',{class:'nd-status',text:character.lock.traits}));if(character.lock.sourceImage)section.append(el('img',{class:'nd-reference',src:character.lock.sourceImage,alt:`${character.name} 已确认图片`}));}
    body.append(section);
  }
  const list=el('details',{},el('summary',{text:'智绘姬可关联档案'}));
  for(const p of profiles)list.append(el('div',{class:'nd-profile-row'},el('strong',{text:p.nameCN||p.nameEN||p.id}),el('small',{text:p.id}),el('p',{text:[p.characterTraits,p.facialFeatures].filter(Boolean).join('; ')||'未填写外貌'})));
  body.append(list);
}
