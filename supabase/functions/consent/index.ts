import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const escapeHtml=(v:string)=>v.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders}); if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const {token,action}=await req.json(); if(!token||!["accept","decline","unsubscribe"].includes(action))return json({error:"Invalid request"},400);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),resend=Deno.env.get("RESEND_API_KEY"),from=Deno.env.get("RESEND_FROM_EMAIL"); if(!url||!key||!resend||!from)throw new Error("Server configuration is incomplete");
  const admin=createClient(url,key); const {data:t,error:te}=await admin.from("consent_tokens").select("*").eq("token",token).maybeSingle(); if(te)throw te; if(!t||t.used_at||new Date(t.expires_at).getTime()<Date.now())return json({error:"This link is invalid, expired, or already used."},400); if(t.action!==action)return json({error:"This link is not valid for that action."},400);
  const {data:recipient,error:re}=await admin.from("recipients").select("*").eq("id",t.recipient_id).single(); if(re)throw re; const {data:msg,error:me}=await admin.from("messages").select("*").eq("id",t.message_id).single(); if(me)throw me;
  const {error:tu}=await admin.from("consent_tokens").update({used_at:new Date().toISOString()}).eq("id",t.id); if(tu)throw tu;
  const sendEmail=async(to:string,subject:string,html:string)=>{const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resend}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[to],subject,html})});if(!r.ok)throw new Error(`Email send failed: ${await r.text()}`);return r.json();};
  const deleteAssets=async()=>{const paths=[msg.video_path,msg.poster_path].filter(Boolean);if(paths.length){const {error}=await admin.storage.from("videos").remove(paths);if(error)throw error;}};
  if(action==="accept"){
    if(!msg.video_path||!msg.poster_path)return json({error:"The postcard assets are missing."},400);
    const {data:v,error:ve}=await admin.storage.from("videos").createSignedUrl(msg.video_path,60*60*24*3);if(ve)throw ve; const {data:p,error:pe}=await admin.storage.from("videos").createSignedUrl(msg.poster_path,60*60*24*3);if(pe)throw pe;
    const {error:ru}=await admin.from("recipients").update({consent_status:"approved",consent_at:new Date().toISOString(),revoked_at:null}).eq("id",recipient.id);if(ru)throw ru;
    const videoUrl=escapeHtml(v.signedUrl),posterUrl=escapeHtml(p.signedUrl),mime=escapeHtml(msg.video_mime_type||"video/mp4"),sender=escapeHtml(msg.sender_name),text=escapeHtml(msg.message_text||"").replaceAll("\n","<br>");
    const html=`<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto"><p><strong>${sender}</strong> sent you a PSTCRD.</p><p>${text}</p><video controls playsinline preload="metadata" poster="${posterUrl}" width="640" style="display:block;width:100%;max-width:640px;height:auto;background:#111"><source src="${videoUrl}" type="${mime}"><p>Your email app does not support inline video. <a href="${videoUrl}">Watch your postcard</a>.</p></video><p style="margin:16px 0 6px">If the video does not play above:</p><p><a href="${videoUrl}"><img src="${posterUrl}" alt="Video postcard. Click to watch." width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0"></a></p><p><a href="${videoUrl}">Watch your postcard</a></p><p style="font-size:13px;color:#666">The video link is available for 3 days.</p></div>`;
    await sendEmail(recipient.email,`Postcard from ${msg.sender_name}`,html); const {error:mu}=await admin.from("messages").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",msg.id);if(mu)throw mu; return json({message:"Accepted. Your postcard has been emailed to you."});
  }
  if(action==="decline"){await admin.from("messages").update({status:"declined"}).eq("id",msg.id);await deleteAssets();return json({message:"Declined. No postcard was delivered."});}
  const {error:ru}=await admin.from("recipients").update({consent_status:"revoked",revoked_at:new Date().toISOString()}).eq("id",recipient.id);if(ru)throw ru;
  const {data:pending,error:pe2}=await admin.from("messages").select("id,video_path,poster_path").eq("recipient_id",recipient.id).eq("status","pending_consent");if(pe2)throw pe2;
  for(const item of pending??[]){await admin.from("messages").update({status:"declined"}).eq("id",item.id);const paths=[item.video_path,item.poster_path].filter(Boolean);if(paths.length){const {error}=await admin.storage.from("videos").remove(paths);if(error)throw error;}}
  return json({message:"Future requests from this service have been stopped."});
 }catch(error){console.error(error);return json({error:error instanceof Error?error.message:"Server error"},500);}
});
