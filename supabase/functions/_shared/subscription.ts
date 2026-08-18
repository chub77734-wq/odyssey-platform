import type Stripe from "npm:stripe@22.1.1";

function customerId(subscription: Stripe.Subscription) {
  return typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
}

export function subscriptionSnapshot(
  subscription: Stripe.Subscription,
  expectedPrice: string,
  eventCreated: number,
  observedAt: string
) {
  const athleteId = subscription.metadata.athlete_id;
  const billingOwnerUserId = subscription.metadata.billing_owner_user_id;
  const matchingItem = subscription.items.data.find((item) => item.price.id === expectedPrice);
  if (!athleteId || !billingOwnerUserId || !matchingItem) return null;
  const terminallyCanceled = subscription.status === "canceled";
  const scheduledCancelAt = !terminallyCanceled && subscription.cancel_at
    ? new Date(subscription.cancel_at * 1000).toISOString()
    : !terminallyCanceled && subscription.cancel_at_period_end && matchingItem.current_period_end
    ? new Date(matchingItem.current_period_end * 1000).toISOString()
    : null;

  return {
    athlete_id: athleteId,
    stripe_customer_id: customerId(subscription),
    stripe_subscription_id: subscription.id,
    stripe_price_id: matchingItem.price.id,
    billing_owner_user_id: billingOwnerUserId,
    billing_identity_type: billingOwnerUserId === athleteId ? "athlete" : "guardian",
    subscription_status: subscription.status,
    current_period_end: matchingItem.current_period_end
      ? new Date(matchingItem.current_period_end * 1000).toISOString()
      : null,
    // Current Stripe APIs can represent a future/custom cancellation with
    // cancel_at while cancel_at_period_end remains false. This local boolean
    // means "service is scheduled to end", not a verbatim Stripe field copy.
    cancel_at_period_end: Boolean(scheduledCancelAt),
    scheduled_cancel_at: scheduledCancelAt,
    stripe_event_created: eventCreated,
    stripe_snapshot_observed_at: observedAt
  };
}
