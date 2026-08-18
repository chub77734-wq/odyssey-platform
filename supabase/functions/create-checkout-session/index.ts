import { json, requirePost } from "../_shared/http.ts";
import { adminClient, authenticatedUser, siteUrl, stripeClient, stripePriceId } from "../_shared/server.ts";
import { BillingAccessError, resolveBillingActor } from "../_shared/billing-access.ts";

Deno.serve(async (req) => {
  const earlyResponse = requirePost(req);
  if (earlyResponse) return earlyResponse;

  try {
    const user = await authenticatedUser(req);
    if (!user) return json(req, { error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));

    const admin = adminClient();
    const [{ data: coach }, actor] = await Promise.all([
      admin.from("coaches").select("user_id").eq("user_id", user.id).maybeSingle(),
      resolveBillingActor(user, body.athleteId)
    ]);
    if (coach) return json(req, { error: "Billing user account required" }, 403);
    const { data: billing, error: billingError } = await admin.from("billing_accounts")
      .select("stripe_customer_id, subscription_status, billing_owner_user_id")
      .eq("athlete_id", actor.athleteId).maybeSingle();
    if (billingError) throw billingError;
    if (billing && billing.billing_owner_user_id !== user.id) {
      return json(req, { error: "This membership belongs to a different authorized billing user. Contact Odyssey." }, 409);
    }
    if (billing?.subscription_status && !["canceled", "incomplete_expired"].includes(billing.subscription_status)) {
      return json(req, { error: "A membership already exists. Use Manage Billing instead." }, 409);
    }

    const stripe = stripeClient();
    let customerId = billing?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: actor.billingOwner.email,
        metadata: { athlete_id: actor.athleteId, billing_owner_user_id: user.id }
      }, { idempotencyKey: `odyssey-customer-${actor.athleteId}-${user.id}` });
      customerId = customer.id;
      const { error } = await admin.from("billing_accounts").upsert({
        athlete_id: actor.athleteId,
        stripe_customer_id: customerId,
        billing_owner_user_id: user.id,
        billing_identity_type: actor.identityType,
        updated_at: new Date().toISOString()
      }, { onConflict: "athlete_id" });
      if (error) throw error;
    }

    const returnUrl = `${siteUrl()}/portal.html`;
    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: actor.athleteId,
      line_items: [{ price: stripePriceId(), quantity: 1 }],
      success_url: `${returnUrl}?billing=success`,
      cancel_url: `${returnUrl}?billing=canceled`,
      metadata: { athlete_id: actor.athleteId, billing_owner_user_id: user.id },
      subscription_data: { metadata: { athlete_id: actor.athleteId, billing_owner_user_id: user.id } }
    });
    if (!checkout.url) throw new Error("Checkout session did not include a URL");
    return json(req, { url: checkout.url });
  } catch (error) {
    if (error instanceof BillingAccessError) return json(req, { error: error.message }, error.status);
    console.error("create-checkout-session failed", error);
    return json(req, { error: "Unable to open checkout" }, 500);
  }
});
