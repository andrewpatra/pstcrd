const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { senderName, recipientEmail, message, gifPath, gifSizeBytes } = await req.json();
    const sender = String(senderName ?? "").trim();
    const email = String(recipientEmail ?? "").trim().toLowerCase();
    const text = String(message ?? "").trim();
    const path = String(gifPath ?? "").trim();
    const sizeBytes = Number(gifSizeBytes);

    if (!sender || sender.length > 100) return json({ error: "Invalid sender name" }, 400);
    if (!email || email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return json({ error: "Invalid recipient email" }, 400);
    if (text.length > 2000) return json({ error: "Message is too long" }, 400);
    if (!/^incoming\/[0-9a-f-]+\.gif$/i.test(path)) return json({ error: "Invalid GIF path" }, 400);
    if (!Number.isInteger(sizeBytes) || sizeBytes <= 0 || sizeBytes > 3_000_000) return json({ error: "Invalid GIF size" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const appBaseUrl = Deno.env.get("APP_BASE_URL")!;
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL")!;

    const dbHeaders = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    };

    // Confirm the uploaded object exists before recording the message.
    const objectCheck = await fetch(`${supabaseUrl}/storage/v1/object/info/postcards/${encodeURIComponent(path)}`, {
      headers: dbHeaders,
    });
    if (!objectCheck.ok) return json({ error: "Uploaded GIF was not found" }, 400);

    const lookup = await fetch(
      `${supabaseUrl}/rest/v1/recipients?email=eq.${encodeURIComponent(email)}&select=*`,
      { headers: dbHeaders },
    );
    if (!lookup.ok) throw new Error(`Recipient lookup failed: ${await lookup.text()}`);
    const rows = await lookup.json();

    let recipient: any;
    if (rows.length) recipient = rows[0];
    else {
      const createRecipient = await fetch(`${supabaseUrl}/rest/v1/recipients`, {
        method: "POST",
        headers: { ...dbHeaders, Prefer: "return=representation" },
        body: JSON.stringify({ email }),
      });
      if (!createRecipient.ok) throw new Error(`Recipient creation failed: ${await createRecipient.text()}`);
      recipient = (await createRecipient.json())[0];
    }

    const createMessage = await fetch(`${supabaseUrl}/rest/v1/messages`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "return=representation" },
      body: JSON.stringify({
        recipient_id: recipient.id,
        sender_name: sender,
        message_text: text,
        gif_path: path,
        gif_mime_type: "image/gif",
        gif_size_bytes: sizeBytes,
        status: recipient.consent_status === "approved" ? "pending_consent" : "pending_consent",
      }),
    });
    if (!createMessage.ok) throw new Error(`Message creation failed: ${await createMessage.text()}`);
    const messageRow = (await createMessage.json())[0];

    const sendEmail = async (to: string, subject: string, html: string, attachments?: unknown[]) => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: fromEmail, to: [to], subject, html, ...(attachments ? { attachments } : {}) }),
      });
      if (!response.ok) throw new Error(`Email send failed: ${await response.text()}`);
      return response.json();
    };

    const sendGifEmail = async () => {
      const fileResponse = await fetch(`${supabaseUrl}/storage/v1/object/postcards/${encodeURIComponent(path)}`, {
        headers: dbHeaders,
      });
      if (!fileResponse.ok) throw new Error(`GIF download failed: ${await fileResponse.text()}`);
      const bytes = new Uint8Array(await fileResponse.arrayBuffer());
      const content = toBase64(bytes);
      return sendEmail(
        email,
        `Postcard from ${sender}`,
        `<p><strong>${escapeHtml(sender)}</strong> sent you a PSTCRD.</p>${text ? `<p>${escapeHtml(text).replaceAll("\n", "<br>")}</p>` : ""}<p><img src="cid:pstcrd-gif" alt="Animated postcard" style="display:block;max-width:100%;height:auto;"></p><p>— PSTCRD</p>`,
        [{ content, filename: "pstcrd.gif", content_id: "pstcrd-gif", content_type: "image/gif" }],
      );
    };

    if (recipient.consent_status === "approved") {
      await sendGifEmail();
      await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageRow.id}`, {
        method: "PATCH",
        headers: dbHeaders,
        body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }),
      });
      return json({ message: "Postcard sent." });
    }

    const tokenResponse = await fetch(`${supabaseUrl}/rest/v1/consent_tokens`, {
      method: "POST",
      headers: { ...dbHeaders, Prefer: "return=representation" },
      body: JSON.stringify({ recipient_id: recipient.id, message_id: messageRow.id, action: "accept" }),
    });
    if (!tokenResponse.ok) throw new Error(`Consent token creation failed: ${await tokenResponse.text()}`);
    const acceptToken = (await tokenResponse.json())[0].token;
    const acceptUrl = `${appBaseUrl}/consent.html?token=${encodeURIComponent(acceptToken)}&action=accept`;

    await sendEmail(
      email,
      `${sender} wants to send you a postcard`,
      `<p><strong>${escapeHtml(sender)}</strong> would like to send you a PSTCRD postcard.</p><p>You will only receive it if you accept.</p><p><a href="${acceptUrl}">Accept this postcard</a></p><p>You can decline this request or stop future requests from the consent page.</p>`,
    );

    return json({ message: "The recipient has been sent a consent request." });
  } catch (error) {
    console.error(error);
    return json({ error: "Server error" }, 500);
  }
});
