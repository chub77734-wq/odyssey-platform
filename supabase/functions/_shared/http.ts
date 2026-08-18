const localOrigins = new Set(["http://localhost:8000", "http://127.0.0.1:8000"]);

function allowedOrigins() {
  const configured = Deno.env.get("SITE_URL");
  return new Set([...localOrigins, ...(configured ? [new URL(configured).origin] : [])]);
}
export function corsHeaders(req: Request) {
  const origin = req.headers.get("origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins().has(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

export function json(req: Request, body: unknown, status = 200) {
  return Response.json(body, { status, headers: corsHeaders(req) });
}

export function handleOptions(req: Request) {
  const origin = req.headers.get("origin") || "";
  if (!allowedOrigins().has(origin)) return json(req, { error: "Origin not allowed" }, 403);
  return new Response("ok", { headers: corsHeaders(req) });
}

export function requirePost(req: Request) {
  if (req.method === "OPTIONS") return handleOptions(req);
  if (req.method !== "POST") return json(req, { error: "Method not allowed" }, 405);
  return null;
}
