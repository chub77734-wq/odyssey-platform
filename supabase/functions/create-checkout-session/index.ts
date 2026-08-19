import { json, requirePost } from "../_shared/http.ts";
import { adminClient, authenticatedUser, billingEnvironment, siteUrl, stripeClient } from "../_shared/server.ts";
import { BillingAccessError, resolveBillingActor } from "../_shared/billing-access.ts";

Deno.serve(async (req) => {
  const earlyResponse = requirePost(req);
  if (earlyResponse) return earlyResponse;

  try {
    const user = await authenticatedUser(req);
    if (!user) return json(req, { error: "Unauthorized" }, 401);
    const body = await req.json().catch(() => ({}));
    const forbiddenFields = [
      "price", "price_cents", "amount", "currency", "external_price_id",
      "stripePriceId", "weekly_selected_day_count", "environment"
    ];
    if (!body || typeof body !== "object" || forbiddenFields.some((field) => field in body)) {
      return json(req, { error: "Price and billing configuration are server-controlled" }, 400);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey || "")) {
      return json(req, { error: "A valid enrollment request ID is required" }, 422);
    }

    const admin = adminClient();
    const [{ data: coach }, actor] = await Promise.all([
      admin.from("coaches").select("user_id").eq("user_id", user.id).maybeSingle(),
      resolveBillingActor(user, body.athleteId)
    ]);
    if (coach) return json(req, { error: "Billing user account required" }, 403);
    const { data: billing, error: billingError } = await admin.from("billing_accounts")
      .select("stripe_customer_id, stripe_subscription_id, subscription_status, billing_owner_user_id, member_plan_assignment_id")
      .eq("athlete_id", actor.athleteId).maybeSingle();
    if (billingError) throw billingError;
    if (billing && billing.billing_owner_user_id !== user.id) {
      return json(req, { error: "This membership belongs to a different authorized billing user. Contact Odyssey." }, 409);
    }
    const stripe = stripeClient();
    if (billing?.subscription_status === "incomplete") {
      if (!billing.member_plan_assignment_id || !billing.stripe_subscription_id) {
        return json(req, { error: "Incomplete membership requires Odyssey support" }, 409);
      }
      const { data: pendingAssignment, error: pendingError } = await admin
        .from("member_plan_assignments")
        .select("id, status, reservation_expires_at")
        .eq("id", billing.member_plan_assignment_id)
        .eq("athlete_id", actor.athleteId)
        .eq("billing_owner_user_id", user.id)
        .maybeSingle();
      if (pendingError) throw pendingError;
      if (!pendingAssignment || pendingAssignment.status !== "pending" || !pendingAssignment.reservation_expires_at) {
        return json(req, { error: "Incomplete membership reservation is unavailable" }, 409);
      }

      const incompleteSubscription = await stripe.subscriptions.retrieve(
        billing.stripe_subscription_id,
        { expand: ["latest_invoice"] }
      );
      if (incompleteSubscription.status !== "incomplete"
        || incompleteSubscription.metadata.member_plan_assignment_id !== pendingAssignment.id
        || incompleteSubscription.metadata.athlete_id !== actor.athleteId
        || incompleteSubscription.metadata.billing_owner_user_id !== user.id) {
        return json(req, { error: "Incomplete membership could not be verified" }, 409);
      }

      if (new Date(pendingAssignment.reservation_expires_at).getTime() <= Date.now()) {
        const { error: renewalError } = await admin.rpc("renew_youth_membership_reservation", {
          target_assignment_id: pendingAssignment.id,
          target_billing_owner_user_id: user.id
        });
        if (renewalError) {
          await stripe.subscriptions.cancel(incompleteSubscription.id);
          await admin.rpc("release_youth_membership_reservation", {
            target_assignment_id: pendingAssignment.id,
            target_billing_owner_user_id: user.id
          });
          return json(req, { error: "The selected training days are no longer available" }, 409);
        }
      }

      const invoice = typeof incompleteSubscription.latest_invoice === "string"
        ? await stripe.invoices.retrieve(incompleteSubscription.latest_invoice)
        : incompleteSubscription.latest_invoice;
      if (!invoice || "deleted" in invoice || !invoice.hosted_invoice_url) {
        return json(req, { error: "Stripe payment recovery is unavailable" }, 409);
      }
      return json(req, { url: invoice.hosted_invoice_url, resumed: true });
    }
    if (billing?.subscription_status && !["canceled", "incomplete_expired"].includes(billing.subscription_status)) {
      return json(req, { error: "A membership already exists. Use Manage Billing instead." }, 409);
    }
    if (!/^youth_odyssey_[123]$/.test(body.planCode || "")) {
      return json(req, { error: "Select an available membership plan" }, 422);
    }
    if (!Array.isArray(body.selectedIsoWeekdays)
      || !body.selectedIsoWeekdays.every((day: unknown) => Number.isInteger(day) && Number(day) >= 1 && Number(day) <= 7)
      || body.selectedIsoWeekdays.some((day: number, index: number, days: number[]) => index > 0 && day <= days[index - 1])) {
      return json(req, { error: "Select distinct recurring training days in weekday order" }, 422);
    }

    const { data: reservationRows, error: reservationError } = await admin
      .rpc("reserve_youth_membership_checkout", {
        target_athlete_id: actor.athleteId,
        target_billing_owner_user_id: user.id,
        requested_plan_code: body.planCode,
        requested_iso_weekdays: body.selectedIsoWeekdays,
        requested_environment: billingEnvironment(),
        requested_idempotency_key: body.idempotencyKey
      });
    if (reservationError) {
      console.error("membership reservation failed", reservationError);
      return json(req, { error: "That plan or one of its selected days is unavailable" }, 409);
    }
    const reservation = reservationRows?.[0];
    if (!reservation?.assignment_id || !reservation?.external_price_id) {
      throw new Error("Membership reservation did not return a plan mapping");
    }

    let checkout;
    try {
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
      const membershipMetadata = {
        athlete_id: actor.athleteId,
        billing_owner_user_id: user.id,
        member_plan_assignment_id: reservation.assignment_id,
        membership_plan_version_id: reservation.plan_version_id
      };
      checkout = await stripe.checkout.sessions.create({
        mode: "subscription",
        integration_identifier: "odyssey_portal_qzmtkavp",
        customer: customerId,
        client_reference_id: actor.athleteId,
        line_items: [{ price: reservation.external_price_id, quantity: 1 }],
        success_url: `${returnUrl}?billing=success`,
        cancel_url: `${returnUrl}?billing=canceled`,
        expires_at: Math.floor(Date.now() / 1000) + (31 * 60),
        metadata: membershipMetadata,
        subscription_data: { metadata: membershipMetadata }
      }, { idempotencyKey: `odyssey-checkout-${reservation.assignment_id}` });
      if (!checkout.url) throw new Error("Checkout session did not include a URL");
    } catch (error) {
      await admin.rpc("release_youth_membership_reservation", {
        target_assignment_id: reservation.assignment_id,
        target_billing_owner_user_id: user.id
      });
      throw error;
    }
    return json(req, { url: checkout.url });
  } catch (error) {
    if (error instanceof BillingAccessError) return json(req, { error: error.message }, error.status);
    console.error("create-checkout-session failed", error);
    return json(req, { error: "Unable to open checkout" }, 500);
  }
});
