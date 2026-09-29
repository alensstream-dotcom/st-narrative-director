export const NS = 'narrative_director_v1';
export const uuid = () => crypto.randomUUID();
export function fingerprint(text) {
  let a = 2166136261;
  for (const c of String(text)) a = Math.imul(a ^ c.charCodeAt(0), 16777619);
  return (a >>> 0).toString(36);
}
export const clone = value => structuredClone(value);
export function narrative(raw) {
  // Preserve offsets while hiding reasoning, interactive controls and unfinished tags.
  let s = String(raw || '');
  const blank = x => x.replace(/[^\n]/g, ' ');
  const hiddenTags = ['think', 'thinking', 'analysis', 'reasoning', 'details', 'script', 'style', 'button', 'select', 'textarea', 'dream_after_thinking', 'dream_after_format', 'dream_after_processing', 'dream_thinking', 'dream_reasoning'];
  for (const tag of hiddenTags) {
    s = s.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?(?:<\\/${tag}\\s*>|$)`, 'gi'), blank);
  }
  const bodyTag = /<dream_body\b[^>]*>/i.exec(s);
  if (bodyTag) {
    let visible = blank(s);
    const start = bodyTag.index + bodyTag[0].length;
    const closePattern = /<\/dream_body\s*>/gi;
    closePattern.lastIndex = start;
    const close = closePattern.exec(s);
    const end = close ? close.index : s.length;
    visible = visible.slice(0, start) + s.slice(start, end) + visible.slice(end);
    s = visible;
  }
  return s.replace(/<!--[\s\S]*?(?:-->|$)/g, blank).replace(/```[\s\S]*?(?:```|$)/g, blank).replace(/image###[\s\S]*?(?:###|$)/gi, blank).replace(/<[^>]*>/g, blank);
}
export function locateQuote(raw, quote, from = 0, until = raw.length) {
  if (typeof quote !== 'string' || quote.trim().length < 4) throw new Error('镜头缺少原文依据');
  const clean = narrative(raw);
  let text='', offsets=[];
  for(let i=from;i<until;i++)if(!/[\s*_`]/.test(clean[i])){text+=clean[i];offsets.push(i);}
  const needle=quote.replace(/[\s*_`]/g,''),at=text.indexOf(needle);
  if(at<0||!needle)throw new Error('镜头引用不属于当前选段');
  if(text.indexOf(needle,at+1)>=0)throw new Error('原文依据重复，请选择更完整的片段');
  const start=offsets[at],end=offsets[at+needle.length-1]+1,source=raw.slice(start,end);
  return {start,end,quote:source,fingerprint:fingerprint(source)};
}
export function validAnchor(raw, anchor) {
  return raw.slice(anchor.start, anchor.end) === anchor.quote && fingerprint(anchor.quote) === anchor.fingerprint;
}
export function assertEnglish(text) {
  if (typeof text !== 'string' || !text.trim() || /[^\x09\x0a\x0d\x20-\x7e]/.test(text)) throw new Error('提示词必须完整使用英文');
  if (text.split(/\s+/).length > 240) throw new Error('提示词过长，需重新提炼单一画面');
  return text.trim();
}
