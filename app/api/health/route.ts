import{NextResponse}from"next/server";
export async function GET(){return NextResponse.json({ok:true,service:"masterapp",server_time:new Date().toISOString()},{headers:{"cache-control":"no-store","x-provider-health":"ok"}})}
