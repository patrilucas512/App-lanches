import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const explicit=process.argv.slice(2);let files=explicit;
const range=process.env.GITHUB_EVENT_NAME==="pull_request"?["HEAD^2^","HEAD^2"]:["HEAD^","HEAD"];
if(!files.length){try{files=execFileSync("git",["diff","--name-only","--diff-filter=ACMR",...range,"--","supabase/migrations/*.sql"],{encoding:"utf8"}).trim().split(/\r?\n/).filter(Boolean);}catch{files=[];}}
const hazards=[[/\bdrop\s+(table|column|type|index)\b/i,"DROP"],[/\brename\s+(column|table)\b/i,"RENAME"],[/\balter\s+column\b[\s\S]{0,100}\btype\b/i,"possible full-table rewrite"],[/\bcreate\s+index\b(?!\s+concurrently)/i,"index may lock writes"]];
const addedSql=file=>{if(explicit.length)return readFileSync(file,"utf8");try{return execFileSync("git",["diff","--unified=0",...range,"--",file],{encoding:"utf8"}).split(/\r?\n/).filter(line=>line.startsWith("+")&&!line.startsWith("+++" )).map(line=>line.slice(1)).join("\n");}catch{return "";}};
let failed=false;for(const file of files){const sql=addedSql(file);for(const[pattern,label]of hazards){if(label==="index may lock writes"&&/quality: allow-nonconcurrent-index reason=new-empty-[a-z0-9-]+-tables/i.test(sql))continue;if(pattern.test(sql)){console.error(`${file}: review required for ${label}`);failed=true;}}}
if(failed)process.exit(1);console.log(`Migration safety passed for ${files.length} changed file(s).`);

