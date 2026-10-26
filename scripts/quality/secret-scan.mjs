import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files=execFileSync("git",["ls-files"],{encoding:"utf8"}).trim().split(/\r?\n/).filter(file=>file&&!/^(dist|node_modules)\//.test(file)&&!/(pnpm-lock\.yaml|\.(png|jpg|jpeg|webp|ico))$/i.test(file));
const patterns=[/-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,/\b(?:access[_-]?token|api[_-]?key|password|secret)\s*[:=]\s*["'][A-Za-z0-9_\-/.]{20,}["']/i,/sb_secret_[A-Za-z0-9_-]{20,}/];
const findings=[];for(const file of files){let source="";try{source=readFileSync(file,"utf8");}catch{continue;}patterns.forEach(pattern=>{if(pattern.test(source))findings.push(file);});}
if(findings.length){console.error(`Potential secrets: ${[...new Set(findings)].join(", ")}`);process.exit(1);}console.log(`Secret scan passed for ${files.length} tracked files.`);

