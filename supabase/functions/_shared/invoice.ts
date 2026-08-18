import type Stripe from "npm:stripe@22.1.1";
import { adminClient } from "./server.ts";

export function stripeInvoiceCustomerId(invoice: Stripe.Invoice) {
  return typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || null;
}
export function invoiceStatus(invoice: Stripe.Invoice) {
  return invoice.status === "void" ? "void" : invoice.status || "draft";
}

export async function updateInvoiceAudit(
  invoice: Stripe.Invoice,
  eventCreated = Math.floor(Date.now() / 1000),
  extra: Record<string, unknown> = {}
) {
  const admin = adminClient();
  const { data: existing, error: readError } = await admin.from("billing_invoices")
    .select("stripe_event_created").eq("stripe_invoice_id", invoice.id).maybeSingle();
  if (readError) throw readError;
  if (!existing || (existing.stripe_event_created || 0) > eventCreated) return;
  const { error } = await admin.from("billing_invoices").update({
    status: invoiceStatus(invoice),
    hosted_invoice_url: invoice.hosted_invoice_url,
    invoice_pdf: invoice.invoice_pdf,
    stripe_event_created: eventCreated,
    updated_at: new Date().toISOString(),
    ...extra
  }).eq("stripe_invoice_id", invoice.id);
  if (error) throw error;
}
