import { createHash, randomUUID } from "node:crypto";
import { mkdirSync,readFileSync,writeFileSync } from "node:fs";
const pkg=JSON.parse(readFileSync("package.json","utf8"));const lock=readFileSync("pnpm-lock.yaml","utf8");
const entries={...pkg.dependencies,...pkg.devDependencies};
const document={bomFormat:"CycloneDX",specVersion:"1.5",serialNumber:`urn:uuid:${randomUUID()}`,version:1,metadata:{timestamp:new Date().toISOString(),component:{type:"application",name:pkg.name,version:pkg.version},properties:[{name:"masterapp:lockfile:sha256",value:createHash("sha256").update(lock).digest("hex")}]},components:Object.entries(entries).map(([name,version])=>({type:"library",name,version:String(version),purl:`pkg:npm/${encodeURIComponent(name)}@${encodeURIComponent(String(version))}`}))};
mkdirSync("artifacts",{recursive:true});writeFileSync("artifacts/masterapp-sbom.cdx.json",JSON.stringify(document,null,2)+"\n");console.log(`SBOM: ${document.components.length} components`);
