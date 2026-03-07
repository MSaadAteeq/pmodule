// Create Stripe Checkout Session for AI Assistant plans.
// Call from app with Authorization: Bearer <user_jwt>. Body: { plan: 'pack_3' | 'pack_10' | 'unlimited' }
// Returns: { url: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = await import("https://esm.sh/stripe@14.21.0?target=deno");
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const PRICES: Record<string, { priceId: string; mode: "payment" | "subscription" }> = {
  pack_3: { priceId: Deno.env.get("STRIPE_PRICE_3") ?? "", mode: "payment" },
  pack_10: { priceId: Deno.env.get("STRIPE_PRICE_10") ?? "", mode: "payment" },
  unlimited: { priceId: Deno.env.get("STRIPE_PRICE_UNLIMITED") ?? "", mode: "subscription" },
};

serve(async (req) => {
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  if (!STRIPE_SECRET) return new Response(JSON.stringify({ error: "Server config error" }), { status: 500 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.id) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });

  let body: { plan?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }
  const plan = body.plan;
  if (!plan || !PRICES[plan]?.priceId) {
    return new Response(JSON.stringify({ error: "Invalid plan" }), { status: 400 });
  }

  const { priceId, mode } = PRICES[plan];
  const s = stripe.default(STRIPE_SECRET);
  const origin = req.headers.get("origin") || "https://app.example.com";
  const session = await s.checkout.sessions.create({
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${origin}/?success=true`,
    cancel_url: `${origin}/?cancel=true`,
    client_reference_id: user.id,
    metadata: { plan },
    subscription_data: mode === "subscription" ? {} : undefined,
  });

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { "Content-Type": "application/json" },
  });
});
