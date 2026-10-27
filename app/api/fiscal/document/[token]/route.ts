import {NextResponse} from "next/server";
import {createAdminClient} from "@/lib/supabase/admin";
export async function GET(_request:Request,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;const db=createAdminClient();const {data,error}=await db.rpc("fiscal_resolve_magic_link",{requested_token:token});
 if(error)return NextResponse.json({error:"Link inválido, expirado ou sem arquivo."},{status:404});
 const value=data as Record<string,unknown>,path=String(value.pdf_storage_path||value.xml_storage_path||"");if(!path)return NextResponse.json({error:"Arquivo indisponível."},{status:404});
 const {data:signed,error:signedError}=await db.storage.from("fiscal-documents").createSignedUrl(path,120,{download:true});
 if(signedError||!signed?.signedUrl)return NextResponse.json({error:"Arquivo indisponível."},{status:404});
 return NextResponse.redirect(signed.signedUrl,{headers:{"cache-control":"private, no-store"}});
}
