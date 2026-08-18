import { createClient, Stripe } from "./deps.ts";

function env(...names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  throw new Error(`Missing required environment variable: ${names[0]}`);
}

function apiKey(mapName: string, ...fallbackNames: string[]) {
  const keyMap = Deno.env.get(mapName);
  if (keyMap) {
    const defaultKey = JSON.parse(keyMap).default;
    if (defaultKey) return defaultKey;
  }
  return env(...fallbackNames);
}

export function stripeClient() {
  return new Stripe(env("STRIPE_SECRET_KEY"), {
    httpClient: Stripe.createFetchHttpClient()
  });
}

export function adminClient() {
  return createClient(
    env("SUPABASE_URL"),
    apiKey("SUPABASE_SECRET_KEYS", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function authenticatedUser(req: Request) {
  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  const client = createClient(
    env("SUPABASE_URL"),
    apiKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await client.auth.getUser(token);
  if (error) return null;
  return data.user;
}

export function siteUrl() {
  return env("SITE_URL").replace(/\/$/, "");
}

export function stripePriceId() {
  return env("STRIPE_PRICE_ID");
}

export function webhookSecret() {
  return env("STRIPE_WEBHOOK_SECRET");
}
