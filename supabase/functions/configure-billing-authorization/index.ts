import { json, requirePost } from "../_shared/http.ts";
import { adminClient, authenticatedUser } from "../_shared/server.ts";
import { isUnder18 } from "../_shared/age.ts";

async function userByEmail(email: string) {
  const admin = adminClient();
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user || data.users.length < 1000) return user || null;
  }
  throw new Error("Guardian lookup exceeded the supported account count.");
}

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
    const dateOfBirth = typeof body.dateOfBirth === "string" ? body.dateOfBirth : "";
    const guardianEmail = typeof body.guardianEmail === "string"
      ? body.guardianEmail.trim().toLowerCase()
      : "";
    const manualApproved = body.manualApproved === true;
    const approvalNote = typeof body.approvalNote === "string" ? body.approvalNote.trim() : "";
    const billingEnabled = body.billingEnabled === true;
    const billingEnabledNote = typeof body.billingEnabledNote === "string"
      ? body.billingEnabledNote.trim().slice(0, 1000)
      : "";
    if (!athleteId || !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
      return json(req, { error: "Athlete and valid date of birth are required" }, 422);
    }
    const parsedDob = new Date(`${dateOfBirth}T00:00:00Z`);
    if (Number.isNaN(parsedDob.valueOf()) ||
      parsedDob.toISOString().slice(0, 10) !== dateOfBirth || parsedDob > new Date()) {
      return json(req, { error: "Date of birth is invalid" }, 422);
    }

    const [{ data: athlete, error: athleteError }, { data: currentAuthorization }] = await Promise.all([
      admin.from("athlete_profiles").select("id, full_name").eq("id", athleteId).maybeSingle(),
      admin.from("athlete_billing_authorizations")
        .select("guardian_user_id, billing_enabled_by, billing_enabled_at")
        .eq("athlete_id", athleteId).maybeSingle()
    ]);
    if (athleteError) throw athleteError;
    if (!athlete) return json(req, { error: "Athlete not found" }, 404);

    let guardianUserId = currentAuthorization?.guardian_user_id || null;
    if (guardianEmail) {
      const guardian = await userByEmail(guardianEmail);
      if (!guardian) return json(req, { error: "Invite the guardian in Supabase Auth before linking this email." }, 422);
      if (guardian.id === athleteId) return json(req, { error: "Guardian must use a separate account." }, 422);
      const [{ data: guardianAthlete }, { data: guardianCoach }] = await Promise.all([
        admin.from("athlete_profiles").select("id").eq("id", guardian.id).maybeSingle(),
        admin.from("coaches").select("user_id").eq("user_id", guardian.id).maybeSingle()
      ]);
      if (guardianAthlete || guardianCoach) {
        return json(req, { error: "Guardian account must be billing-only." }, 422);
      }
      guardianUserId = guardian.id;
    }

    const minor = isUnder18(dateOfBirth);
    if (minor && manualApproved && approvalNote.length < 10) {
      return json(req, { error: "Manual minor approval requires an audit note of at least 10 characters." }, 422);
    }
    if (minor && !manualApproved && !guardianUserId) {
      return json(req, { error: "A linked guardian account is required for a minor without manual approval." }, 422);
    }

    const desiredBillingOwner = minor && !manualApproved ? guardianUserId : athleteId;
    const { data: billing } = await admin.from("billing_accounts")
      .select("billing_owner_user_id").eq("athlete_id", athleteId).maybeSingle();
    const requiresBillingMigration = Boolean(
      billing && desiredBillingOwner && billing.billing_owner_user_id !== desiredBillingOwner
    );

    const { error: profileError } = await admin.from("athlete_profiles")
      .update({ date_of_birth: dateOfBirth }).eq("id", athleteId);
    if (profileError) throw profileError;
    const effectiveManualApproval = minor && manualApproved;
    const { error: authorizationError } = await admin.from("athlete_billing_authorizations").upsert({
      athlete_id: athleteId,
      athlete_display_name: athlete.full_name || "Odyssey athlete",
      guardian_user_id: guardianUserId,
      minor_self_billing_approved: effectiveManualApproval,
      manual_approval_note: effectiveManualApproval ? approvalNote : null,
      approved_by: effectiveManualApproval ? coachUser.id : null,
      approved_at: effectiveManualApproval ? new Date().toISOString() : null,
      billing_enabled: billingEnabled,
      billing_enabled_by: billingEnabled ? coachUser.id : currentAuthorization?.billing_enabled_by || null,
      billing_enabled_at: billingEnabled ? new Date().toISOString() : currentAuthorization?.billing_enabled_at || null,
      billing_enabled_note: billingEnabledNote || null,
      updated_at: new Date().toISOString()
    }, { onConflict: "athlete_id" });
    if (authorizationError) throw authorizationError;

    return json(req, {
      minor,
      guardianConfigured: Boolean(guardianUserId),
      manualApproved: effectiveManualApproval,
      billingEnabled,
      requiresBillingMigration
    });
  } catch (error) {
    console.error("configure-billing-authorization failed", error);
    return json(req, { error: "Unable to save billing authorization" }, 500);
  }
});
