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
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { token, action } = await req.json();
    if (!token || !["accept", "decline", "unsubscribe"].includes(action)) return json({ error: "Invalid request" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY")!;
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL")!;
    const dbHeaders = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    };

    const tokenLookup = await fetch(`${supabaseUrl}/rest/v1/consent_tokens?token=eq.${encodeURIComponent(token)}&select=*`, { headers: dbHeaders });
    if (!tokenLookup.ok) throw new Error(`Token lookup failed: ${await tokenLookup.text()}`);
    const tokenRows = await tokenLookup.json();
    if (!tokenRows.length) return json({ error: "Invalid or expired link" }, 400);

    const tokenRow = tokenRows[0];
    if (tokenRow.used_at || new Date(tokenRow.expires_at).getTime() < Date.now()) return json({ error: "This link has expired or was already used." }, 400);
    if (tokenRow.action !== action) return json({ error: "This link cannot perform that action." }, 400);

    const recipientLookup = await fetch(`${supabaseUrl}/rest/v1/recipients?id=eq.${tokenRow.recipient_id}&select=*`, { headers: dbHeaders });
    if (!recipientLookup.ok) throw new Error(`Recipient lookup failed: ${await recipientLookup.text()}`);
    const recipient = (await recipientLookup.json())[0];
    if (!recipient) return json({ error: "Recipient not found" }, 400);

    const messageLookup = await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${tokenRow.message_id}&select=*`, { headers: dbHeaders });
    if (!messageLookup.ok) throw new Error(`Message lookup failed: ${await messageLookup.text()}`);
    const messageRow = (await messageLookup.json())[0];
    if (!messageRow) return json({ error: "Message not found" }, 400);

    const sendEmail = async (html: string, attachments?: unknown[]) => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromEmail, to: [recipient.email], subject: `Postcard from ${messageRow.sender_name}`, html, ...(attachments ? { attachments } : {}) }),
      });
      if (!response.ok) throw new Error(`Email send failed: ${await response.text()}`);
      return response.json();
    };

    await fetch(`${supabaseUrl}/rest/v1/consent_tokens?id=eq.${tokenRow.id}`, {
      method: "PATCH",
      headers: dbHeaders,
      body: JSON.stringify({ used_at: new Date().toISOString() }),
    });

    if (action === "accept") {
      await fetch(`${supabaseUrl}/rest/v1/recipients?id=eq.${recipient.id}`, {
        method: "PATCH",
        headers: dbHeaders,
        body: JSON.stringify({ consent_status: "approved", consent_at: new Date().toISOString(), revoked_at: null }),
      });

      if (!messageRow.gif_path) throw new Error("Postcard GIF is missing");
      const fileResponse = await fetch(`${supabaseUrl}/storage/v1/object/postcards/${encodeURIComponent(messageRow.gif_path)}`, { headers: dbHeaders });
      if (!fileResponse.ok) throw new Error(`GIF download failed: ${await fileResponse.text()}`);
      const bytes = new Uint8Array(await fileResponse.arrayBuffer());
      const content = toBase64(bytes);

      await sendEmail(
        `<p><strong>${escapeHtml(messageRow.sender_name)}</strong> sent you a PSTCRD postcard.</p>${messageRow.message_text ? `<p>${escapeHtml(messageRow.message_text).replaceAll("\n", "<br>")}</p>` : ""}<p><img src="cid:pstcrd-gif" alt="Animated postcard" style="display:block;max-width:100%;height:auto;"></p><p>— PSTCRD</p>`,
        [{ content, filename: "pstcrd.gif", content_id: "pstcrd-gif", content_type: "image/gif" }],
      );

      await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageRow.id}`, {
        method: "PATCH",
        headers: dbHeaders,
        body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }),
      });
      return json({ message: "Accepted. The postcard has been emailed to you." });
    }

    if (action === "decline") {
      await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageRow.id}`, {
        method: "PATCH",
        headers: dbHeaders,
        body: JSON.stringify({ status: "declined" }),
      });
      await fetch(`${supabaseUrl}/storage/v1/object/postcards/${encodeURIComponent(messageRow.gif_path)}`, { method: "DELETE", headers: dbHeaders });
      return json({ message: "Declined. No postcard was delivered." });
    }

    await fetch(`${supabaseUrl}/rest/v1/recipients?id=eq.${recipient.id}`, {
      method: "PATCH",
      headers: dbHeaders,
      body: JSON.stringify({ consent_status: "revoked", revoked_at: new Date().toISOString() }),
    });
    await fetch(`${supabaseUrl}/rest/v1/messages?recipient_id=eq.${recipient.id}&status=eq.pending_consent`, {
      method: "PATCH",
      headers: dbHeaders,
      body: JSON.stringify({ status: "declined" }),
    });

    return json({ message: "Future requests from this service have been stopped." });
  } catch (error) {
    console.error(error);
    return json({ error: "Server error" }, 500);
  }
});
