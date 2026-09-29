export class ChatuAdapter {
  constructor(context){this.context=context;}
  imageTags(){
    const s=this.context().extensionSettings['st-chatu8'];
    if(!s)throw new Error('请先安装并配置智绘姬');
    const startTag=String(s.startTag||'').trim(),endTag=String(s.endTag||'').trim();
    if(!startTag||!endTag)throw new Error('智绘姬的图片开始或结束标记为空，请先设置 image### 和 ###');
    if(startTag===endTag)throw new Error('智绘姬图片标记设置无效');
    return {startTag,endTag};
  }
  requestId(prompt){
    const normalized=String(prompt||'').trim().replaceAll('\r','').replaceAll('\n','');
    let hash=0;for(let i=0;i<normalized.length;i++)hash=(hash<<5)-hash+normalized.charCodeAt(i)|0;
    return 'chatu8-id-'+Math.abs(hash).toString(36);
  }
}
