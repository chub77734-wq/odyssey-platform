# Odyssey billing setup

The local code is designed for Stripe-hosted Checkout and the Stripe Customer
Portal. The public site never collects or stores card data. Supabase stores only
the Stripe customer/subscription references and membership state required by the
athlete and coach portals.

Nothing in this repository creates Stripe resources, applies SQL, sets secrets,
deploys functions, or enables live payments automatically.

## Architecture and security choices

- Every billing user must have a valid Supabase session before a Checkout or Customer
  Portal session can be created.
- Billing age is calculated server-side from a coach-maintained `date_of_birth`.
  The athlete-editable `age_group` label is never used for age authorization.
- Athletes under 18 are denied Checkout and Customer Portal sessions under their own
  credentials unless a coach has recorded a manual exception and audit note.
- The normal minor flow uses a separate parent/guardian Supabase account linked by a
  coach. Guardian sessions are billing-only and cannot read workouts, messages,
  goals, date of birth, or another athlete's information.
- Coaches can view membership status for the selected athlete, but cannot begin or
  manage a membership on an athlete's behalf through the portal.
- `STRIPE_PRICE_ID` is read server-side. The browser cannot choose or alter a price.
- Stripe sends subscription changes to a public webhook whose raw request body is
  verified using `STRIPE_WEBHOOK_SECRET` before any database write.
- `billing_accounts` has RLS enabled. Athletes can read only their own row, coaches
  can read all rows, and no browser role can insert, update, or delete billing data.
- Membership status is informational in this first version; it does not lock an
  athlete out of training when a payment fails.
- Billing access is discretionary per athlete and defaults to **off**. Only a coach
  can enable it; Checkout, Customer Portal, and one-off invoice functions all enforce
  that setting server-side. The database records who enabled it, when, and an optional
  note.

## Coach-created one-off invoices

One-off invoices use a deliberate two-step process:

1. A coach selects an athlete, amount, description, and due date. The server resolves
   the authorized billing owner, creates a Stripe invoice with `status=draft`,
   `collection_method=send_invoice`, and `auto_advance=false`, adds exactly one USD
   invoice item, and records the draft locally. This does not finalize, email, or
   collect the invoice.
2. After reviewing the Stripe draft, a coach must enter the exact `in_...` invoice ID
   and the exact confirmation action `FINALIZE_AND_SEND`. A separate server function
   rechecks coach role, billing enablement, DOB/guardian rules, customer ownership,
   amount, metadata, and local draft audit before finalizing and manually sending.

Validation defaults are USD only, $1.00–$10,000.00, descriptions of 5–500 characters,
and due dates 1–90 days ahead. Draft calls carry a UUID idempotency token; finalize and
send calls use stable invoice-specific idempotency keys. If finalization succeeds but
sending must be retried, the same explicitly confirmed action can safely resume from
the open invoice.

For minors without manual self-billing approval, the linked guardian is always the
invoice customer. Athletes and guardians can read only invoices where their own Auth
user is the billing owner; coaches can read invoices for the selected athlete. Browser
roles cannot create, update, finalize, or send invoice records directly.

## Required guardian onboarding

For every athlete under 18, use this sequence unless Odyssey approves an exception:

1. Create or invite the athlete through Supabase Authentication as usual.
2. Invite the parent/guardian email as a **separate** Supabase Authentication user.
   Do not share the athlete's password and do not reuse the athlete's email.
3. The guardian accepts the invitation and creates their own password.
4. A coach signs in, selects the athlete's **Billing** tab, enters the verified date
   of birth and the guardian account email, and saves the authorization.
5. The guardian signs in at `portal.html`. They receive a billing-only view and use
   Stripe Checkout/Customer Portal under their own email and credentials.

The local coach function links only an existing Auth user; it deliberately does not
send invitations. Sending the guardian invitation remains an explicit administrator
action in Supabase Authentication. If a guardian covers multiple athletes, link that
same guardian account to each athlete; the guardian can select the membership.

Manual approval is exceptional. A coach must check the manual approval control and
enter an audit note of at least 10 characters. The database records the coach and
approval timestamp. Removing that approval immediately prevents the minor's athlete
credentials from creating new Checkout or Customer Portal sessions.

## Stage 1: Stripe sandbox/test setup (requires account-owner approval)

1. In a Stripe sandbox or test mode, create one recurring monthly product and price
   for Odyssey membership. Confirm the exact price, currency, billing interval,
   refund/cancellation language, and tax treatment before creation.
2. Configure the sandbox Customer Portal. At minimum, allow payment-method updates
   and invoice history. Decide separately whether athletes may cancel in the portal.
3. Keep the resulting `price_...` ID available for the Supabase secret configuration.

Do not create live-mode products or enable live payments during this stage.

## Stage 2: Supabase test setup (requires project-owner approval)

1. Review and apply `supabase-billing-setup.sql` to the intended test/staging project.
2. Deploy these functions:
   - `create-checkout-session` (JWT verification remains enabled)
   - `create-customer-portal-session` (JWT verification remains enabled)
   - `stripe-webhook` (JWT verification is disabled because Stripe authenticates
     requests with a signed webhook payload)
   - `configure-billing-authorization` (coach-only DOB, guardian link, and exception
     controls; JWT verification remains enabled)
   - `create-draft-invoice` (coach-only, creates an inert Stripe draft and local audit)
   - `finalize-send-invoice` (coach-only, exact-ID and explicit-confirmation gate)
3. Set function secrets without saving values in Git:
   - `SITE_URL` — exact site origin, without a trailing slash
   - `STRIPE_SECRET_KEY` — sandbox/test secret key (`sk_test_...`)
   - `STRIPE_PRICE_ID` — sandbox/test recurring price (`price_...`)
   - `STRIPE_WEBHOOK_SECRET` — secret for this webhook endpoint (`whsec_...`)
4. In Stripe sandbox/test mode, add the deployed `stripe-webhook` URL and subscribe to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.finalized`
   - `invoice.sent`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `invoice.voided`
   - `invoice.marked_uncollectible`

The webhook endpoint secret from the Stripe Dashboard is different from a Stripe
CLI forwarding secret. Use the secret that belongs to the endpoint being tested.

Subscription webhooks retrieve the current Stripe subscription before writing and
apply that snapshot through one conditional database statement. Apply the current
SQL before deploying the webhook; the function depends on
`apply_billing_subscription_snapshot(jsonb)` and `stripe_snapshot_observed_at`.
Stripe can express a scheduled cancellation through either `cancel_at_period_end`
or a future `cancel_at`. Odyssey normalizes both as pending cancellation, stores the
actual service-end timestamp in `scheduled_cancel_at`, and keeps a subscription whose
Stripe status is already `canceled` as terminal rather than pending.

## Stage 3: test checklist

Use test users and Stripe test cards only; never put real athlete details in fixtures,
screenshots, logs, or reports.

- Eligible adult athlete or manually approved minor with no billing row sees **Not
  started** and can open Stripe Checkout.
- Athlete with no verified DOB cannot open Checkout or Customer Portal.
- Minor athlete without manual approval cannot create either Stripe session under
  their own credentials, even by calling the Edge Function directly.
- Linked guardian can access only the linked athlete's billing status and Stripe
  sessions; they cannot read that athlete's DOB, profile, workouts, or messages.
- An unlinked account cannot enter the portal. Guardian A cannot bill for Guardian
  B's athlete.
- Coach can link an existing guardian Auth account, but a non-coach cannot change
  DOB, guardian linkage, or manual approval through the browser or Data API.
- Manual approval without an audit note fails, defaults to false, and records the
  approving coach and timestamp when enabled.
- Billing defaults off. Athlete, guardian, and direct-function calls cannot open
  recurring billing or create/send invoices until a coach enables it.
- Non-coaches cannot create drafts or finalize/send invoices.
- Draft creation rejects non-integer cents, amounts outside $1–$10,000, non-USD
  behavior, descriptions outside 5–500 characters, and due dates outside 1–90 days.
- A created invoice remains `draft` with `auto_advance=false`, has no hosted payment
  URL, and sends no email or payment attempt.
- Finalize/send fails unless the exact local/Stripe draft ID, customer, owner, amount,
  athlete metadata, and confirmation payload all match.
- After finalization, the billing owner can read the hosted invoice/PDF links through
  RLS; unrelated athletes and guardians cannot.
- Coach sees the same athlete's billing status but no payment-management buttons.
- A successful sandbox Checkout returns to the portal and the signed webhook changes
  status to **Active** (or **Trial**, if the approved price includes a trial).
- Canceling Checkout creates no subscription and reports no payment.
- **Manage Billing** creates a new, short-lived Customer Portal session only for the
  signed-in athlete's Stripe customer.
- Payment failure, cancellation-at-period-end, reactivation, and deletion update the
  portal status and period date correctly.
- A missing/invalid Supabase JWT cannot create either kind of Stripe session.
- A missing/invalid Stripe signature cannot update billing data.
- Athlete A cannot read Athlete B's billing row; a coach can read both.

When a Stripe customer already exists, changing the authorization can immediately
revoke the former user's eligibility, but it does not transfer the Stripe customer.
The newly authorized user remains blocked from that Customer Portal until Odyssey
manually resolves the existing subscription/customer relationship in Stripe. This
fail-closed state prevents either account from receiving another person's Stripe
Customer Portal session during an ownership transition.

## Before live mode

Obtain explicit approval for the final price, terms, tax behavior, refund policy,
portal cancellation settings, production URL, and deployment. Then repeat the setup
with live-mode Stripe resources and secrets. Stripe keeps sandbox/test and live
Customer Portal configurations and webhook endpoints separate.

Rollback is additive: undeploy or disable the six functions first, remove the
Stripe webhook endpoint, then drop `public.billing_accounts` only after exporting or
confirming that its Stripe references are no longer needed. Preserve invoice audit
records according to applicable accounting requirements. Do not delete Stripe
customers, subscriptions, or finalized invoices as part of a database rollback.
