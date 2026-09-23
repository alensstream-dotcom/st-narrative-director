const text={type:'string'};
const boolean={type:'boolean'};
const array=items=>({type:'array',items});
const object=properties=>({type:'object',properties,required:Object.keys(properties)});
const fact=object({field:text,value:text,evidence:text,source:text});
const cast=object({name:text,aliases:array(text),gender:{type:'string',enum:['female','male','unknown']},is_subject:boolean,outfit:text,outfit_evidence:text,position:text,fixed_facts:array(fact)});
const scene=object({
  evidence:text,moment:text,event_key:text,phase:{type:'string',enum:['static','happening','completed']},score:{type:'number'},uncertain:boolean,
  subject:{type:'string',enum:['characters','environment']},cast:array(cast),
  shot:object({action:text,essential_visible:array(text),framing:text,spatial_relations:text}),positive:text,negative:text,
  audit:object({grounded:boolean,one_moment:boolean,no_invented_dialogue:boolean})
});
export const DIRECTOR_SCHEMA=object({scenes:array(scene),state_updates:array(object({evidence:text,characters:array(object({name:text,outfit:text,location:text,time:text,injury:text}))}))});
