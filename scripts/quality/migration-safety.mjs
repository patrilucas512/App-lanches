import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const explicit=process.argv.slice(2);let files=explicit;
// In a pull_request run HEAD is GitHub's merge commit: HEAD^1 is the base tip and HEAD^2 the PR tip. The three-dot form diffs from their merge-base, so it covers every PR commit and ignores whatever a merge of the base brought in.
const range=process.env.GITHUB_EVENT_NAME==="pull_request"?["HEAD^1...HEAD^2"]:["HEAD^","HEAD"];
const gitDiff=args=>{try{return execFileSync("git",["diff",...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]});}catch(error){console.error(`Migration safety could not evaluate ${range.join(" ")}; is the checkout shallow? ${error.stderr||error.message}`);process.exit(2);}};
if(!files.length)files=gitDiff(["--name-only","--diff-filter=ACMR",...range,"--","supabase/migrations/*.sql"]).trim().split(/\r?\n/).filter(Boolean);
const hazards=[[/\bdrop\s+(table|column|type|index)\b/i,"DROP"],[/\brename\s+(column|table)\b/i,"RENAME"],[/\balter\s+column\b[\s\S]{0,100}\btype\b/i,"possible full-table rewrite"],[/\bcreate\s+index\b(?!\s+concurrently)/i,"index may lock writes"]];
const addedSql=file=>{if(explicit.length)return readFileSync(file,"utf8");return gitDiff(["--unified=0",...range,"--",file]).split(/\r?\n/).filter(line=>line.startsWith("+")&&!line.startsWith("+++" )).map(line=>line.slice(1)).join("\n");};
let failed=false;for(const file of files){const sql=addedSql(file);for(const[pattern,label]of hazards){if(label==="index may lock writes"&&/quality: allow-nonconcurrent-index reason=new-empty-[a-z0-9-]+-tables/i.test(sql))continue;if(pattern.test(sql)){console.error(`${file}: review required for ${label}`);failed=true;}}}
if(failed)process.exit(1);console.log(`Migration safety passed for ${files.length} changed file(s).`);

