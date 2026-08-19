import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const catalog = readFileSync(new URL("../migrations/20260819154606_effective_dated_youth_memberships.sql", import.meta.url), "utf8");
const lifecycle = readFileSync(new URL("../migrations/20260819154854_youth_checkout_reservation.sql", import.meta.url), "utf8");

const publicTables = [
  "membership_programs",
  "membership_plan_versions",
  "membership_entitlement_definitions",
  "membership_plan_entitlements",
  "membership_plan_billing_mappings",
  "recurring_training_day_capacities",
  "member_plan_assignments",
  "membership_status_events",
];

for (const table of publicTables) {
  assert.match(catalog, new RegExp(`alter table public\\.${table} enable row level security;`), `${table} must enable RLS`);
  assert.match(catalog, new RegExp(`public\\.${table}`), `${table} must be covered by explicit table privileges`);
}

assert.match(catalog, /create extension if not exists btree_gist;/);
assert.match(catalog, /with \(security_invoker = true\)/);
assert.match(catalog, /revoke all on table[\s\S]+from public, anon, authenticated;/);
assert.match(catalog, /grant select on table[\s\S]+to anon, authenticated;/);
assert.doesNotMatch(catalog, /adult|lead_|consultation|campaign|referral|session_utilization/i,
  "youth checkout migration must not expand into parked growth/adult schema");

const rpcSignatures = [
  "reserve_youth_membership_checkout\\(uuid, uuid, text, smallint\\[\\], text, uuid\\)",
  "renew_youth_membership_reservation\\(uuid, uuid\\)",
  "release_youth_membership_reservation\\(uuid, uuid\\)",
  "activate_youth_membership_assignment\\(uuid, uuid, text, text, text\\)",
];
for (const signature of rpcSignatures) {
  assert.match(lifecycle, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*?from public, anon, authenticated;`));
  assert.match(lifecycle, new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*?to service_role;`));
}

assert.match(lifecycle, /for update;[\s\S]*if selected_assignment\.reservation_expires_at > now\(\) then\s+return;/,
  "duplicate resume must become idempotent success after the row lock");
assert.match(lifecycle, /a\.id <> target_assignment_id[\s\S]*reservation_expires_at > now\(\)/,
  "renewal capacity count must exclude the assignment being resumed");
assert.match(lifecycle, /status = 'pending'[\s\S]*reservation_expires_at <= now\(\)/,
  "expired pending assignments must be releasable before a new reservation");
assert.match(lifecycle, /when target_subscription_status in \('active', 'trialing', 'canceled', 'incomplete_expired'\) then null\s+else reservation_expires_at/,
  "incomplete subscriptions must retain a finite reservation expiry");

console.log("youth membership migration security and lifecycle contract tests passed");
