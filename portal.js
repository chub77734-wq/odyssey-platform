const SUPABASE_KEY = "sb_publishable_UKztkCcChAcgx7ATcoeFIA_76EP9Ytl";
const SUPABASE_URL = "https://ijasonewhoizpqzwymot.supabase.co";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const authCard = document.querySelector(".auth-card");
const dashboard = document.querySelector(".portal-dashboard");
const loginForm = document.querySelector(".login-form");
const forgotForm = document.querySelector(".forgot-password-form");
const passwordForm = document.querySelector(".password-form");
const profileForm = document.querySelector(".athlete-profile-form");
const workoutForm = document.querySelector(".workout-form");
const messageForm = document.querySelector(".message-form");
const authStatus = authCard.querySelector(".portal-status");
const dashboardStatus = document.querySelector(".dashboard-status");
const athletePicker = document.querySelector(".coach-athlete-picker");
const athleteSelect = document.querySelector("#athlete-select");
const workoutList = document.querySelector(".workout-list");
const messageList = document.querySelector(".message-list");
const messageComposeButton = document.querySelector(".message-compose-button");
const userGreeting = document.querySelector(".user-greeting");
const billingStatus = document.querySelector(".billing-status");
const billingDetail = document.querySelector(".billing-detail");
const billingActions = document.querySelector(".billing-actions");
const billingAccessMessage = document.querySelector(".billing-access-message");
const billingAccessForm = document.querySelector(".billing-access-form");
const manualApprovalCheckbox = billingAccessForm.elements.manual_approval;
const manualApprovalNote = document.querySelector(".manual-approval-note");
const billingEnabledCheckbox = billingAccessForm.elements.billing_enabled;
const draftInvoiceForm = document.querySelector(".draft-invoice-form");
const sendInvoiceForm = document.querySelector(".send-invoice-form");
const invoiceList = document.querySelector(".invoice-list");
const startMembershipButton = document.querySelector(".start-membership-button");
const manageBillingButton = document.querySelector(".manage-billing-button");
const membershipEnrollment = document.querySelector(".membership-enrollment");
const membershipPlanSelect = document.querySelector(".membership-plan-select");
const membershipDayOptions = document.querySelector(".membership-day-options");
const authForms = [loginForm, forgotForm, passwordForm];
const hashParams = new URLSearchParams(window.location.hash.slice(1));
const authFlowType = hashParams.get("type");
const authLinkError = hashParams.get("error_description");
const billingReturn = new URLSearchParams(window.location.search).get("billing");
let needsPasswordUpdate = authFlowType === "invite" || authFlowType === "recovery";
let authStateVersion = 0;
let session = null;
let selectedAthleteId = null;
let isCoach = false;
let isGuardian = false;
let billingRecord = null;
let billingAllowed = false;
let draftInvoiceRequestId = null;
let membershipPlans = [];
let checkoutRequestId = null;
let canResumeIncompleteMembership = false;

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function setStatus(target, message, type = "info") {
  target.textContent = message;
  target.dataset.type = type;
}

function showAuthView(view) {
  authForms.forEach((form) => { form.hidden = form !== view; });
  authCard.hidden = false;
  dashboard.hidden = true;
}

function resetPortalRoleView() {
  document.querySelector(".portal-dashboard-header h1").textContent = "Training Portal";
  document.querySelectorAll(".training-only").forEach((element) => { element.hidden = false; });
  document.querySelectorAll(".portal-tab").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.panel === "workouts-panel");
  });
  document.querySelectorAll(".portal-panel").forEach((panel) => {
    panel.hidden = panel.id !== "workouts-panel";
  });
}

function setFormBusy(form, busy) {
  Array.from(form.elements).forEach((control) => { control.disabled = busy; });
}

function escapeHtml(value = "") {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function firstNameFrom(value = "") {
  return value.trim().split(/\s+/)[0] || "Athlete";
}

function accountDisplayName() {
  const metadata = session?.user?.user_metadata || {};
  const metadataName = metadata.first_name || metadata.full_name || metadata.name;
  if (metadataName) return firstNameFrom(metadataName);

  const emailName = session?.user?.email?.split("@")[0].split(/[._-]/)[0] || "Athlete";
  return emailName.charAt(0).toUpperCase() + emailName.slice(1);
}

function setUserGreeting(name) {
  userGreeting.textContent = `Hi, ${firstNameFrom(name || accountDisplayName())}`;
}

function formatDate(value, withTime = false) {
  const date = new Date(withTime ? value : `${value}T12:00:00`);
  const options = withTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { weekday: "short", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function formatBillingStatus(status) {
  const labels = {
    active: "Active", trialing: "Trial", past_due: "Past due", unpaid: "Unpaid",
    paused: "Paused", canceled: "Canceled", incomplete: "Payment incomplete",
    incomplete_expired: "Not active"
  };
  return labels[status] || "Not started";
}

function isUnder18(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  const today = new Date();
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  if (today.getUTCMonth() < dob.getUTCMonth() ||
    (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age < 18;
}

function renderBillingActions() {
  const status = billingRecord?.subscription_status || null;
  const hasCustomer = Boolean(billingRecord);
  const canStart = !status || ["canceled", "incomplete_expired"].includes(status)
    || (status === "incomplete" && canResumeIncompleteMembership);
  billingActions.hidden = isCoach || !billingAllowed;
  startMembershipButton.hidden = isCoach || !billingAllowed || !canStart;
  manageBillingButton.hidden = isCoach || !billingAllowed || !hasCustomer;
  membershipEnrollment.hidden = startMembershipButton.hidden || status === "incomplete" || membershipPlans.length === 0;
  startMembershipButton.disabled = status === "incomplete" ? !canResumeIncompleteMembership : membershipPlans.length === 0;
  startMembershipButton.textContent = status === "incomplete" ? "Continue Payment" : "Start Membership";
}

function renderMembershipDays() {
  const plan = membershipPlans.find((item) => item.plan_code === membershipPlanSelect.value);
  const required = plan?.weekly_selected_day_count || 0;
  membershipDayOptions.innerHTML = WEEKDAYS.map((day, index) => `
    <label class="membership-day-option">
      <input type="checkbox" value="${index + 1}" /> ${day}
    </label>`).join("");
  membershipDayOptions.dataset.required = String(required);
  membershipDayOptions.querySelectorAll("input").forEach((input) => input.addEventListener("change", () => {
    const checked = membershipDayOptions.querySelectorAll("input:checked");
    if (checked.length > required) input.checked = false;
  }));
}

async function loadMembershipPlans() {
  const { data, error } = await supabaseClient.from("active_membership_plans")
    .select("plan_code, display_name, price_cents, currency, weekly_selected_day_count, public_copy")
    .eq("audience", "youth")
    .order("price_cents");
  if (error) {
    console.info("Membership catalog is not installed yet.", error.message);
    membershipPlans = [];
    renderBillingActions();
    return;
  }
  membershipPlans = data || [];
  membershipPlanSelect.innerHTML = membershipPlans.map((plan) =>
    `<option value="${escapeHtml(plan.plan_code)}">${escapeHtml(plan.display_name)} — $${(plan.price_cents / 100).toFixed(0)}/month</option>`
  ).join("");
  renderMembershipDays();
  renderBillingActions();
}

async function loadBilling() {
  if (!selectedAthleteId) {
    billingStatus.textContent = "No athlete selected";
    billingDetail.textContent = "Select an athlete to view membership status.";
    startMembershipButton.hidden = true;
    manageBillingButton.hidden = true;
    canResumeIncompleteMembership = false;
    return;
  }
  const { data, error } = await supabaseClient.from("billing_accounts")
    .select("subscription_status, current_period_end, cancel_at_period_end, scheduled_cancel_at, member_plan_assignment_id")
    .eq("athlete_id", selectedAthleteId).maybeSingle();
  if (error) throw error;
  billingRecord = data;
  canResumeIncompleteMembership = false;
  if (data?.subscription_status === "incomplete" && data.member_plan_assignment_id) {
    const { data: assignment, error: assignmentError } = await supabaseClient
      .from("member_plan_assignments")
      .select("status, reservation_expires_at")
      .eq("id", data.member_plan_assignment_id)
      .maybeSingle();
    if (assignmentError) throw assignmentError;
    canResumeIncompleteMembership = assignment?.status === "pending"
      && Boolean(assignment.reservation_expires_at);
  }
  const status = billingRecord?.subscription_status || null;
  billingStatus.textContent = formatBillingStatus(status);
  billingStatus.dataset.status = status || "not_started";
  const billingDate = data?.scheduled_cancel_at || data?.current_period_end;
  if (billingDate) {
    billingDetail.textContent = `${data.cancel_at_period_end ? "Access ends" : "Current period renews"} ${formatDate(billingDate, true)}.`;
  } else {
    billingDetail.textContent = isCoach
      ? "This athlete has not started a membership."
      : "Start your membership when you are ready.";
  }
  renderBillingActions();
}

async function loadBillingAccess() {
  if (!selectedAthleteId) return;
  const { data: authorization, error: authorizationError } = await supabaseClient
    .from("athlete_billing_authorizations")
    .select("athlete_id, athlete_display_name, guardian_configured, minor_self_billing_approved, billing_enabled")
    .eq("athlete_id", selectedAthleteId).maybeSingle();
  if (authorizationError) throw authorizationError;

  if (isGuardian) {
    billingAllowed = Boolean(authorization?.billing_enabled);
    billingAccessMessage.textContent = billingAllowed
      ? "You are signed in with the linked parent or guardian billing account. Billing is enabled."
      : "You are signed in with the linked parent or guardian account, but billing is not enabled.";
    billingAccessForm.hidden = true;
    renderBillingActions();
    return;
  }

  const { data: athlete, error: athleteError } = await supabaseClient.from("athlete_profiles")
    .select("date_of_birth").eq("id", selectedAthleteId).maybeSingle();
  if (athleteError) throw athleteError;
  const minor = isUnder18(athlete?.date_of_birth);

  if (isCoach) {
    billingAllowed = false;
    billingAccessForm.hidden = false;
    billingAccessForm.elements.date_of_birth.value = athlete?.date_of_birth || "";
    billingAccessForm.elements.guardian_email.value = "";
    manualApprovalCheckbox.checked = Boolean(authorization?.minor_self_billing_approved);
    billingEnabledCheckbox.checked = Boolean(authorization?.billing_enabled);
    billingAccessForm.elements.approval_note.value = "";
    manualApprovalNote.hidden = !manualApprovalCheckbox.checked;
    billingAccessForm.elements.approval_note.required = manualApprovalCheckbox.checked;
    billingAccessMessage.textContent = !authorization?.billing_enabled
      ? "Discretionary billing is OFF for this athlete."
      : !athlete?.date_of_birth
      ? "Billing is blocked until a coach verifies date of birth."
      : minor && !authorization?.minor_self_billing_approved
        ? authorization?.guardian_configured
          ? "Minor billing requires the linked guardian's credentials."
          : "Minor billing is blocked until a guardian is linked or a manual exception is approved."
        : minor ? "This minor has a documented manual self-billing exception." : "This athlete is currently 18 or older.";
  } else {
    billingAccessForm.hidden = true;
    billingAllowed = Boolean(authorization?.billing_enabled) && Boolean(athlete?.date_of_birth) &&
      (minor === false || Boolean(authorization?.minor_self_billing_approved));
    billingAccessMessage.textContent = !authorization?.billing_enabled
      ? "Billing is not currently enabled for this athlete."
      : !athlete?.date_of_birth
      ? "Billing is unavailable until a coach verifies your date of birth."
      : minor && !authorization?.minor_self_billing_approved
        ? "A parent or guardian must sign in with their linked billing account."
        : minor ? "Odyssey has approved a documented exception for billing with this athlete account." : "You may manage billing with this account.";
  }
  renderBillingActions();
}

async function loadInvoices() {
  if (!selectedAthleteId) {
    invoiceList.innerHTML = '<p class="empty-state">No athlete selected.</p>';
    return;
  }
  const { data, error } = await supabaseClient.from("billing_invoices")
    .select("stripe_invoice_id, amount_cents, currency, description, due_date, status, hosted_invoice_url, invoice_pdf, sent_at, created_at")
    .eq("athlete_id", selectedAthleteId).order("created_at", { ascending: false });
  if (error) throw error;
  invoiceList.innerHTML = data.length ? data.map((invoice) => {
    const amount = new Intl.NumberFormat("en-US", { style: "currency", currency: invoice.currency.toUpperCase() })
      .format(invoice.amount_cents / 100);
    const links = [
      invoice.hosted_invoice_url ? `<a href="${escapeHtml(invoice.hosted_invoice_url)}" target="_blank" rel="noopener">Open invoice</a>` : "",
      invoice.invoice_pdf ? `<a href="${escapeHtml(invoice.invoice_pdf)}" target="_blank" rel="noopener">PDF</a>` : ""
    ].filter(Boolean).join(" · ");
    return `<article class="invoice-item"><div><p class="invoice-status">${escapeHtml(invoice.status)}</p><h4>${escapeHtml(invoice.description)}</h4><p>${amount} · Due ${formatDate(invoice.due_date)}</p></div><div><code>${escapeHtml(invoice.stripe_invoice_id)}</code>${links ? `<p>${links}</p>` : ""}</div></article>`;
  }).join("") : '<p class="empty-state">No one-off invoices.</p>';
}

function showSignedOut(message = "Sign in to access your training portal.", type = "info") {
  needsPasswordUpdate = false;
  session = null;
  selectedAthleteId = null;
  showAuthView(loginForm);
  setStatus(authStatus, message, type);
}

async function loadProfile() {
  if (!selectedAthleteId) return;
  const { data, error } = await supabaseClient.from("athlete_profiles")
    .select("id, full_name, age_group, primary_event, goals").eq("id", selectedAthleteId).maybeSingle();
  if (error) throw error;
  profileForm.elements.full_name.value = data?.full_name || "";
  profileForm.elements.age_group.value = data?.age_group || "";
  profileForm.elements.primary_event.value = data?.primary_event || "";
  profileForm.elements.goals.value = data?.goals || "";
  if (!isCoach) setUserGreeting(data?.full_name);
  document.querySelector(".portal-welcome").textContent = isCoach
    ? "Coach workspace — assign training and stay connected."
    : `Welcome${data?.full_name ? `, ${data.full_name}` : ""}. Here is your Odyssey training space.`;
}

async function loadAthletes() {
  const { data, error } = await supabaseClient.from("athlete_profiles").select("id, full_name").order("full_name");
  if (error) throw error;
  athleteSelect.innerHTML = data.length
    ? data.map((athlete) => `<option value="${athlete.id}">${escapeHtml(athlete.full_name || "Profile incomplete")}</option>`).join("")
    : '<option value="">No athletes yet</option>';
  selectedAthleteId = data[0]?.id || null;
  athleteSelect.value = selectedAthleteId || "";
}

async function loadGuardianAthletes() {
  const { data, error } = await supabaseClient.from("athlete_billing_authorizations")
    .select("athlete_id, athlete_display_name").order("athlete_display_name");
  if (error) throw error;
  athleteSelect.innerHTML = data.map((athlete) =>
    `<option value="${athlete.athlete_id}">${escapeHtml(athlete.athlete_display_name)}</option>`).join("");
  selectedAthleteId = data[0]?.athlete_id || null;
  athleteSelect.value = selectedAthleteId || "";
  athletePicker.hidden = data.length <= 1;
  athletePicker.querySelector("label").textContent = "Managing membership for";
}

async function loadWorkouts() {
  if (!selectedAthleteId) {
    workoutList.innerHTML = '<p class="empty-state">Select an athlete to view workouts.</p>';
    return;
  }
  const { data, error } = await supabaseClient.from("workouts")
    .select("id, workout_date, title, details").eq("athlete_id", selectedAthleteId)
    .order("workout_date", { ascending: false });
  if (error) throw error;
  workoutList.innerHTML = data.length ? data.map((workout) => `
    <article class="workout-item">
      <time datetime="${workout.workout_date}">${formatDate(workout.workout_date)}</time>
      <h3>${escapeHtml(workout.title)}</h3>
      <p>${escapeHtml(workout.details).replace(/\n/g, "<br>")}</p>
    </article>`).join("") : '<p class="empty-state">No workouts have been assigned yet.</p>';
}

async function loadMessages() {
  if (!selectedAthleteId) {
    messageList.innerHTML = '<p class="empty-state">Select an athlete to open the conversation.</p>';
    return;
  }
  const { data, error } = await supabaseClient.from("messages")
    .select("id, sender_id, body, attachment_path, attachment_name, created_at")
    .eq("athlete_id", selectedAthleteId).order("created_at", { ascending: true });
  if (error) throw error;
  const messages = await Promise.all(data.map(async (message) => {
    if (!message.attachment_path) return message;
    const { data: signed } = await supabaseClient.storage.from("portal-files").createSignedUrl(message.attachment_path, 3600);
    return { ...message, attachmentUrl: signed?.signedUrl };
  }));
  messageList.innerHTML = messages.length ? messages.map((message) => {
    const mine = message.sender_id === session.user.id;
    const attachment = message.attachmentUrl
      ? `<a class="message-attachment" href="${message.attachmentUrl}" target="_blank" rel="noopener">Open ${escapeHtml(message.attachment_name || "attachment")}</a>` : "";
    return `<article class="message-item ${mine ? "is-mine" : ""}">
      <p class="message-sender">${mine ? "You" : isCoach ? "Athlete" : "Coach"}</p>
      ${message.body ? `<p>${escapeHtml(message.body).replace(/\n/g, "<br>")}</p>` : ""}${attachment}
      <time datetime="${message.created_at}">${formatDate(message.created_at, true)}</time>
    </article>`;
  }).join("") : '<p class="empty-state">No messages yet. Start the conversation below.</p>';
  messageList.scrollTop = messageList.scrollHeight;
}

async function refreshWorkspace() {
  setStatus(dashboardStatus, "Loading athlete workspace…");
  try {
    const loaders = isGuardian
      ? [loadBilling(), loadBillingAccess(), loadMembershipPlans(), loadInvoices()]
      : [loadProfile(), loadWorkouts(), loadMessages(), loadBilling(), loadBillingAccess(), loadMembershipPlans(), loadInvoices()];
    await Promise.all(loaders);
    setStatus(dashboardStatus, "Workspace is up to date.", "success");
  } catch (error) {
    console.error("Workspace load error:", error);
    setStatus(dashboardStatus, "We couldn't load portal data. Confirm the Supabase setup has been applied.", "error");
  }
}

async function openStripeSession(functionName, button, loadingMessage, extraBody = {}) {
  if (!session || isCoach) return;
  button.disabled = true;
  setStatus(dashboardStatus, loadingMessage);
  try {
    const { data, error } = await supabaseClient.functions.invoke(functionName, {
      body: { athleteId: selectedAthleteId, ...extraBody }
    });
    if (error) throw error;
    if (!data?.url) throw new Error("Stripe did not return a redirect URL.");
    window.location.assign(data.url);
  } catch (error) {
    console.error(`${functionName} error:`, error);
    if (functionName === "create-checkout-session") checkoutRequestId = null;
    setStatus(dashboardStatus, "We couldn't open secure billing. Please try again or contact Odyssey.", "error");
    button.disabled = false;
  }
}

async function showDashboard(activeSession, version) {
  session = activeSession;
  setUserGreeting();
  const { data: coachResult, error } = await supabaseClient.rpc("is_coach");
  if (version !== authStateVersion) return;
  if (error) {
    console.error("Coach role check error:", error);
    showAuthView(loginForm);
    setStatus(authStatus, "Portal setup is incomplete. Ask an administrator to finish the database setup.", "error");
    return;
  }
  isCoach = Boolean(coachResult);
  isGuardian = false;
  resetPortalRoleView();
  authCard.hidden = true;
  dashboard.hidden = false;
  athletePicker.hidden = !isCoach;
  workoutForm.hidden = !isCoach;
  billingAccessForm.hidden = !isCoach;
  draftInvoiceForm.hidden = !isCoach;
  sendInvoiceForm.hidden = !isCoach;
  profileForm.querySelector("button[type='submit']").hidden = isCoach;
  Array.from(profileForm.elements).forEach((control) => {
    if (control.tagName !== "BUTTON") control.disabled = isCoach;
  });
  if (isCoach) {
    athletePicker.querySelector("label").textContent = "Viewing athlete";
    await loadAthletes();
  } else {
    const { data: ownProfile, error: profileError } = await supabaseClient.from("athlete_profiles")
      .select("id").eq("id", activeSession.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (ownProfile) selectedAthleteId = activeSession.user.id;
    else {
      const { data: guardianLinks, error: guardianError } = await supabaseClient
        .from("athlete_billing_authorizations").select("athlete_id");
      if (guardianError) throw guardianError;
      if (!guardianLinks.length) {
        showAuthView(loginForm);
        setStatus(authStatus, "This account has not been linked to an athlete or guardian billing role.", "error");
        return;
      }
      isGuardian = true;
      document.querySelectorAll(".training-only").forEach((element) => { element.hidden = true; });
      document.querySelectorAll(".portal-tab").forEach((tab) => tab.classList.remove("is-active"));
      document.querySelector("[data-panel='billing-panel']").classList.add("is-active");
      document.querySelector("#billing-panel").hidden = false;
      document.querySelector(".portal-dashboard-header h1").textContent = "Billing Portal";
      document.querySelector(".portal-welcome").textContent = "Parent and guardian membership billing.";
      await loadGuardianAthletes();
    }
  }
  await refreshWorkspace();
  if (billingReturn === "success" || billingReturn === "canceled") {
    setStatus(dashboardStatus, billingReturn === "success"
      ? "Checkout complete. Membership status may take a few seconds to update."
      : "Checkout canceled. No payment was made.", billingReturn === "success" ? "success" : "info");
  }
}

async function applyAuthState(activeSession) {
  const version = ++authStateVersion;
  if (!activeSession) {
    const errorMessage = authLinkError?.replace(/\+/g, " ");
    showSignedOut(errorMessage || undefined, errorMessage ? "error" : "info");
    return;
  }
  if (needsPasswordUpdate) {
    session = activeSession;
    showAuthView(passwordForm);
    setStatus(authStatus, authFlowType === "invite"
      ? "Invitation accepted. Create a password to finish setting up your account."
      : "Enter a new password for your account.", "success");
    return;
  }
  await showDashboard(activeSession, version);
}

supabaseClient.auth.onAuthStateChange((event, activeSession) => {
  if (event === "PASSWORD_RECOVERY") needsPasswordUpdate = true;
  if (event === "SIGNED_OUT") needsPasswordUpdate = false;
  window.setTimeout(() => applyAuthState(activeSession), 0);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(loginForm);
  setFormBusy(loginForm, true);
  setStatus(authStatus, "Signing you in…");
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: form.get("email").trim().toLowerCase(),
    password: form.get("password")
  });
  setFormBusy(loginForm, false);
  if (error) {
    console.error("Supabase sign-in error:", error);
    const detail = error.code ? `${error.message} (${error.code})` : error.message;
    setStatus(authStatus, detail || "Sign in failed. Check your email and password.", "error");
  }
  else loginForm.reset();
});

document.querySelector(".forgot-password-button").addEventListener("click", () => {
  forgotForm.elements.email.value = loginForm.elements.email.value;
  showAuthView(forgotForm);
  setStatus(authStatus, "Enter your email and we'll send you a password reset link.");
});
document.querySelector(".back-to-login-button").addEventListener("click", () => {
  showAuthView(loginForm);
  setStatus(authStatus, "Sign in to access your training portal.");
});

forgotForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormBusy(forgotForm, true);
  const redirectTo = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(forgotForm.elements.email.value, { redirectTo });
  setFormBusy(forgotForm, false);
  if (error) setStatus(authStatus, "We couldn't send a reset link. Please try again.", "error");
  else {
    forgotForm.reset();
    setStatus(authStatus, "If an account exists for that email, a reset link is on its way.", "success");
  }
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const password = passwordForm.elements.password.value;
  if (password !== passwordForm.elements.password_confirm.value) {
    setStatus(authStatus, "The passwords do not match.", "error");
    return;
  }
  setFormBusy(passwordForm, true);
  const { error } = await supabaseClient.auth.updateUser({ password });
  setFormBusy(passwordForm, false);
  if (error) setStatus(authStatus, error.message || "We couldn't save your password.", "error");
  else {
    needsPasswordUpdate = false;
    passwordForm.reset();
    window.history.replaceState({}, document.title, window.location.pathname);
    const { data } = await supabaseClient.auth.getSession();
    await applyAuthState(data.session);
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session || isCoach) return;
  const form = new FormData(profileForm);
  setFormBusy(profileForm, true);
  const { error } = await supabaseClient.from("athlete_profiles").upsert({
    id: session.user.id, full_name: form.get("full_name"), age_group: form.get("age_group"),
    primary_event: form.get("primary_event"), goals: form.get("goals")
  }, { onConflict: "id" });
  setFormBusy(profileForm, false);
  setStatus(dashboardStatus, error ? "We couldn't save your profile." : "Your profile has been saved.", error ? "error" : "success");
  if (!error) setUserGreeting(form.get("full_name"));
});

workoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isCoach || !selectedAthleteId) return;
  const form = new FormData(workoutForm);
  setFormBusy(workoutForm, true);
  const { error } = await supabaseClient.from("workouts").insert({
    athlete_id: selectedAthleteId, coach_id: session.user.id, workout_date: form.get("workout_date"),
    title: form.get("title"), details: form.get("details")
  });
  setFormBusy(workoutForm, false);
  if (error) setStatus(dashboardStatus, "We couldn't assign that workout.", "error");
  else { workoutForm.reset(); setStatus(dashboardStatus, "Workout assigned.", "success"); await loadWorkouts(); }
});

messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!session || !selectedAthleteId) return;
  const body = messageForm.elements.body.value.trim();
  const file = messageForm.elements.attachment.files[0];
  if (!body && !file) return setStatus(dashboardStatus, "Write a message or add a file before sending.", "error");
  if (file && file.size > 20 * 1024 * 1024) return setStatus(dashboardStatus, "That file is larger than 20 MB.", "error");
  setFormBusy(messageForm, true);
  let attachmentPath = null;
  if (file) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
    attachmentPath = `${selectedAthleteId}/${Date.now()}-${safeName}`;
    const { error } = await supabaseClient.storage.from("portal-files").upload(attachmentPath, file, { contentType: file.type });
    if (error) {
      setFormBusy(messageForm, false);
      return setStatus(dashboardStatus, "The file could not be uploaded.", "error");
    }
  }
  const { error } = await supabaseClient.from("messages").insert({
    athlete_id: selectedAthleteId, sender_id: session.user.id, body: body || null,
    attachment_path: attachmentPath, attachment_name: file?.name || null, attachment_type: file?.type || null
  });
  setFormBusy(messageForm, false);
  if (error) setStatus(dashboardStatus, "The message could not be sent.", "error");
  else { messageForm.reset(); setStatus(dashboardStatus, "Message sent.", "success"); await loadMessages(); }
});

messageComposeButton.addEventListener("click", () => {
  messageForm.scrollIntoView({ behavior: "smooth", block: "center" });
  window.setTimeout(() => messageForm.elements.body.focus(), 350);
});

messageForm.elements.body.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  messageForm.requestSubmit();
});

athleteSelect.addEventListener("change", async () => {
  selectedAthleteId = athleteSelect.value || null;
  draftInvoiceRequestId = null;
  await refreshWorkspace();
});
document.querySelectorAll(".portal-tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".portal-tab").forEach((item) => item.classList.toggle("is-active", item === tab));
  document.querySelectorAll(".portal-panel").forEach((panel) => { panel.hidden = panel.id !== tab.dataset.panel; });
}));
document.querySelector(".logout-button").addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signOut();
  if (error) setStatus(dashboardStatus, "We couldn't sign you out.", "error");
});

startMembershipButton.addEventListener("click", () => {
  checkoutRequestId ||= crypto.randomUUID();
  if (billingRecord?.subscription_status === "incomplete") {
    return openStripeSession("create-checkout-session", startMembershipButton, "Reopening secure payment…", {
      idempotencyKey: checkoutRequestId
    });
  }
  const selectedIsoWeekdays = Array.from(membershipDayOptions.querySelectorAll("input:checked"))
    .map((input) => Number(input.value));
  const required = Number(membershipDayOptions.dataset.required || 0);
  if (selectedIsoWeekdays.length !== required) {
    return setStatus(dashboardStatus, `Select exactly ${required} recurring training day${required === 1 ? "" : "s"}.`, "error");
  }
  openStripeSession("create-checkout-session", startMembershipButton, "Reserving your training days…", {
    planCode: membershipPlanSelect.value,
    selectedIsoWeekdays,
    idempotencyKey: checkoutRequestId
  });
});
manageBillingButton.addEventListener("click", () => {
  openStripeSession("create-customer-portal-session", manageBillingButton, "Opening secure billing…");
});
membershipPlanSelect.addEventListener("change", () => {
  checkoutRequestId = null;
  renderMembershipDays();
});

manualApprovalCheckbox.addEventListener("change", () => {
  manualApprovalNote.hidden = !manualApprovalCheckbox.checked;
  billingAccessForm.elements.approval_note.required = manualApprovalCheckbox.checked;
});

billingAccessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isCoach || !selectedAthleteId) return;
  setFormBusy(billingAccessForm, true);
  setStatus(dashboardStatus, "Saving billing authorization…");
  const { data, error } = await supabaseClient.functions.invoke("configure-billing-authorization", {
    body: {
      athleteId: selectedAthleteId,
      dateOfBirth: billingAccessForm.elements.date_of_birth.value,
      guardianEmail: billingAccessForm.elements.guardian_email.value,
      manualApproved: manualApprovalCheckbox.checked,
      approvalNote: billingAccessForm.elements.approval_note.value,
      billingEnabled: billingEnabledCheckbox.checked,
      billingEnabledNote: billingAccessForm.elements.billing_enabled_note.value
    }
  });
  setFormBusy(billingAccessForm, false);
  if (error) {
    let message = "We couldn't save billing authorization.";
    try { message = (await error.context?.json())?.error || message; } catch (_) { /* Keep safe fallback. */ }
    setStatus(dashboardStatus, message, "error");
    return;
  }
  billingAccessForm.elements.guardian_email.value = "";
  setStatus(dashboardStatus, data?.requiresBillingMigration
    ? "Authorization saved. Existing Stripe billing must be transferred manually before the new billing user can manage it."
    : data?.minor ? "Minor billing authorization saved." : "Adult billing authorization saved.",
  data?.requiresBillingMigration ? "error" : "success");
  await loadBillingAccess();
});

draftInvoiceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isCoach || !selectedAthleteId) return;
  const dollars = Number(draftInvoiceForm.elements.amount.value);
  const amountCents = Math.round(dollars * 100);
  if (!Number.isFinite(dollars) || Math.abs(amountCents / 100 - dollars) > 0.00001) {
    return setStatus(dashboardStatus, "Enter a valid USD amount with no more than two decimal places.", "error");
  }
  setFormBusy(draftInvoiceForm, true);
  setStatus(dashboardStatus, "Creating Stripe draft only…");
  draftInvoiceRequestId ||= crypto.randomUUID();
  const { data, error } = await supabaseClient.functions.invoke("create-draft-invoice", { body: {
    athleteId: selectedAthleteId,
    amountCents,
    description: draftInvoiceForm.elements.description.value,
    dueDate: draftInvoiceForm.elements.due_date.value,
    requestId: draftInvoiceRequestId
  } });
  setFormBusy(draftInvoiceForm, false);
  if (error) {
    let message = "We couldn't create the draft invoice.";
    try { message = (await error.context?.json())?.error || message; } catch (_) { /* Keep fallback. */ }
    return setStatus(dashboardStatus, message, "error");
  }
  draftInvoiceRequestId = null;
  draftInvoiceForm.reset();
  sendInvoiceForm.elements.invoice_id.value = data.invoiceId;
  setStatus(dashboardStatus, `Draft ${data.invoiceId} created. Review it before finalizing.`, "success");
  await loadInvoices();
});

sendInvoiceForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!isCoach) return;
  const invoiceId = sendInvoiceForm.elements.invoice_id.value.trim();
  const confirmation = sendInvoiceForm.elements.confirmation.value.trim();
  if (confirmation !== "FINALIZE_AND_SEND") {
    return setStatus(dashboardStatus, "Type FINALIZE_AND_SEND exactly to confirm.", "error");
  }
  setFormBusy(sendInvoiceForm, true);
  setStatus(dashboardStatus, `Finalizing and sending ${invoiceId}…`);
  const { error } = await supabaseClient.functions.invoke("finalize-send-invoice", { body: {
    invoiceId,
    confirmation: { invoiceId, action: confirmation }
  } });
  setFormBusy(sendInvoiceForm, false);
  if (error) {
    let message = "We couldn't finalize and send that invoice.";
    try { message = (await error.context?.json())?.error || message; } catch (_) { /* Keep fallback. */ }
    return setStatus(dashboardStatus, message, "error");
  }
  sendInvoiceForm.reset();
  setStatus(dashboardStatus, `${invoiceId} was finalized and sent.`, "success");
  await loadInvoices();
});

if (billingReturn === "success" || billingReturn === "canceled") {
  window.history.replaceState({}, document.title, window.location.pathname + window.location.hash);
}
