// Stripe webhook: grant sessions or unlimited when payment succeeds.
// Deploy: supabase functions deploy stripe-webhook --env-file .env
// Set STRIPE_WEBHOOK_SECRET and SUPABASE_SERVICE_ROLE_KEY in Supabase secrets.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = await import("https://esm.sh/stripe@14.21.0?target=deno");
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY");
const WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method !== "POST") return new Response("OK", { status: 200 });
  const body = await req.text();
  const sig = req.headers.get("stripe-signature");
  if (!sig || !WEBHOOK_SECRET || !STRIPE_SECRET) return new Response("Missing config", { status: 500 });

  let event: { type: string; data: { object: { client_reference_id?: string; customer_email?: string; metadata?: Record<string, string> } } };
  try {
    const s = stripe.default(STRIPE_SECRET);
    event = await s.webhooks.constructEventAsync(body, sig, WEBHOOK_SECRET);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type !== "checkout.session.completed") return new Response("OK", { status: 200 });

  const session = event.data.object;
  const userId = session.client_reference_id ?? session.metadata?.user_id;
  const plan = session.metadata?.plan ?? ""; // 'pack_3' | 'pack_10' | 'unlimited'

  if (!userId || !["pack_3", "pack_10", "unlimited"].includes(plan)) {
    return new Response("OK", { status: 200 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  if (plan === "unlimited") {
    const expires = new Date();
    expires.setMonth(expires.getMonth() + 1);
    const { error } = await supabase
      .from("user_usage")
      .upsert(
        {
          user_id: userId,
          plan: "unlimited",
          plan_expires_at: expires.toISOString(),
          sessions_remaining: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    if (error) console.error(error);
  } else {
    const sessionsToAdd = plan === "pack_3" ? 3 : 10;
    const { data: row } = await supabase.from("user_usage").select("sessions_remaining").eq("user_id", userId).single();
    const current = row?.sessions_remaining ?? 0;
    await supabase
      .from("user_usage")
      .upsert(
        {
          user_id: userId,
          plan,
          sessions_remaining: current + sessionsToAdd,
          plan_expires_at: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
  }

  return new Response("OK", { status: 200 });
});
