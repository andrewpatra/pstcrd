import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});
const escapeHtml=(v:string)=>v.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;");
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return json({error:"Method not allowed"},405);
 try{
  const {messageId}=await req.json(); if(!messageId)return json({error:"Missing message ID"},400);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),resend=Deno.env.get("RESEND_API_KEY"),base=Deno.env.get("APP_BASE_URL"),from=Deno.env.get("RESEND_FROM_EMAIL");
  if(!url||!key||!resend||!base||!from)throw new Error("Server configuration is incomplete");
  const admin=createClient(url,key);
  const {data:msg,error:mErr}=await admin.from("messages").select("*, recipients(*)").eq("id",messageId).maybeSingle(); if(mErr)throw mErr;
  if(!msg)return json({error:"Message not found"},404); if(msg.status!=="uploading")return json({error:"Message is not ready to send"},400);
  if(!msg.video_path||!msg.poster_path)return json({error:"Postcard assets are missing"},400); const recipient=msg.recipients; if(!recipient)return json({error:"Recipient not found"},400);
  const exists=async(path:string,folder:string)=>{const name=path.split("/").pop(); const {data,error}=await admin.storage.from("videos").list(folder,{limit:1000,search:name}); if(error)throw error; return !!data?.some(x=>x.name===name);};
  let ve=false,pe=false; for(let i=0;i<5&&(!ve||!pe);i++){ve=ve||await exists(msg.video_path,"messages");pe=pe||await exists(msg.poster_path,"posters");if(!ve||!pe)await sleep(200);}
  if(!ve||!pe)return json({error:"Postcard upload was not found"},400);
  const sendEmail=async(to:string,subject:string,html:string)=>{const r=await fetch("https://api.resend.com/emails",{method:"POST",headers:{Authorization:`Bearer ${resend}`,"Content-Type":"application/json"},body:JSON.stringify({from,to:[to],subject,html})});if(!r.ok)throw new Error(`Email send failed: ${await r.text()}`);return r.json();};
  const videoType=escapeHtml(msg.video_mime_type||"video/mp4"),sender=escapeHtml(msg.sender_name),text=escapeHtml(msg.message_text||"").replaceAll("\n","<br>");
  const videoEmail=async()=>{
    const {data:v,error:ve2}=await admin.storage.from("videos").createSignedUrl(msg.video_path,60*60*24*3); if(ve2)throw ve2;
    const {data:p,error:pe2}=await admin.storage.from("videos").createSignedUrl(msg.poster_path,60*60*24*3); if(pe2)throw pe2;
    const videoUrl=escapeHtml(v.signedUrl),posterUrl=escapeHtml(p.signedUrl);
    return `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto"><p><strong>${sender}</strong> sent you a PSTCRD.</p><p>${text}</p><video controls playsinline preload="metadata" poster="${posterUrl}" width="640" style="display:block;width:100%;max-width:640px;height:auto;background:#111"><source src="${videoUrl}" type="${videoType}"><p>Your email app does not support inline video. <a href="${videoUrl}">Watch your postcard</a>.</p></video><p style="margin:16px 0 6px">If the video does not play above:</p><p><a href="${videoUrl}"><img src="${posterUrl}" alt="Video postcard. Click to watch." width="640" style="display:block;width:100%;max-width:640px;height:auto;border:0"></a></p><p><a href="${videoUrl}">Watch your postcard</a></p><p style="font-size:13px;color:#666">The video link is available for 3 days.</p></div>`;
  };
  if(recipient.consent_status==="approved"){
    await sendEmail(recipient.email,`Postcard from ${msg.sender_name}`,await videoEmail());
    const {error:uErr}=await admin.from("messages").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",msg.id);if(uErr)throw uErr;
    return json({message:"Postcard sent."});
  }
  const tokens:Record<string,string>={}; for(const action of ["accept","decline","unsubscribe"] as const){const {data:t,error:e}=await admin.from("consent_tokens").insert({recipient_id:recipient.id,message_id:msg.id,action}).select("token").single();if(e)throw e;tokens[action]=t.token;}
  const accept=`${base}/consent.html?token=${encodeURIComponent(tokens.accept)}&action=accept`,decline=`${base}/consent.html?token=${encodeURIComponent(tokens.decline)}&action=decline`,unsubscribe=`${base}/consent.html?token=${encodeURIComponent(tokens.unsubscribe)}&action=unsubscribe`;
  await sendEmail(recipient.email,`${msg.sender_name} wants to send you a postcard`, `<div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto"><p><strong>${sender}</strong> would like to send you a video postcard through PSTCRD.</p><p>You will only receive the postcard if you accept.</p><p><a href="${escapeHtml(accept)}">Accept this postcard</a></p><p><a href="${escapeHtml(decline)}">Decline this postcard</a></p><p><a href="${escapeHtml(unsubscribe)}">Stop future requests</a></p></div>`);
  const {error:uErr}=await admin.from("messages").update({status:"pending_consent"}).eq("id",msg.id);if(uErr)throw uErr;
  return json({message:"The recipient has been sent a consent request."});
 }catch(error){console.error(error);return json({error:error instanceof Error?error.message:"Server error"},500);}
});
