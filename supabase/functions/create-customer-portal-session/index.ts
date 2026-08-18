import { json, requirePost } from "../_shared/http.ts";
import { adminClient, authenticatedUser, siteUrl, stripeClient } from "../_shared/server.ts";
import { BillingAccessError, resolveBillingActor } from "../_shared/billing-access.ts";

Deno.serve(async (req) => {
  const earlyResponse = requirePost(req);
  if (earlyResponse) return earlyResponse;

  try {
    const user = await authenticatedUser(req);
    if (!user) return json(req, { error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const actor = await resolveBillingActor(user, body.athleteId);

    const admin = adminClient();
    const [{ data: billing, error }, { data: coach }] = await Promise.all([
      admin.from("billing_accounts").select("stripe_customer_id, billing_owner_user_id")
        .eq("athlete_id", actor.athleteId).maybeSingle(),
      admin.from("coaches").select("user_id").eq("user_id", user.id).maybeSingle()
    ]);
    if (error) throw error;
    if (coach) return json(req, { error: "Billing user account required" }, 403);
    if (!billing?.stripe_customer_id) return json(req, { error: "No billing account exists" }, 404);
    if (billing.billing_owner_user_id !== user.id) {
      return json(req, { error: "This membership belongs to a different authorized billing user. Contact Odyssey." }, 409);
    }

    const portal = await stripeClient().billingPortal.sessions.create({
      customer: billing.stripe_customer_id,
      return_url: `${siteUrl()}/portal.html`
    });
    return json(req, { url: portal.url });
  } catch (error) {
    if (error instanceof BillingAccessError) return json(req, { error: error.message }, error.status);
    console.error("create-customer-portal-session failed", error);
    return json(req, { error: "Unable to open billing portal" }, 500);
  }
});
