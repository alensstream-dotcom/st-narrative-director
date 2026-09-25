const fs=require('node:fs');
const path=require('node:path');

// Metadata only. Images and unrelated descriptive tags are intentionally omitted.
const source=process.argv[2];
if(!source)throw new Error('Pass a downloaded AnimaDex character JSON file');
const entries=JSON.parse(fs.readFileSync(source,'utf8'));
if(!Array.isArray(entries)||entries.length<30000)throw new Error('Character catalogue is incomplete');
const appearance=/(?:^|\s)(?:hair|eyes|ears|horns|halo|pupils)(?:$|\s)|^(?:1girl|1boy)$/i;
const compact=entries.filter(x=>x?.slug&&x?.trigger&&!x.is_hidden).map(x=>[
  String(x.slug),String(x.name||x.slug),String(x.copyright_name||x.copyright||''),
  String(x.trigger),Array.isArray(x.tags)?x.tags.filter(tag=>appearance.test(tag)):[],Number(x.count)||0,
]);
const output=path.resolve(__dirname,'../data/animadex-characters.json');
fs.mkdirSync(path.dirname(output),{recursive:true});
fs.writeFileSync(output,JSON.stringify(compact));
console.log(JSON.stringify({characters:compact.length,bytes:fs.statSync(output).size,output}));
