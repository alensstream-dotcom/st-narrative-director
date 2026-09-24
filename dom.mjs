import {narrative} from './core.mjs';
const EXCLUDE='button, a, input, select, textarea, script, style, details, .mes_reasoning, .nd-image, .nd-tools, .nd-chatu-prompt, .st-chatu8-image-container, [hidden], [aria-hidden="true"]';
export function textNodes(root) {
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode(node) {
    if(!node.textContent?.trim() || node.parentElement?.closest(EXCLUDE)) return NodeFilter.FILTER_REJECT;
    if(!node.parentElement?.getClientRects().length) return NodeFilter.FILTER_REJECT;
    return NodeFilter.FILTER_ACCEPT;
  }});
  const nodes=[]; let n; while((n=walker.nextNode())) nodes.push(n); return nodes;
}
const normalize=s=>s.replace(/\s/g,'');
export function selectionSnapshot(context) {
  const selection=getSelection();
  if(!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range=selection.getRangeAt(0);
  const parent=n=>n.nodeType===1?n:n.parentElement;
  const root=parent(range.startContainer)?.closest('.mes_text');
  if(!root || parent(range.endContainer)?.closest('.mes_text')!==root) return null;
  if(parent(range.startContainer)?.closest(EXCLUDE) || parent(range.endContainer)?.closest(EXCLUDE)) return null;
  const nodes=textNodes(root).filter(n=>range.intersectsNode(n));
  if(!nodes.length) return null;
  const text=nodes.map(n=>n.textContent.slice(n===range.startContainer?range.startOffset:0,n===range.endContainer?range.endOffset:undefined)).join('');
  if(text.trim().length<4) return null;
  const index=Number(root.closest('.mes')?.getAttribute('mesid'));
  const message=context.chat[index];
  if(!message || message.is_system || message.is_user) return null;
  // Match rendered selection against raw Markdown, preserving raw source offsets.
  const plain=normalize(text); const raw=message.mes;
  let rawText='', offsets=[];const clean=narrative(raw);
  for(let i=0;i<clean.length;i++) if(!/[\s*_`]/.test(clean[i])) {rawText+=clean[i]; offsets.push(i);}
  const needle=plain.replace(/[*_`]/g,''); const start=rawText.indexOf(needle);
  if(start<0 || rawText.indexOf(needle,start+1)>=0) return null;
  const from=offsets[start], to=offsets[start+needle.length-1]+1;
  return {index,text:raw.slice(from,to),start:from,end:to,rect:range.getBoundingClientRect()};
}
export function insertAtAnchor(root, quote, element) {
  const nodes=textNodes(root); const chars=[]; const refs=[];
  for(const node of nodes) for(let i=0;i<node.textContent.length;i++) {
    const c=node.textContent[i]; if(!/[\s*_`]/.test(c)) {chars.push(c);refs.push({node,offset:i+1});}
  }
  const text=chars.join(''); const needle=normalize(narrative(quote)).replace(/[*_`]/g,'');
  const at=text.indexOf(needle);
  if(at<0 || text.indexOf(needle,at+1)>=0) return false;
  const end=refs[at+needle.length-1]; if(!end) return false;
  const block=end.node.parentElement.closest('p,li,blockquote,h1,h2,h3,h4,div');
  if(block && block!==root && root.contains(block)) {
    const tail=document.createRange();tail.selectNodeContents(block);tail.setStart(end.node,end.offset);
    if(tail.toString().trim()) {
      const remainder=block.cloneNode(false);remainder.removeAttribute('id');
      remainder.append(tail.extractContents());block.after(element,remainder);
    }else block.after(element);
  }
  else { const range=document.createRange();range.setStart(end.node,end.offset);range.collapse(true);range.insertNode(element); }
  return true;
}
export function el(tag, attrs={}, ...children) {
  const node=document.createElement(tag);
  for(const [key,value] of Object.entries(attrs)) {
    if(key==='class') node.className=value;
    else if(key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else if(key==='text') node.textContent=value;
    else if(['value','checked','disabled','hidden','selected'].includes(key)) node[key]=value;
    else node.setAttribute(key,value);
  }
  children.flat().filter(x=>x!==null&&x!==undefined).forEach(x=>node.append(typeof x==='string'?document.createTextNode(x):x));
  return node;
}
export function command(icon,title,run,label='') {
  return el('button',{type:'button',class:'nd-command',title,'aria-label':title,onclick:run},el('i',{class:`fa-solid fa-${icon}`,'aria-hidden':'true'}),label?el('span',{text:label}):null);
}
export function dialog(title) {
  const body=el('div',{class:'nd-dialog-body'});
  const d=el('dialog',{class:'nd-dialog'},el('header',{},el('h3',{text:title}),command('xmark','关闭',()=>d.close())),body);
  d.addEventListener('close',()=>d.remove(),{once:true});document.body.append(d);d.showModal();return {dialog:d,body};
}
