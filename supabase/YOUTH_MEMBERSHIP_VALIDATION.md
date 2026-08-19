# Youth membership backend validation

This runbook validates commit `cb893e7` without changing production. Production is a prerequisite source only; all writes below belong in a disposable, production-derived development branch connected to Stripe test mode.

## Confirmed production prerequisites (read-only, 2026-08-19)

- PostgreSQL 17.6; `btree_gist` is not installed and migration `20260819154606` creates it.
- Required tables exist with expected UUID keys: `athlete_profiles`, `coaches`, `athlete_billing_authorizations`, `billing_accounts`, and `billing_invoices`.
- Required helpers exist: `public.is_coach()` and `odyssey_private.is_billing_guardian(uuid)`.
- No catalog objects introduced by either youth migration currently exist.
- Supabase migration history is empty. A clean local `db reset` from repository migrations alone is therefore not a valid rehearsal until the legacy production schema is baselined. Use a production-derived development branch for this release rehearsal.

## Safe validation order

1. Create or select an isolated production-derived Supabase development branch. Do not use production and do not connect live Stripe credentials.
2. Record a schema-only dump and row counts for prerequisite tables. Verify the two youth migration versions are absent from migration history and all target object names are absent.
3. Apply `20260819154606_effective_dated_youth_memberships.sql`, then `20260819154854_youth_checkout_reservation.sql` in that order. Stop on any error; do not hand-edit around a partial migration.
4. Run `supabase/tests/youth_memberships.rollback.sql`. Its final `ROLLBACK` is mandatory.
5. Verify every new public table has RLS enabled and explicit privileges. As `anon`, published plans/entitlements are readable but mappings, capacities, assignments, and events are not. As an unrelated authenticated user, another athlete's assignments/events are unreadable. The athlete, authorized guardian, and coach can read only their intended rows.
6. Inspect `pg_proc.proacl`: all four youth RPCs must grant EXECUTE to `service_role` only, with no `PUBLIC`, `anon`, or `authenticated` execution. Verify each is `SECURITY DEFINER` with an empty `search_path`.
7. Insert test-only capacity rows and one enabled test Stripe mapping per youth plan. Never insert live mappings in this rehearsal. Use separate test athletes/billing owners.
8. Capacity tests: fill a day to its limit; prove one additional reservation fails. Run two simultaneous requests for the final seat and prove exactly one succeeds. Prove distinct idempotency keys cannot create overlapping active/pending assignments for one athlete.
9. Lifecycle tests: incomplete before expiry reuses the same Stripe subscription and hosted invoice; incomplete after expiry renews the same assignment only if capacity remains; two simultaneous post-expiry resumes both return the same payment path and neither cancels it; loss of capacity cancels/releases the incomplete attempt; `incomplete_expired` and `canceled` clear the reservation and assignment.
10. Deploy only `create-checkout-session` and `stripe-webhook` to the development branch. Keep JWT verification enabled for checkout and disabled only for the signature-verified webhook. Configure branch-scoped Supabase keys plus Stripe test secret/webhook secret.
11. Stripe test matrix: complete each of the $100/$150/$200 plans with exactly 1/2/3 selected recurring days; reject mismatched counts, duplicate/unsorted days, unavailable days, unknown plan codes, and every browser-supplied price/amount/currency/Price ID. Confirm Stripe line item Price IDs came only from server-side test mappings.
12. Send subscription events out of order and concurrently. Confirm the authoritative Stripe snapshot and assignment status converge; confirm incomplete reservations expire and active/trialing assignments do not. Replay each webhook and confirm idempotent results.
13. Compare schema diff to the two committed migrations. Confirm no adult, lead, campaign, consultation, referral, or reporting schema appears. Remove the disposable branch/test customers only through the separately approved cleanup process.

## Rollback boundary

Before any live migration, take a schema backup and validate rollback on the development branch. Because the migrations add tables, foreign keys, and subscription-linked state, production rollback must not drop objects after real assignments exist. Prior to enrollment, rollback may remove the two nullable billing links, the four RPCs, the active-plan view, and the new membership tables in reverse dependency order. After enrollment begins, use a forward corrective migration and disable checkout/mappings instead of destructive rollback.

## Release blockers

- Leadership must define real weekly capacity rows.
- Three Stripe test Products/Prices and server-only test mappings must exist before end-to-end testing.
- A canonical baseline for the existing production schema is required before `supabase db reset` can represent production locally.
- No production migration, Edge Function deployment, live Stripe mapping, member migration, push, merge, or publish is authorized by this runbook.
