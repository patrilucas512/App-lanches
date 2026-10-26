import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
const cell=(value:unknown)=>'"'+String(value??"").replaceAll('"','""')+'"';
export async function GET(request:Request){
 const url=new URL(request.url),establishmentId=url.searchParams.get("establishment_id"),start=url.searchParams.get("start"),end=url.searchParams.get("end");
 if(!establishmentId||!start||!end)return NextResponse.json({error:"Parâmetros incompletos."},{status:400});
 const db=await createClient();const {data:summary,error}=await db.rpc("fiscal_phase19_summary",{requested_establishment_id:establishmentId,requested_start:start,requested_end:end});
 if(error)return NextResponse.json({error:error.message},{status:403});
 const documents=(summary as Record<string,any>)?.documents||[];const rows=[["id","direção","tipo","status","provedor","ambiente","número","série","valor_centavos","pedido","compra","emitido_em","criado_em"],...documents.map((d:Record<string,unknown>)=>[d.id,d.direction,d.document_type,d.status,d.provider,d.environment,d.document_number,d.series,d.total_cents,d.order_id,d.purchase_order_id,d.issued_at,d.created_at])];
 const csv="\uFEFF"+rows.map((row:unknown[])=>row.map(cell).join(";")).join("\n");
 return new NextResponse(csv,{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":'attachment; filename="masterapp-fiscal-'+start+'-'+end+'.csv"',"cache-control":"private, no-store"}});
}
