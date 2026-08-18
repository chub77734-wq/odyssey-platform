import type Stripe from "npm:stripe@22.1.1";
import { adminClient, stripeClient, stripePriceId, webhookSecret } from "../_shared/server.ts";
import { updateInvoiceAudit } from "../_shared/invoice.ts";
import { subscriptionSnapshot } from "../_shared/subscription.ts";

async function syncSubscription(subscription: Stripe.Subscription, eventCreated: number, observedAt: string) {
  const snapshot = subscriptionSnapshot(subscription, stripePriceId(), eventCreated, observedAt);
  if (!snapshot) return;
  const admin = adminClient();
  const { error } = await admin.rpc("apply_billing_subscription_snapshot", { snapshot });
  if (error) throw error;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe signature", { status: 400 });

  try {
    const rawBody = await req.text();
    const stripe = stripeClient();
    const event = await stripe.webhooks.constructEventAsync(rawBody, signature, webhookSecret());

    if ([
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted"
    ].includes(event.type)) {
      const eventSubscription = event.data.object as Stripe.Subscription;
      const current = await stripe.subscriptions.retrieve(eventSubscription.id);
      await syncSubscription(current, event.created, new Date().toISOString());
    } else if (event.type === "checkout.session.completed") {
      const checkout = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = typeof checkout.subscription === "string"
        ? checkout.subscription
        : checkout.subscription?.id;
      if (subscriptionId) {
        const current = await stripe.subscriptions.retrieve(subscriptionId);
        await syncSubscription(current, event.created, new Date().toISOString());
      }
    } else if (event.type.startsWith("invoice.")) {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.metadata.odyssey_invoice === "true") {
        await updateInvoiceAudit(invoice, event.created, event.type === "invoice.sent"
          ? { sent_at: new Date(event.created * 1000).toISOString() }
          : {});
      }
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error("stripe-webhook failed", error);
    return new Response("Invalid webhook", { status: 400 });
  }
});
