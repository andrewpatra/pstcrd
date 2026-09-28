import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers:{...corsHeaders,"Content-Type":"application/json"}});

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", {headers:corsHeaders});
  if (req.method !== "POST") return json({error:"Method not allowed"},405);
  try {
    const {senderName,recipientEmail,message,videoMimeType,videoSizeBytes,posterSizeBytes}=await req.json();
    const sender=String(senderName??"").trim(); const email=String(recipientEmail??"").trim().toLowerCase();
    const text=String(message??"").trim(); const mime=String(videoMimeType??"");
    const videoSize=Number(videoSizeBytes??0); const posterSize=Number(posterSizeBytes??0);
    const normalizedMime = mime.split(";")[0].trim();
    if(!sender||sender.length>100)return json({error:"Invalid sender name"},400);
    if(!email||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:"Invalid recipient email"},400);
    if(text.length>2000)return json({error:"Message is too long"},400);
    if (!["video/mp4", "video/webm"].includes(normalizedMime)) {return json({ error: `Unsupported video type: ${mime}` }, 400);}
    if(!Number.isInteger(videoSize)||videoSize<=0||videoSize>2*1024*1024)return json({error:"Video is too large"},400);
    if(!Number.isInteger(posterSize)||posterSize<=0||posterSize>2*1024*1024)return json({error:"Postcard image is too large"},400);
    const url=Deno.env.get("SUPABASE_URL"); const key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if(!url||!key)throw new Error("Supabase server configuration is incomplete");
    const admin=createClient(url,key);
    let {data:recipient,error:rErr}=await admin.from("recipients").select("*").eq("email",email).maybeSingle();
    if(rErr)throw rErr;
    if(!recipient){const {data:created,error:e}=await admin.from("recipients").insert({email}).select("*").single(); if(e)throw e; recipient=created;}
    const {data:msg,error:mErr}=await admin.from("messages").insert({recipient_id:recipient.id,sender_name:sender,message_text:text,status:"uploading",video_mime_type:normalizedMime,video_size_bytes:videoSize,poster_mime_type:"image/jpeg",poster_size_bytes:posterSize}).select("id").single();
    if(mErr)throw mErr;
    const ext=normalizedMime==="video/mp4"?"mp4":"webm"; const videoPath=`messages/${msg.id}.${ext}`; const posterPath=`posters/${msg.id}.jpg`;
    const {data:videoUpload,error:vErr}=await admin.storage.from("videos").createSignedUploadUrl(videoPath,{upsert:false});
    if(vErr){await admin.from("messages").delete().eq("id",msg.id);throw vErr;}
    const {data:posterUpload,error:pErr}=await admin.storage.from("videos").createSignedUploadUrl(posterPath,{upsert:false});
    if(pErr){await admin.from("messages").delete().eq("id",msg.id);throw pErr;}
    const {error:uErr}=await admin.from("messages").update({video_path:videoPath,poster_path:posterPath}).eq("id",msg.id);
    if(uErr)throw uErr;
    return json({messageId:msg.id,bucket:"videos",videoPath,videoToken:videoUpload.token,posterPath,posterToken:posterUpload.token});
  } catch(error) { console.error(error); return json({error:error instanceof Error?error.message:"Server error"},500); }
});