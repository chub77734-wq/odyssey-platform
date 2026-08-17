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
const authForms = [loginForm, forgotForm, passwordForm];
const hashParams = new URLSearchParams(window.location.hash.slice(1));
const authFlowType = hashParams.get("type");
const authLinkError = hashParams.get("error_description");
let needsPasswordUpdate = authFlowType === "invite" || authFlowType === "recovery";
let authStateVersion = 0;
let session = null;
let selectedAthleteId = null;
let isCoach = false;

function setStatus(target, message, type = "info") {
  target.textContent = message;
  target.dataset.type = type;
}

function showAuthView(view) {
  authForms.forEach((form) => { form.hidden = form !== view; });
  authCard.hidden = false;
  dashboard.hidden = true;
}

function setFormBusy(form, busy) {
  Array.from(form.elements).forEach((control) => { control.disabled = busy; });
}

function escapeHtml(value = "") {
  const element = document.createElement("div");
  element.textContent = value;
  return element.innerHTML;
}

function formatDate(value, withTime = false) {
  const date = new Date(withTime ? value : `${value}T12:00:00`);
  const options = withTime
    ? { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }
    : { weekday: "short", month: "short", day: "numeric" };
  return new Intl.DateTimeFormat("en-US", options).format(date);
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
    await Promise.all([loadProfile(), loadWorkouts(), loadMessages()]);
    setStatus(dashboardStatus, "Workspace is up to date.", "success");
  } catch (error) {
    console.error("Workspace load error:", error);
    setStatus(dashboardStatus, "We couldn't load portal data. Confirm the Supabase setup has been applied.", "error");
  }
}

async function showDashboard(activeSession, version) {
  session = activeSession;
  const { data: coachResult, error } = await supabaseClient.rpc("is_coach");
  if (version !== authStateVersion) return;
  if (error) {
    console.error("Coach role check error:", error);
    showAuthView(loginForm);
    setStatus(authStatus, "Portal setup is incomplete. Ask an administrator to finish the database setup.", "error");
    return;
  }
  isCoach = Boolean(coachResult);
  authCard.hidden = true;
  dashboard.hidden = false;
  athletePicker.hidden = !isCoach;
  workoutForm.hidden = !isCoach;
  profileForm.querySelector("button[type='submit']").hidden = isCoach;
  Array.from(profileForm.elements).forEach((control) => {
    if (control.tagName !== "BUTTON") control.disabled = isCoach;
  });
  if (isCoach) await loadAthletes();
  else selectedAthleteId = activeSession.user.id;
  await refreshWorkspace();
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

athleteSelect.addEventListener("change", async () => {
  selectedAthleteId = athleteSelect.value || null;
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
