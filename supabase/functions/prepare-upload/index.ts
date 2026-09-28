import { createClient } from "npm:@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { filename, contentType, sizeBytes } = await req.json();
    const safeSize = Number(sizeBytes);
    if (contentType !== "image/gif") return json({ error: "Only GIF postcards are allowed" }, 400);
    if (!Number.isInteger(safeSize) || safeSize <= 0 || safeSize > 3_000_000) {
      return json({ error: "GIF is missing or exceeds the 3 MB limit" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const path = `incoming/${crypto.randomUUID()}.gif`;
    const { data, error } = await admin.storage.from("postcards").createSignedUploadUrl(path, { upsert: false });

    if (error) throw new Error(`Signed upload creation failed: ${error.message}`);
    if (!data?.token) throw new Error("Supabase did not return an upload token");

    return json({ bucket: "postcards", path, token: data.token, filename: String(filename ?? "postcard.gif") });
  } catch (error) {
    console.error(error);
    return json({ error: "Server error" }, 500);
  }
});
