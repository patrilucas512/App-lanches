const base=(process.env.TEST_BASE_URL||"").replace(/\/$/,"");if(!base)throw new Error("TEST_BASE_URL is required.");
const production="https://mesa-viva-patrilucas.patricklucas512.chatgpt.site";
if(process.env.TEST_ENVIRONMENT!=="production"&&new URL(base).origin===new URL(production).origin)throw new Error("Non-production smoke cannot target production.");
const paths=["/api/health","/login",process.env.TEST_PUBLIC_MENU_PATH||"/loja/app-lanches"];
for(const path of paths){const started=Date.now();const response=await fetch(base+path,{method:"GET",redirect:"manual",headers:{"user-agent":"MasterApp-QA-Smoke/1.0"}});if(response.status>=500)throw new Error(`${path} returned ${response.status}`);console.log(JSON.stringify({path,status:response.status,duration_ms:Date.now()-started,correlation_id:response.headers.get("x-correlation-id")}));}

