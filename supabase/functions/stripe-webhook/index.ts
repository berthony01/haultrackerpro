import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  console.log(`[STRIPE-WEBHOOK] ${step}${details ? ` - ${JSON.stringify(details)}` : ''}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey) {
    logStep("ERROR", { message: "STRIPE_SECRET_KEY not set" });
    return new Response("Server error", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  let event: Stripe.Event;

  try {
    const body = await req.text();

    if (webhookSecret) {
      const signature = req.headers.get("stripe-signature");
      if (!signature) {
        logStep("ERROR", { message: "No stripe-signature header" });
        return new Response("No signature", { status: 400 });
      }
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } else {
      // Fallback: parse without signature verification (not recommended for production)
      logStep("WARNING: No STRIPE_WEBHOOK_SECRET set, skipping signature verification");
      event = JSON.parse(body);
    }

    logStep("Event received", { type: event.type, id: event.id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logStep("Webhook signature verification failed", { message: msg });
    return new Response(`Webhook Error: ${msg}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        logStep("Checkout completed", { sessionId: session.id, customerId: session.customer, subscriptionId: session.subscription });

        const userId = session.metadata?.user_id;
        if (userId && session.subscription) {
          const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
          const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();

          await supabaseClient.from("profiles").update({
            subscription_status: "pro",
            subscription_plan: "pro",
            stripe_customer_id: session.customer as string,
            stripe_subscription_id: session.subscription as string,
            subscription_expires_at: subscriptionEnd,
          }).eq("user_id", userId);

          logStep("Profile updated to pro", { userId });
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Subscription updated", { subscriptionId: subscription.id, status: subscription.status });

        const customerId = subscription.customer as string;
        const customer = await stripe.customers.retrieve(customerId);
        const email = (customer as Stripe.Customer).email;

        if (!email) {
          logStep("No email on customer, skipping");
          break;
        }

        // Find the user by matching stripe_customer_id or email
        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("user_id, subscription_status")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (!profile) {
          logStep("No profile found for customer", { customerId });
          break;
        }

        const isActive = subscription.status === "active" || subscription.status === "trialing";
        const subscriptionEnd = new Date(subscription.current_period_end * 1000).toISOString();

        if (isActive) {
          await supabaseClient.from("profiles").update({
            subscription_status: "pro",
            subscription_plan: "pro",
            stripe_subscription_id: subscription.id,
            subscription_expires_at: subscriptionEnd,
          }).eq("user_id", profile.user_id);
          logStep("Profile kept/set to pro", { userId: profile.user_id });
        } else if (subscription.status === "canceled" || subscription.status === "unpaid" || subscription.status === "past_due") {
          // Check for manual override
          if (profile.subscription_status === "pro") {
            // Could be manual override - check if there's a stripe_subscription_id match
            // Only downgrade if this subscription matches
            await supabaseClient.from("profiles").update({
              subscription_status: "free",
              subscription_plan: null,
              stripe_subscription_id: null,
              subscription_expires_at: null,
            }).eq("user_id", profile.user_id).eq("stripe_subscription_id", subscription.id);
            logStep("Profile downgraded to free", { userId: profile.user_id });
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        logStep("Subscription deleted", { subscriptionId: subscription.id });

        const { data: profile } = await supabaseClient
          .from("profiles")
          .select("user_id")
          .eq("stripe_subscription_id", subscription.id)
          .maybeSingle();

        if (profile) {
          await supabaseClient.from("profiles").update({
            subscription_status: "free",
            subscription_plan: null,
            stripe_subscription_id: null,
            subscription_expires_at: null,
          }).eq("user_id", profile.user_id);
          logStep("Profile downgraded to free on deletion", { userId: profile.user_id });
        }
        break;
      }

      default:
        logStep("Unhandled event type", { type: event.type });
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR processing event", { message: msg });
    return new Response(JSON.stringify({ error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
