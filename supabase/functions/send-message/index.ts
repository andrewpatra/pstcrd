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

const createYourOwnUrl = "https://www.pstcrd.art";
const emailFont = "'Roboto Serif', Georgia, 'Times New Roman', serif";

const emailLayout = (body: string) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Roboto+Serif:wght@400;600;700&display=swap" rel="stylesheet"></head>
<body style="margin:0;padding:0;background:#FFF0DA;color:#222222;font-family:${emailFont};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#FFF0DA;"><tr><td align="center" style="padding:32px 16px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background:#FFF0DA;border:1px solid #cdbb9f;font-family:${emailFont};">
<tr><td style="padding:32px 32px 12px;font-family:${emailFont};font-size:25px;font-weight:bold;letter-spacing:2px;">PSTCRD</td></tr>
<tr><td style="padding:8px 32px 32px;font-family:${emailFont};font-size:16px;line-height:1.6;">${body}</td></tr>
<tr><td style="padding:18px 32px 26px;border-top:1px solid #cdbb9f;color:#554b3e;font-family:${emailFont};font-size:13px;line-height:1.8;"><a href="${createYourOwnUrl}" style="color:#222222;text-decoration:underline;font-family:${emailFont};font-weight:600;">Create Your Own</a><div style="margin-top:8px;font-size:12px;">Sent through PSTCRD &middot; <a href="https://pstcrd.art" style="color:#554b3e;">pstcrd.art</a></div></td></tr>
</table></td></tr></table></body></html>`;
const primaryLink = (url: string, label: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td bgcolor="#222222" style="padding:13px 20px;"><a href="${escapeHtml(url)}" style="color:#ffffff;text-decoration:none;font-family:${emailFont};font-size:15px;font-weight:bold;display:inline-block;">${escapeHtml(label)}</a></td></tr></table>`;

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

    if (recipient.consent_status === "approved") {
      const { data: v, error: ve2 } = await admin.storage.from("videos").createSignedUrl(msg.video_path, 60 * 60 * 24 * 3);
      if (ve2) throw ve2;
      const { data: p, error: pe2 } = await admin.storage.from("videos").createSignedUrl(msg.poster_path, 60 * 60 * 24 * 3);
      if (pe2) throw pe2;
      const videoUrl = v.signedUrl;
      const posterUrl = p.signedUrl;
      const html = emailLayout(`
        <p style="margin:0 0 18px;"><strong>${sender}</strong> sent you a video postcard.</p>
        ${messageText ? `<p style="margin:0 0 22px;white-space:normal;">${formattedMessage}</p>` : ""}
        <a href="${escapeHtml(videoUrl)}" style="display:block;text-decoration:none;"><img src="${escapeHtml(posterUrl)}" alt="Preview of your video postcard" width="536" style="display:block;width:100%;max-width:536px;height:auto;border:0;background:#eeeeee;"></a>
        ${primaryLink(videoUrl, "Watch your postcard")}
        <p style="margin:0;color:#666666;font-size:13px;">The video link is available for 3 days. If the preview doesn't appear, use the button above.</p>
      `);
      const plainText = `${senderName} sent you a video postcard through PSTCRD.\n\n${messageText ? messageText + "\n\n" : ""}Watch your postcard: ${videoUrl}\n\nThe video link is available for 3 days.\n\nCreate Your Own: ${createYourOwnUrl}\n\nPSTCRD — https://pstcrd.art`;
      await sendEmail(recipient.email, `A postcard from ${senderName} | PSTCRD`, html, plainText);
      const { error: uErr } = await admin.from("messages").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", msg.id);
      if (uErr) throw uErr;
      return json({ message: "Postcard sent." });
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
    const consentHtml = emailLayout(`
      <p style="margin:0 0 16px;"><strong>${sender}</strong> would like to send you a video postcard through PSTCRD.</p>
      <p style="margin:0 0 16px;">You'll receive this postcard only if you choose to accept it.</p>
      ${primaryLink(accept, "Accept this postcard")}
      <p style="margin:0 0 12px;font-size:14px;"><a href="${escapeHtml(decline)}" style="color:#444444;">Decline this postcard</a></p>
      <p style="margin:0 0 12px;font-size:14px;"><a href="${escapeHtml(unsubscribe)}" style="color:#666666;">Stop future postcard requests</a></p>
      <p style="margin:20px 0 0;color:#666666;font-size:13px;">If you weren't expecting this request, you can ignore it. No postcard will be delivered unless you accept.</p>
    `);
    const consentText = `${senderName} would like to send you a video postcard through PSTCRD.\n\nYou'll receive this postcard only if you accept.\n\nAccept: ${accept}\n\nDecline: ${decline}\n\nStop future postcard requests: ${unsubscribe}\n\nIf you weren't expecting this request, you can ignore it. No postcard will be delivered unless you accept.\n\nCreate Your Own: ${createYourOwnUrl}\n\nPSTCRD — https://pstcrd.art`;
    await sendEmail(recipient.email, `${senderName} wants to send you a postcard | PSTCRD`, consentHtml, consentText, consentFrom);
    const { error: uErr } = await admin.from("messages").update({ status: "pending_consent" }).eq("id", msg.id);
    if (uErr) throw uErr;
    return json({ message: "The recipient has been sent a consent request." });
  } catch (error) {
    console.error(error);
    return json({ error: error instanceof Error ? error.message : "Server error" }, 500);
  }
});
