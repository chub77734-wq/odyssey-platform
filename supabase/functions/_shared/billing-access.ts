import type { User } from "npm:@supabase/supabase-js@2.111.0";
import { adminClient } from "./server.ts";
import { isUnder18 } from "./age.ts";

type BillingActor = {
  athleteId: string;
  billingOwner: User;
  identityType: "athlete" | "guardian";
};

type AthleteBillingOwner = BillingActor & { dateOfBirth: string };

export class BillingAccessError extends Error {
  constructor(message: string, public status = 403) {
    super(message);
    this.name = "BillingAccessError";
  }
}

export async function resolveBillingActor(user: User, requestedAthleteId?: string): Promise<BillingActor> {
  const admin = adminClient();
  const athleteId = requestedAthleteId || user.id;
  const { data: athlete, error: athleteError } = await admin.from("athlete_profiles")
    .select("id, date_of_birth").eq("id", athleteId).maybeSingle();
  if (athleteError) throw athleteError;
  if (!athlete?.date_of_birth) {
    throw new BillingAccessError("A coach must verify the athlete's date of birth before billing.", 422);
  }

  const { data: authorization, error: authorizationError } = await admin
    .from("athlete_billing_authorizations")
    .select("guardian_user_id, minor_self_billing_approved, billing_enabled")
    .eq("athlete_id", athleteId).maybeSingle();
  if (authorizationError) throw authorizationError;
  if (!authorization?.billing_enabled) {
    throw new BillingAccessError("A coach has not enabled billing for this athlete.");
  }

  if (user.id === athleteId) {
    if (isUnder18(athlete.date_of_birth) && !authorization?.minor_self_billing_approved) {
      throw new BillingAccessError("A parent or guardian must sign in to manage billing for this minor.");
    }
    return { athleteId, billingOwner: user, identityType: "athlete" };
  }

  if (authorization?.guardian_user_id !== user.id) throw new BillingAccessError("Billing access denied.");
  return { athleteId, billingOwner: user, identityType: "guardian" };
}

export async function resolveAthleteBillingOwner(athleteId: string): Promise<AthleteBillingOwner> {
  const admin = adminClient();
  const [{ data: athlete, error: athleteError }, { data: authorization, error: authorizationError }] = await Promise.all([
    admin.from("athlete_profiles").select("id, date_of_birth").eq("id", athleteId).maybeSingle(),
    admin.from("athlete_billing_authorizations")
      .select("guardian_user_id, minor_self_billing_approved, billing_enabled")
      .eq("athlete_id", athleteId).maybeSingle()
  ]);
  if (athleteError) throw athleteError;
  if (authorizationError) throw authorizationError;
  if (!athlete?.date_of_birth) throw new BillingAccessError("A coach must verify date of birth first.", 422);
  if (!authorization?.billing_enabled) throw new BillingAccessError("Billing is not enabled for this athlete.");

  const minorNeedsGuardian = isUnder18(athlete.date_of_birth) && !authorization.minor_self_billing_approved;
  const ownerId = minorNeedsGuardian ? authorization.guardian_user_id : athleteId;
  if (!ownerId) throw new BillingAccessError("A linked guardian is required for this minor.", 422);
  const { data, error } = await admin.auth.admin.getUserById(ownerId);
  if (error || !data.user?.email) throw new BillingAccessError("Authorized billing user is unavailable.", 422);
  return {
    athleteId,
    billingOwner: data.user,
    identityType: minorNeedsGuardian ? "guardian" : "athlete",
    dateOfBirth: athlete.date_of_birth
  };
}
