import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { subscriptionSnapshot } from "./subscription.ts";

const webhook = readFileSync(new URL("../stripe-webhook/index.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../../supabase-billing-setup.sql", import.meta.url), "utf8");

assert.match(webhook, /stripe\.subscriptions\.retrieve\(eventSubscription\.id\)/);
assert.doesNotMatch(webhook, /\.select\("stripe_event_created"\)/);
assert.match(webhook, /\.rpc\("apply_billing_subscription_snapshot"/);
assert.match(schema, /on conflict \(athlete_id\) do update/);
assert.match(schema, /excluded\.stripe_snapshot_observed_at > public\.billing_accounts\.stripe_snapshot_observed_at/);
assert.match(schema, /revoke all on function public\.apply_billing_subscription_snapshot\(jsonb\) from public, anon, authenticated/);

const snapshot = subscriptionSnapshot({
  id: "sub_test",
  customer: "cus_test",
  metadata: { athlete_id: "athlete", billing_owner_user_id: "guardian" },
  status: "active",
  cancel_at_period_end: true,
  items: { data: [{ price: { id: "price_test" }, current_period_end: 1787084558 }] }
}, "price_test", 1787084558, "2026-08-18T20:22:38.200Z");
assert.equal(snapshot.cancel_at_period_end, true);
assert.equal(snapshot.scheduled_cancel_at, "2026-08-18T20:22:38.000Z");
assert.equal(snapshot.billing_identity_type, "guardian");
assert.equal(snapshot.stripe_snapshot_observed_at, "2026-08-18T20:22:38.200Z");

const customCancellation = subscriptionSnapshot({
  id: "sub_custom_cancel",
  customer: "cus_test",
  metadata: { athlete_id: "athlete", billing_owner_user_id: "guardian" },
  status: "active",
  cancel_at: 1789762052,
  canceled_at: 1787084556,
  cancel_at_period_end: false,
  cancellation_details: { reason: "cancellation_requested" },
  items: { data: [{ price: { id: "price_test" }, current_period_end: 1789762052 }] }
}, "price_test", 1787084558, "2026-08-18T20:22:38.300Z");
assert.equal(customCancellation.cancel_at_period_end, true, "future cancel_at is scheduled cancellation");
assert.equal(customCancellation.scheduled_cancel_at, "2026-09-18T20:07:32.000Z");

const immediateCancellation = subscriptionSnapshot({
  id: "sub_immediate_cancel",
  customer: "cus_test",
  metadata: { athlete_id: "athlete", billing_owner_user_id: "guardian" },
  status: "canceled",
  cancel_at: 1787084556,
  canceled_at: 1787084556,
  cancel_at_period_end: false,
  items: { data: [{ price: { id: "price_test" }, current_period_end: 1789762052 }] }
}, "price_test", 1787084558, "2026-08-18T20:22:38.400Z");
assert.equal(immediateCancellation.cancel_at_period_end, false, "terminal cancellation is not pending");
assert.equal(immediateCancellation.scheduled_cancel_at, null);

function apply(existing, candidate) {
  return !existing || candidate.observedAt > existing.observedAt ? candidate : existing;
}

const stale = { observedAt: "2026-08-18T20:22:38.100Z", cancelAtPeriodEnd: false };
const current = { observedAt: "2026-08-18T20:22:38.200Z", cancelAtPeriodEnd: true };
assert.deepEqual(apply(apply(null, current), stale), current, "late stale write must lose");
assert.deepEqual(apply(apply(null, stale), current), current, "newer snapshot must converge");
console.log("subscription webhook convergence tests passed");
