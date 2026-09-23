(() => {
  "use strict";

  const today = () => new Date().toISOString().slice(0, 10);
  const now = () => new Date().toISOString();
  const value = (result) => {
    if (result.error) throw result.error;
    return result.data;
  };

  window.createOdysseyPortalAdapter = ({ client }) => {
    let user = null;
    let athleteId = null;

    const requireUser = () => {
      if (!user) throw new Error("Sign in required");
      return user;
    };

    const rolesFor = async (account) => {
      const [athleteLinks, coach, consentLinks] = await Promise.all([
        client.from("athlete_account_links").select("athlete_id")
          .eq("user_id", account.id).eq("status", "active").limit(2),
        client.from("coaches").select("user_id").eq("user_id", account.id).maybeSingle(),
        client.from("athlete_consent_signers").select("athlete_id")
          .eq("guardian_user_id", account.id).eq("status", "active").limit(1)
      ]);
      const links = value(athleteLinks) || [];
      value(coach);
      const consents = value(consentLinks) || [];
      athleteId = links.length === 1 ? links[0].athlete_id : null;
      return [links.length === 1 && "athlete", coach.data && "coach", consents.length && "guardian"]
        .filter(Boolean);
    };

    const assignedAthletes = async () => {
      const account = requireUser();
      const assignments = value(await client.from("coach_athlete_assignments")
        .select("athlete_id, role, starts_on, ends_on")
        .eq("coach_user_id", account.id)
        .lte("starts_on", today())
        .or(`ends_on.is.null,ends_on.gte.${today()}`)) || [];
      const ids = [...new Set(assignments.map((item) => item.athlete_id))];
      if (!ids.length) return [];
      const athletes = value(await client.from("training_athletes")
        .select("id, display_name, status").in("id", ids).eq("status", "active")) || [];
      return athletes.map((item) => ({ athleteId: item.id, displayName: item.display_name }));
    };

    const sessions = async () => value(await client.from("training_sessions")
      .select("id, title, location, starts_at, ends_at, reservation_status")
      .gte("starts_at", now()).in("reservation_status", ["open", "closed"])
      .order("starts_at")) || [];

    const loadAthlete = async () => {
      const account = requireUser();
      if (!athleteId) await rolesFor(account);
      if (!athleteId) throw new Error("Athlete access unavailable");
      const [planRows, messageRows, sessionRows, reservationRows, performanceRows, assignments] = await Promise.all([
        client.from("training_plan_athletes").select(
          "plan_id, assigned_at, training_plans!inner(id,title,planned_date,training_week,phase,status,training_plan_sections(id,heading,sort_order,training_plan_items(id,exercise,sets,reps,intensity,sort_order)))"
        ).eq("athlete_id", athleteId).eq("training_plans.status", "published").order("assigned_at", { ascending: false }),
        client.from("coach_athlete_messages").select("id, athlete_id, sender_user_id, recipient_user_id, body, created_at, read_at")
          .eq("athlete_id", athleteId).order("created_at", { ascending: false }),
        sessions(),
        client.from("training_session_reservations").select("id, session_id, status")
          .eq("athlete_id", athleteId).eq("status", "reserved"),
        client.from("athlete_performance_results")
          .select("id, metric_code, measured_at, result_value, approval_status, performance_metric_definitions(display_name,unit)")
          .eq("athlete_id", athleteId).eq("approval_status", "approved").order("measured_at", { ascending: false }),
        client.from("coach_athlete_assignments").select("coach_user_id, role, starts_on")
          .eq("athlete_id", athleteId).lte("starts_on", today())
          .or(`ends_on.is.null,ends_on.gte.${today()}`).order("role").order("starts_on", { ascending: false }).limit(1)
      ]);
      const assignment = (value(assignments) || [])[0];
      let assignedCoach = null;
      if (assignment) {
        const profile = value(await client.from("portal_coach_profiles").select("display_name")
          .eq("user_id", assignment.coach_user_id).maybeSingle());
        assignedCoach = { userId: assignment.coach_user_id, displayName: profile?.display_name || "Odyssey coach" };
      }
      return {
        userId: account.id,
        athleteId,
        plans: value(planRows) || [],
        messages: value(messageRows) || [],
        sessions: sessionRows,
        reservations: value(reservationRows) || [],
        performance: value(performanceRows) || [],
        assignedCoach
      };
    };

    const loadCoach = async () => {
      const account = requireUser();
      const athletes = await assignedAthletes();
      const ids = athletes.map((item) => item.athleteId);
      const [messageRows, pendingRows, planRows, sessionRows] = await Promise.all([
        ids.length ? client.from("coach_athlete_messages")
          .select("id, athlete_id, sender_user_id, recipient_user_id, body, created_at, read_at")
          .in("athlete_id", ids).order("created_at") : Promise.resolve({ data: [], error: null }),
        ids.length ? client.from("athlete_performance_results")
          .select("id, athlete_id, metric_code, measured_at, result_value, approval_status")
          .in("athlete_id", ids).eq("approval_status", "pending").order("measured_at") : Promise.resolve({ data: [], error: null }),
        client.from("training_plans").select("id, title, planned_date, training_week, phase, status, target_athlete_id")
          .eq("created_by", account.id).order("planned_date", { ascending: false }),
        sessions()
      ]);
      const messages = value(messageRows) || [];
      const pendingResults = value(pendingRows) || [];
      const messageThreads = athletes.map((athlete) => ({
        ...athlete,
        messages: messages.filter((message) => message.athlete_id === athlete.athleteId),
        unreadCount: messages.filter((message) => message.athlete_id === athlete.athleteId &&
          message.recipient_user_id === account.id && !message.read_at).length
      }));
      return {
        userId: account.id,
        athletes,
        messages,
        messageThreads,
        inbox: messages.filter((message) => message.recipient_user_id === account.id && !message.read_at),
        pendingResults,
        plans: value(planRows) || [],
        sessions: sessionRows
      };
    };

    const loadGuardian = async () => {
      const account = requireUser();
      const consentRelationships = value(await client.from("athlete_consent_signers")
        .select("athlete_id, status, consent_scope, created_at")
        .eq("guardian_user_id", account.id).eq("status", "active")) || [];
      return { userId: account.id, consentRelationships };
    };

    return {
      async initialize({ resolveAccess = true } = {}) {
        const session = value(await client.auth.getSession())?.session;
        user = session?.user || null;
        return { signedIn: Boolean(user), user, roles: user && resolveAccess ? await rolesFor(user) : [] };
      },
      async signIn({ email, password }) {
        const result = value(await client.auth.signInWithPassword({ email, password }));
        user = result.user;
        return { user, roles: await rolesFor(user) };
      },
      async signOut() { await value(await client.auth.signOut()); user = null; athleteId = null; },
      async requestPasswordReset({ email, redirectTo }) {
        value(await client.auth.resetPasswordForEmail(email, { redirectTo }));
      },
      async updatePassword({ password }) { value(await client.auth.updateUser({ password })); },
      async authorizeRoute({ requiredRole }) {
        const roles = await rolesFor(requireUser());
        if (roles.length !== 1 || roles[0] !== requiredRole) throw new Error("Role access denied");
      },
      async loadRole({ role }) {
        if (role === "athlete") return loadAthlete();
        if (role === "coach") return loadCoach();
        if (role === "guardian") return loadGuardian();
        throw new Error("Role access denied");
      },
      async sendMessage({ athleteId: targetAthleteId, body }) {
        const target = targetAthleteId || athleteId;
        const rows = value(await client.rpc("send_portal_message", {
          target_athlete_id: target,
          message_body: body
        }));
        return Array.isArray(rows) ? rows[0] : rows;
      },
      async markMessagesRead({ athleteId: targetAthleteId }) {
        value(await client.rpc("mark_portal_messages_read", { target_athlete_id: targetAthleteId || athleteId }));
      },
      async reserveSession({ sessionId, reserve }) {
        requireUser();
        if (!athleteId) throw new Error("Athlete access unavailable");
        value(await client.rpc(
          reserve ? "reserve_portal_training_session" : "cancel_portal_training_session",
          { target_session_id: sessionId }
        ));
      },
      async saveCheckIn({ planId, completion_status, effort, note }) {
        requireUser();
        value(await client.from("athlete_workout_checkins").upsert({
          plan_id: planId,
          athlete_id: athleteId,
          completion_status,
          effort: effort ? Number(effort) : null,
          note: note || null,
          updated_at: now()
        }, { onConflict: "plan_id,athlete_id" }));
      },
      async saveAttendance({ sessionId, athleteId: targetAthleteId, status, note }) {
        value(await client.rpc("record_portal_attendance", {
          target_session_id: sessionId,
          target_athlete_id: targetAthleteId,
          attendance_status: status,
          attendance_note: note || null
        }));
      },
      async createWorkout({ title, plannedDate, trainingWeek, phase, targetAthleteId, sections }) {
        const id = value(await client.rpc("create_portal_workout_draft", {
          plan_title: title,
          plan_date: plannedDate,
          plan_week: trainingWeek,
          plan_phase: phase,
          plan_target_type: "athlete",
          plan_target_group_id: null,
          plan_target_athlete_id: targetAthleteId,
          plan_sections: sections
        }));
        return { id, status: "draft" };
      },
      async publishWorkout({ planId }) {
        return value(await client.rpc("publish_portal_workout_plan", { target_plan_id: planId }));
      },
      async reviewSubmission({ resultId, action }) {
        const account = requireUser();
        value(await client.from("athlete_performance_results").update({
          approval_status: action === "approve" ? "approved" : "rejected",
          reviewed_by: account.id,
          reviewed_at: now()
        }).eq("id", resultId).eq("approval_status", "pending"));
      }
    };
  };
})();
