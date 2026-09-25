import test from 'node:test';
import assert from 'node:assert/strict';
import {ChatuAdapter} from '../adapter.mjs';

test('confirmed image fills Chatu character and outfit media, text, and server storage',async()=>{
  const originalLocation=globalThis.location;
  globalThis.location=new URL('http://localhost:11451/');
  try{
    const owner='qa-owner',profile={directorOwner:owner,photoMedia:[],photoImageIds:[],characterTraits:'hair color: black'},
      outfit={directorOwner:owner,photoImageIds:[],fullBody:'black coat'};
    const settings={jiuguanchucun:'false',characterPresets:{portrait:profile},outfitPresets:{coat:outfit},configImageStorage:{}};
    let saved=0,uploaded;
    const adapter=new ChatuAdapter(()=>({extensionSettings:{'st-chatu8':settings},saveSettingsDebounced:()=>saved++}));
    adapter.post=async(path,body)=>{uploaded={path,body};return {path:`/user/images/chatu8_config/${body.filename}`};};
    const image=`data:image/png;base64,${Buffer.alloc(128,7).toString('base64')}`;
    const id=await adapter.saveAppearance('portrait','coat',image,'',{owner,prototypeTag:'texas (arknights), arknights',traits:'black hair, orange eyes',outfit:'white shirt and black coat'});
    assert.equal(uploaded.path,'/api/images/upload');
    assert.equal(uploaded.body.ch_name,'chatu8_config');
    assert.equal(profile.photoMedia[0].id,id);
    assert.equal(profile.selectedPhotoId,id);
    assert.deepEqual(outfit.photoImageIds,[id]);
    assert.equal(profile.photoPrompt,'texas (arknights), arknights, black hair, orange eyes');
    assert.equal(outfit.photoPrompt,'white shirt and black coat');
    assert.equal(settings.configImageStorage[id].kind,'image');
    assert.equal(saved,1);
    assert.equal(await adapter.saveAppearance('portrait','coat',image,id),id);
    assert.equal(saved,1);
  }finally{globalThis.location=originalLocation;}
});
