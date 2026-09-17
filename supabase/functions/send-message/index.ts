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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { senderName, recipientEmail, message } = await req.json();
    const sender = String(senderName ?? "").trim();
    const email = String(recipientEmail ?? "").trim().toLowerCase();
    const text = String(message ?? "").trim();

    if (!sender || sender.length > 100) return json({ error: "Invalid sender name" }, 400);
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Invalid recipient email" }, 400);
    }
    if (!text || text.length > 2000) return json({ error: "Invalid message" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const appBaseUrl = Deno.env.get("APP_BASE_URL")!;
    const fromEmail = Deno.env.get("RESEND_FROM_EMAIL");

    const dbHeaders = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    };

    let recipient: any;
    const lookup = await fetch(
      `${supabaseUrl}/rest/v1/recipients?email=eq.${encodeURIComponent(email)}&select=*`,
      { headers: dbHeaders },
    );
    if (!lookup.ok) throw new Error(`Recipient lookup failed: ${await lookup.text()}`);
    const rows = await lookup.json();

    if (rows.length) {
      recipient = rows[0];
    } else {
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
        status: recipient.consent_status === "approved" ? "pending_consent" : "pending_consent",
      }),
    });
    if (!createMessage.ok) throw new Error(`Message creation failed: ${await createMessage.text()}`);
    const messageRow = (await createMessage.json())[0];

    const sendEmail = async (to: string, subject: string, html: string) => {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from: fromEmail, to: [to], subject, html }),
      });
      if (!response.ok) throw new Error(`Email send failed: ${await response.text()}`);
      return response.json();
    };

    if (recipient.consent_status === "approved") {
      await sendEmail(
        email,
        `New message from ${sender}`,
        `<p><strong>${escapeHtml(sender)}</strong> sent you a message:</p><p>${escapeHtml(text).replaceAll("\n", "<br>")}</p>`,
      );
      await fetch(`${supabaseUrl}/rest/v1/messages?id=eq.${messageRow.id}`, {
        method: "PATCH",
        headers: dbHeaders,
        body: JSON.stringify({ status: "sent", sent_at: new Date().toISOString() }),
      });
      return json({ message: "Message sent." });
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
      `${sender} wants to send you a message`,
      `<p><strong>${escapeHtml(sender)}</strong> would like to send you a message through this project.</p><p>You will only receive the message if you accept.</p><p><a href="${acceptUrl}">Accept this message</a></p><p>You can also decline this request or stop future requests from the consent page.</p>`,
    );

    return json({ message: "The recipient has been sent a consent request." });
  } catch (error) {
    console.error(error);
    return json({ error: "Server error" }, 500);
  }
});
