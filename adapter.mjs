export class ChatuAdapter {
  constructor(context){this.context=context;}
  imageTags(){
    const s=this.context().extensionSettings['st-chatu8'];
    if(!s)throw new Error('请先安装并配置智绘姬');
    const startTag=String(s.startTag||'image###'),endTag=String(s.endTag||'###');
    if(startTag===endTag)throw new Error('智绘姬图片标记设置无效');
    return {startTag,endTag};
  }
  requestId(prompt){
    let hash=0;for(let i=0;i<prompt.length;i++)hash=(hash<<5)-hash+prompt.charCodeAt(i)|0;
    return 'chatu8-id-'+Math.abs(hash).toString(36);
  }
}
