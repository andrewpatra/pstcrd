import { postcardEmail, consentRequestEmail } from "../_shared/email-template.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, "Content-Type": "application/json" },
});
const escapeHtml = (v: string) => String(v).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));


Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { messageId } = await req.json();
    if (!messageId) return json({ error: "Missing message ID" }, 400);

    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resend = Deno.env.get("RESEND_API_KEY");
    const base = Deno.env.get("APP_BASE_URL");
    const from = Deno.env.get("RESEND_FROM_EMAIL");
    const consentFrom = Deno.env.get("CONSENT_FROM_EMAIL") || "PSTCRD <envelope@pstcrd.art>";
    const deliveryFrom = "PSTCRD Delivery <envelope@pstcrd.art>";
    const replyTo = Deno.env.get("RESEND_REPLY_TO_EMAIL");
    if (!url || !key || !resend || !base || !from) throw new Error("Server configuration is incomplete");
    const admin = createClient(url, key);
    const { data: msg, error: mErr } = await admin.from("messages").select("*, recipients(*)").eq("id", messageId).maybeSingle();
    if (mErr) throw mErr;
    if (!msg) return json({ error: "Message not found" }, 404);
    if (msg.status !== "uploading") return json({ error: "Message is not ready to send" }, 400);
    if (!msg.video_path || !msg.poster_path) return json({ error: "Postcard assets are missing" }, 400);
    const recipient = msg.recipients;
    if (!recipient) return json({ error: "Recipient not found" }, 400);

    const exists = async (path: string, folder: string) => {
      const name = path.split("/").pop();
      const { data, error } = await admin.storage.from("videos").list(folder, { limit: 1000, search: name });
      if (error) throw error;
      return !!data?.some((x) => x.name === name);
    };
    let ve = false, pe = false;
    for (let i = 0; i < 5 && (!ve || !pe); i++) {
      ve = ve || await exists(msg.video_path, "messages");
      pe = pe || await exists(msg.poster_path, "posters");
      if (!ve || !pe) await sleep(200);
    }
    if (!ve || !pe) return json({ error: "Postcard upload was not found" }, 400);

    const sendEmail = async (to: string, subject: string, html: string, plainText: string, senderAddress = from) => {
      const payload: Record<string, unknown> = {
        from: senderAddress, to: [to], subject, html, text: plainText,
      };
      if (replyTo) payload.reply_to = replyTo;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`Email send failed: ${await r.text()}`);
      return r.json();
    };

    const senderName = String(msg.sender_name || "Someone");
    const sender = escapeHtml(senderName);
    const messageText = String(msg.message_text || "");
    const formattedMessage = escapeHtml(messageText).replaceAll(/\r?\n/g, "<br>");
    const videoType = escapeHtml(String(msg.video_mime_type || "video/mp4"));

    // The sender identity must be verified on BOTH upload preparation and finalization.
    const jwt = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({error: "Sender authentication required"}, 401);
    const {data: auth, error: authError} = await admin.auth.getUser(jwt);
    if (authError || !auth.user?.email_confirmed_at || !auth.user.email) return json({error: "Verified sender required"}, 401);
    if (!msg.sender_id || msg.sender_id !== auth.user.id) return json({error: "This postcard belongs to another sender"}, 403);
    const {data: pairConsent, error: pairError} = await admin.from("sender_recipient_consent")
      .select("status").eq("sender_id", msg.sender_id).eq("recipient_id", recipient.id).maybeSingle();
    if (pairError) throw pairError;
    if (pairConsent?.status === "revoked") return json({error: "This recipient has stopped requests from this sender"}, 403);
    if (pairConsent?.status === "approved") {
      const {data: v, error: ve2} = await admin.storage.from("videos").createSignedUrl(msg.video_path, 60*60*24*3);
      if (ve2) throw ve2;
      const {data: p, error: pe2} = await admin.storage.from("videos").createSignedUrl(msg.poster_path, 60*60*24*3);
      if (pe2) throw pe2;
      const content = postcardEmail({senderName, messageText, videoUrl:v.signedUrl, posterUrl:p.signedUrl, videoMimeType:String(msg.video_mime_type || "video/mp4")});
      await sendEmail(recipient.email, `A postcard from ${senderName} | PSTCRD`, content.html, content.text, deliveryFrom);
      const {error: uErr} = await admin.from("messages").update({status:"sent",sent_at:new Date().toISOString()}).eq("id",msg.id);
      if (uErr) throw uErr;
      return json({message:"Postcard sent."});
    }
    if (!pairConsent) {
      const {error: insertError} = await admin.from("sender_recipient_consent").insert({sender_id:msg.sender_id,recipient_id:recipient.id,status:"pending"});
      if (insertError && insertError.code !== "23505") throw insertError;
    }

    const tokens: Record<string, string> = {};
    for (const action of ["accept", "decline", "unsubscribe"] as const) {
      const { data: t, error: e } = await admin.from("consent_tokens")
        .insert({ recipient_id: recipient.id, message_id: msg.id, action }).select("token").single();
      if (e) throw e;
      tokens[action] = t.token;
    }
    const accept = `${base}/consent.html?token=${encodeURIComponent(tokens.accept)}&action=accept`;
    const decline = `${base}/consent.html?token=${encodeURIComponent(tokens.decline)}&action=decline`;
    const unsubscribe = `${base}/consent.html?token=${encodeURIComponent(tokens.unsubscribe)}&action=unsubscribe`;
    const consentContent = consentRequestEmail({senderName, senderEmail:auth.user.email, accept, decline, unsubscribe});
    await sendEmail(recipient.email, `${senderName} wants to send you a postcard | PSTCRD`, consentContent.html, consentContent.text, consentFrom);
    const { error: uErr } = await admin.from("messages").update({ status: "pending_consent" }).eq("id", msg.id);
    if (uErr) throw uErr;
    return json({ message: "The recipient has been sent a consent request." });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Server error" }, 500);
  }
});
