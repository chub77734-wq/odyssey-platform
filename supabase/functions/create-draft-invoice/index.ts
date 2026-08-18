import { json, requirePost } from "../_shared/http.ts";
import { BillingAccessError, resolveAthleteBillingOwner } from "../_shared/billing-access.ts";
import { adminClient, authenticatedUser, stripeClient } from "../_shared/server.ts";

const MIN_AMOUNT_CENTS = 100;
const MAX_AMOUNT_CENTS = 1_000_000;

Deno.serve(async (req) => {
  const earlyResponse = requirePost(req);
  if (earlyResponse) return earlyResponse;
  try {
    const coachUser = await authenticatedUser(req);
    if (!coachUser) return json(req, { error: "Unauthorized" }, 401);
    const admin = adminClient();
    const { data: coach } = await admin.from("coaches").select("user_id")
      .eq("user_id", coachUser.id).maybeSingle();
    if (!coach) return json(req, { error: "Coach authorization required" }, 403);

    const body = await req.json();
    const athleteId = typeof body.athleteId === "string" ? body.athleteId : "";
    const amountCents = body.amountCents;
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const dueDate = typeof body.dueDate === "string" ? body.dueDate : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!athleteId || !Number.isInteger(amountCents) ||
      amountCents < MIN_AMOUNT_CENTS || amountCents > MAX_AMOUNT_CENTS) {
      return json(req, { error: "Amount must be an integer from $1.00 to $10,000.00." }, 422);
    }
    if (description.length < 5 || description.length > 500) {
      return json(req, { error: "Description must be 5 to 500 characters." }, 422);
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
      return json(req, { error: "Valid request ID required." }, 422);
    }
    const parsedDueDate = new Date(`${dueDate}T00:00:00Z`);
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const daysUntilDue = Math.round((parsedDueDate.valueOf() - todayUtc) / 86400000);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(parsedDueDate.valueOf()) ||
      parsedDueDate.toISOString().slice(0, 10) !== dueDate || daysUntilDue < 1 || daysUntilDue > 90) {
      return json(req, { error: "Due date must be 1 to 90 days from today." }, 422);
    }

    const owner = await resolveAthleteBillingOwner(athleteId);
    const { data: billing, error: billingError } = await admin.from("billing_accounts")
      .select("stripe_customer_id, billing_owner_user_id").eq("athlete_id", athleteId).maybeSingle();
    if (billingError) throw billingError;
    if (billing && billing.billing_owner_user_id !== owner.billingOwner.id) {
      return json(req, { error: "Existing Stripe customer belongs to another billing user." }, 409);
    }

    const stripe = stripeClient();
    let customerId = billing?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: owner.billingOwner.email,
        metadata: { athlete_id: athleteId, billing_owner_user_id: owner.billingOwner.id }
      }, { idempotencyKey: `odyssey-customer-${athleteId}-${owner.billingOwner.id}` });
      customerId = customer.id;
      const { error } = await admin.from("billing_accounts").upsert({
        athlete_id: athleteId,
        stripe_customer_id: customerId,
        billing_owner_user_id: owner.billingOwner.id,
        billing_identity_type: owner.identityType,
        updated_at: new Date().toISOString()
      }, { onConflict: "athlete_id" });
      if (error) throw error;
    }

    const metadata = {
      athlete_id: athleteId,
      billing_owner_user_id: owner.billingOwner.id,
      odyssey_invoice: "true"
    };
    const draft = await stripe.invoices.create({
      customer: customerId,
      collection_method: "send_invoice",
      due_date: Math.floor(parsedDueDate.valueOf() / 1000),
      auto_advance: false,
      currency: "usd",
      description,
      metadata
    }, { idempotencyKey: `odyssey-draft-invoice-${requestId}` });
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: draft.id,
      amount: amountCents,
      currency: "usd",
      description,
      metadata
    }, { idempotencyKey: `odyssey-draft-item-${requestId}` });
    const completeDraft = await stripe.invoices.retrieve(draft.id);
    if (completeDraft.status !== "draft" || completeDraft.auto_advance !== false) {
      throw new Error("Stripe invoice did not remain an inert draft.");
    }
    const { error: auditError } = await admin.from("billing_invoices").upsert({
      stripe_invoice_id: completeDraft.id,
      athlete_id: athleteId,
      billing_owner_user_id: owner.billingOwner.id,
      stripe_customer_id: customerId,
      amount_cents: amountCents,
      currency: "usd",
      description,
      due_date: dueDate,
      status: "draft",
      hosted_invoice_url: null,
      invoice_pdf: null,
      created_by: coachUser.id,
      updated_at: new Date().toISOString()
    }, { onConflict: "stripe_invoice_id" });
    if (auditError) throw auditError;
    return json(req, { invoiceId: completeDraft.id, status: "draft" });
  } catch (error) {
    if (error instanceof BillingAccessError) return json(req, { error: error.message }, error.status);
    console.error("create-draft-invoice failed", error);
    return json(req, { error: "Unable to create draft invoice" }, 500);
  }
});
