import type Stripe from "npm:stripe@22.1.1";
import { adminClient, stripeClient, stripePriceId, webhookSecret } from "../_shared/server.ts";
import { updateInvoiceAudit } from "../_shared/invoice.ts";
import { subscriptionSnapshot } from "../_shared/subscription.ts";

async function syncSubscription(subscription: Stripe.Subscription, eventCreated: number, observedAt: string) {
  const admin = adminClient();
  const assignmentId = subscription.metadata.member_plan_assignment_id;
  const planVersionId = subscription.metadata.membership_plan_version_id;
  const subscriptionPriceId = subscription.items.data[0]?.price.id;
  let expectedPriceId = stripePriceId();

  if (assignmentId || planVersionId) {
    if (!assignmentId || !planVersionId || !subscriptionPriceId) {
      throw new Error("Incomplete membership metadata on Stripe subscription");
    }
    const { data: mapping, error: mappingError } = await admin
      .from("membership_plan_billing_mappings")
      .select("external_price_id")
      .eq("plan_version_id", planVersionId)
      .eq("external_price_id", subscriptionPriceId)
      .eq("enabled", true)
      .maybeSingle();
    if (mappingError) throw mappingError;
    if (!mapping) throw new Error("Stripe subscription Price does not match its membership plan");
    expectedPriceId = mapping.external_price_id;
  }

  const snapshot = subscriptionSnapshot(subscription, expectedPriceId, eventCreated, observedAt);
  if (!snapshot) return;
  const { error } = await admin.rpc("apply_billing_subscription_snapshot", { snapshot });
  if (error) throw error;
  if (assignmentId && planVersionId) {
    const { error: activationError } = await admin.rpc("activate_youth_membership_assignment", {
      target_assignment_id: assignmentId,
      target_plan_version_id: planVersionId,
      target_stripe_price_id: expectedPriceId,
      target_stripe_subscription_id: subscription.id,
      target_subscription_status: subscription.status
    });
    if (activationError) throw activationError;
  }
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
