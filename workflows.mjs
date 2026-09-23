import {freeze} from './core.mjs';

// Based on the user's saved anima加速.json. Story text and the saved seed are not included.
export const MIAOMIAO = freeze({
  id:'miaomiao-harem-paired-v1',
  name:'Miaomiao Harem · 配套加速工作流',
  model:'miaomiaoHarem_29BBETA10.safetensors',
  parameters:{steps:12,cfg:2.5,sampler:'euler',scheduler:'simple',width:896,height:1152,loraStrength:0.8,shift:3},
  workflow:{
    '157':{class_type:'UNETLoader',inputs:{unet_name:'miaomiaoHarem_29BBETA10.safetensors',weight_dtype:'default'}},
    '159':{class_type:'CLIPLoader',inputs:{clip_name:'qwen_3_06b_base.safetensors',type:'stable_diffusion',device:'default'}},
    '160':{class_type:'VAELoader',inputs:{vae_name:'qwen_image_vae.safetensors'}},
    '158':{class_type:'LoraLoaderModelOnly',inputs:{model:['157',0],lora_name:'anima-turbo-lora-v0.2.safetensors',strength_model:0.8}},
    '152':{class_type:'ModelSamplingAuraFlow',inputs:{model:['158',0],shift:3,sampling:'flow'}},
    '151':{class_type:'CLIPTextEncode',inputs:{clip:['159',0],text:'%prompt%'}},
    '153':{class_type:'CLIPTextEncode',inputs:{clip:['159',0],text:'%negative_prompt%'}},
    '150':{class_type:'EmptyLatentImage',inputs:{width:896,height:1152,batch_size:1}},
    '148':{class_type:'KSampler',inputs:{model:['152',0],positive:['151',0],negative:['153',0],latent_image:['150',0],seed:'%seed%',steps:12,cfg:2.5,sampler_name:'euler',scheduler:'simple',denoise:1}},
    '154':{class_type:'VAEDecode',inputs:{samples:['148',0],vae:['160',0]}},
    '155':{class_type:'SaveImage',inputs:{images:['154',0],filename_prefix:'NarrativeDirector'}}
  }
});

export function pairedWorkflow(settings){
  const id=settings?.comfyWorkflow || MIAOMIAO.id;
  if(id==='chatu')return null;
  if(id!==MIAOMIAO.id)throw new Error('未知的导演工作流，请重新选择');
  return MIAOMIAO;
}
