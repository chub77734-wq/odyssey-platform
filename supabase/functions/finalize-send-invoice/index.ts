import { json, requirePost } from "../_shared/http.ts";
import { BillingAccessError, resolveAthleteBillingOwner } from "../_shared/billing-access.ts";
import { stripeInvoiceCustomerId, updateInvoiceAudit } from "../_shared/invoice.ts";
import { adminClient, authenticatedUser, stripeClient } from "../_shared/server.ts";

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
    const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId.trim() : "";
    const confirmed = body.confirmation?.invoiceId === invoiceId &&
      body.confirmation?.action === "FINALIZE_AND_SEND";
    if (!/^in_[A-Za-z0-9]+$/.test(invoiceId) || !confirmed) {
      return json(req, { error: "Exact draft invoice ID and FINALIZE_AND_SEND confirmation are required." }, 422);
    }

    const { data: audit, error: auditError } = await admin.from("billing_invoices")
      .select("stripe_invoice_id, athlete_id, billing_owner_user_id, stripe_customer_id, amount_cents, status")
      .eq("stripe_invoice_id", invoiceId).maybeSingle();
    if (auditError) throw auditError;
    if (!audit || !["draft", "open"].includes(audit.status)) {
      return json(req, { error: "A local draft/open audit record is required." }, 409);
    }
    const owner = await resolveAthleteBillingOwner(audit.athlete_id);
    if (owner.billingOwner.id !== audit.billing_owner_user_id) {
      return json(req, { error: "Billing owner changed; do not send this invoice." }, 409);
    }

    const stripe = stripeClient();
    let invoice = await stripe.invoices.retrieve(invoiceId);
    if (stripeInvoiceCustomerId(invoice) !== audit.stripe_customer_id ||
      invoice.metadata.athlete_id !== audit.athlete_id ||
      invoice.metadata.billing_owner_user_id !== audit.billing_owner_user_id ||
      invoice.collection_method !== "send_invoice" || invoice.amount_due !== audit.amount_cents) {
      return json(req, { error: "Stripe draft does not match the approved local audit record." }, 409);
    }
    if (invoice.status === "draft") {
      invoice = await stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: false }, {
        idempotencyKey: `odyssey-finalize-${invoiceId}`
      });
      await updateInvoiceAudit(invoice, Math.floor(Date.now() / 1000), {
        finalized_by: coachUser.id,
        finalized_at: new Date().toISOString()
      });
    }
    if (invoice.status !== "open") return json(req, { error: "Invoice is not open for sending." }, 409);
    const sent = await stripe.invoices.sendInvoice(invoiceId, {}, {
      idempotencyKey: `odyssey-send-${invoiceId}`
    });
    await updateInvoiceAudit(sent, Math.floor(Date.now() / 1000), {
      finalized_by: coachUser.id,
      finalized_at: sent.status_transitions.finalized_at
        ? new Date(sent.status_transitions.finalized_at * 1000).toISOString()
        : new Date().toISOString(),
      sent_at: new Date().toISOString()
    });
    return json(req, { invoiceId: sent.id, status: sent.status, hostedInvoiceUrl: sent.hosted_invoice_url });
  } catch (error) {
    if (error instanceof BillingAccessError) return json(req, { error: error.message }, error.status);
    console.error("finalize-send-invoice failed", error);
    return json(req, { error: "Unable to finalize and send invoice" }, 500);
  }
});
