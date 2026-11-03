/* eslint-disable @typescript-eslint/no-explicit-any */
// A worker accepts the secret from the environment when one is configured. Otherwise it checks the token against the
// Vault secret that pg_cron sends, so the hosting environment does not need its own copy of that value.
export async function workerAuthorized(admin:any,request:Request,input:{envSecret?:string;vaultName:string}){
  const header=request.headers.get("authorization")||"",token=header.startsWith("Bearer ")?header.slice(7):"";
  if(!token)return false;
  if(input.envSecret)return token===input.envSecret;
  const{data,error}=await admin.rpc("verify_worker_secret",{requested_name:input.vaultName,requested_token:token});
  return !error&&data===true;
}
