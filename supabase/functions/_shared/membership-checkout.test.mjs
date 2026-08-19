import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const checkout = readFileSync(new URL("../create-checkout-session/index.ts", import.meta.url), "utf8");
const webhook = readFileSync(new URL("../stripe-webhook/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../migrations/20260819154854_youth_checkout_reservation.sql", import.meta.url), "utf8");
const portal = readFileSync(new URL("../../../portal.js", import.meta.url), "utf8");
const billingAccess = readFileSync(new URL("./billing-access.ts", import.meta.url), "utf8");

assert.match(checkout, /forbiddenFields\.some/);
assert.match(checkout, /reserve_youth_membership_checkout/);
assert.match(checkout, /price: reservation\.external_price_id/);
assert.match(checkout, /integration_identifier: "odyssey_portal_[a-z]{8}"/);
assert.doesNotMatch(checkout, /price: stripePriceId\(\)/);
assert.match(checkout, /member_plan_assignment_id: reservation\.assignment_id/);
assert.match(webhook, /activate_youth_membership_assignment/);
assert.match(webhook, /external_price_id.*subscriptionPriceId/s);
assert.match(migration, /for update/);
assert.match(migration, /locked_day_count <> selected_plan\.weekly_selected_day_count/);
assert.match(migration, /revoke all on function public\.reserve_youth_membership_checkout/);
assert.match(migration, /grant execute on function public\.reserve_youth_membership_checkout[\s\S]*to service_role/);
assert.match(migration, /reservation_expires_at > now\(\)/);
assert.match(migration, /when target_subscription_status in \('active', 'trialing', 'canceled', 'incomplete_expired'\) then null\s+else reservation_expires_at/);

function applySubscriptionStatus(assignment, stripeStatus) {
  if (stripeStatus === "active" || stripeStatus === "trialing") {
    return { ...assignment, status: stripeStatus, reservationExpiresAt: null };
  }
  if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") {
    return { ...assignment, status: "canceled", reservationExpiresAt: null };
  }
  return assignment;
}

function expirePending(assignment, now) {
  return assignment.status === "pending" && assignment.reservationExpiresAt <= now
    ? { ...assignment, status: "canceled", reservationExpiresAt: null }
    : assignment;
}

const pending = { status: "pending", reservationExpiresAt: 30 };
const incomplete = applySubscriptionStatus(pending, "incomplete");
assert.deepEqual(incomplete, pending, "incomplete must retain the expiring reservation");
assert.equal(expirePending(incomplete, 31).status, "canceled", "expired incomplete reservation must unblock retry");
assert.deepEqual(applySubscriptionStatus(pending, "incomplete_expired"), {
  status: "canceled", reservationExpiresAt: null
});
assert.deepEqual(applySubscriptionStatus(pending, "canceled"), {
  status: "canceled", reservationExpiresAt: null
});

function resumeIncomplete({ now, reservationExpiresAt, capacityAvailable }) {
  if (reservationExpiresAt > now) return { action: "reuse", reservationExpiresAt };
  return capacityAvailable
    ? { action: "renew", reservationExpiresAt: now + 35 }
    : { action: "cancel", reservationExpiresAt: null };
}

assert.deepEqual(resumeIncomplete({ now: 20, reservationExpiresAt: 30, capacityAvailable: false }), {
  action: "reuse", reservationExpiresAt: 30
}, "before expiry the existing incomplete payment is reused without a second subscription");
assert.deepEqual(resumeIncomplete({ now: 31, reservationExpiresAt: 30, capacityAvailable: true }), {
  action: "renew", reservationExpiresAt: 66
}, "after expiry the same assignment can safely renew when capacity remains");
assert.deepEqual(resumeIncomplete({ now: 31, reservationExpiresAt: 30, capacityAvailable: false }), {
  action: "cancel", reservationExpiresAt: null
}, "after expiry a full day cancels the incomplete subscription instead of duplicating it");

assert.match(checkout, /billing\?\.subscription_status === "incomplete"/);
assert.match(checkout, /renew_youth_membership_reservation/);
assert.match(checkout, /stripe\.subscriptions\.cancel\(incompleteSubscription\.id\)/);
assert.match(checkout, /invoice\.hosted_invoice_url, resumed: true/);
assert.match(migration, /a\.id <> target_assignment_id/);
assert.match(migration, /if selected_assignment\.reservation_expires_at > now\(\) then\s+return;/);
assert.match(portal, /status === "incomplete" \? "Continue Payment"/);
assert.match(portal, /billingRecord\?\.subscription_status === "incomplete"/);
assert.match(billingAccess, /isUnder18\(athlete\.date_of_birth\) && !authorization\?\.minor_self_billing_approved/);
assert.match(billingAccess, /A parent or guardian must sign in to manage billing for this minor/);
assert.match(billingAccess, /authorization\?\.guardian_user_id !== user\.id/);
assert.match(billingAccess, /identityType: "guardian"/);

const firstConcurrentResume = resumeIncomplete({ now: 31, reservationExpiresAt: 30, capacityAvailable: true });
const secondConcurrentResume = resumeIncomplete({
  now: 31,
  reservationExpiresAt: firstConcurrentResume.reservationExpiresAt,
  capacityAvailable: false
});
assert.equal(firstConcurrentResume.action, "renew");
assert.equal(secondConcurrentResume.action, "reuse",
  "a duplicate request waiting on the row lock must reuse the concurrent renewal, not cancel it");

console.log("multi-tier membership checkout contract tests passed");
