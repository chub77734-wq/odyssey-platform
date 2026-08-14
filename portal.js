const SUPABASE_KEY = "sb_publishable_UKztkCcChAcgx7ATcoeFIA_76EP9Ytl";
const SUPABASE_URL = "https://ijasonewhoizpqzwymot.supabase.co";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const loginForm = document.querySelector(".login-form");
const forgotPasswordForm = document.querySelector(".forgot-password-form");
const passwordForm = document.querySelector(".password-form");
const profileForm = document.querySelector(".athlete-profile-form");
const logoutButton = document.querySelector(".logout-button");
const statusMessage = document.querySelector(".portal-status");
const portalForms = [loginForm, forgotPasswordForm, passwordForm, profileForm];

const hashParameters = new URLSearchParams(window.location.hash.slice(1));
const authFlowType = hashParameters.get("type");
const authLinkError = hashParameters.get("error_description");
let needsPasswordUpdate = authFlowType === "invite" || authFlowType === "recovery";
let authStateVersion = 0;

function setStatus(message, type = "info") {
  statusMessage.textContent = message;
  statusMessage.dataset.type = type;
}

function showView(view) {
  portalForms.forEach((form) => {
    form.hidden = form !== view;
  });
}

function setFormBusy(form, isBusy) {
  Array.from(form.elements).forEach((control) => {
    control.disabled = isBusy;
  });
}

function showSignedOut(message = "Sign in to access your athlete profile.", type = "info") {
  needsPasswordUpdate = false;
  profileForm.reset();
  logoutButton.hidden = true;
  showView(loginForm);
  setStatus(message, type);
}

async function showAthleteProfile(session, version) {
  showView(profileForm);
  logoutButton.hidden = false;
  setStatus("Loading your athlete profile…");

  const { data: profile, error } = await supabaseClient
    .from("athlete_profiles")
    .select("full_name, age_group, primary_event, goals")
    .eq("id", session.user.id)
    .maybeSingle();

  if (version !== authStateVersion) return;

  if (error) {
    console.error("Profile load error:", error);
    setStatus("We couldn't load your athlete profile. Please try again.", "error");
    return;
  }

  profileForm.elements.full_name.value = profile?.full_name || "";
  profileForm.elements.age_group.value = profile?.age_group || "";
  profileForm.elements.primary_event.value = profile?.primary_event || "";
  profileForm.elements.goals.value = profile?.goals || "";
  setStatus(profile ? "Your athlete profile is ready." : "Complete your athlete profile.", "success");
}

async function applyAuthState(session) {
  const version = ++authStateVersion;

  if (!session) {
    const linkErrorMessage = authLinkError?.replace(/\+/g, " ");
    showSignedOut(linkErrorMessage || undefined, linkErrorMessage ? "error" : "info");
    return;
  }

  logoutButton.hidden = false;

  if (needsPasswordUpdate) {
    showView(passwordForm);
    setStatus(
      authFlowType === "invite"
        ? "Invitation accepted. Create a password to finish setting up your account."
        : "Enter a new password for your account.",
      "success"
    );
    return;
  }

  await showAthleteProfile(session, version);
}

supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") needsPasswordUpdate = true;
  if (event === "SIGNED_OUT") needsPasswordUpdate = false;

  // Run Supabase calls after the auth callback finishes to avoid callback deadlocks.
  window.setTimeout(() => applyAuthState(session), 0);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormBusy(loginForm, true);
  setStatus("Signing you in…");

  const formData = new FormData(loginForm);
  const { error } = await supabaseClient.auth.signInWithPassword({
    email: formData.get("email"),
    password: formData.get("password")
  });

  setFormBusy(loginForm, false);

  if (error) {
    console.error("Login error:", error);
    setStatus("Sign in failed. Check your email and password.", "error");
    return;
  }

  loginForm.reset();
});

document.querySelector(".forgot-password-button").addEventListener("click", () => {
  forgotPasswordForm.elements.email.value = loginForm.elements.email.value;
  showView(forgotPasswordForm);
  setStatus("Enter your email and we'll send you a password reset link.");
});

document.querySelector(".back-to-login-button").addEventListener("click", () => {
  showView(loginForm);
  setStatus("Sign in to access your athlete profile.");
});

forgotPasswordForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormBusy(forgotPasswordForm, true);
  setStatus("Sending your reset link…");

  const redirectUrl = `${window.location.origin}${window.location.pathname}`;
  const { error } = await supabaseClient.auth.resetPasswordForEmail(
    forgotPasswordForm.elements.email.value,
    { redirectTo: redirectUrl }
  );

  setFormBusy(forgotPasswordForm, false);

  if (error) {
    console.error("Password reset error:", error);
    setStatus("We couldn't send a reset link. Please try again.", "error");
    return;
  }

  forgotPasswordForm.reset();
  setStatus("If an account exists for that email, a reset link is on its way.", "success");
});

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = passwordForm.elements.password.value;
  const passwordConfirmation = passwordForm.elements.password_confirm.value;

  if (password !== passwordConfirmation) {
    setStatus("The passwords do not match.", "error");
    return;
  }

  setFormBusy(passwordForm, true);
  setStatus("Saving your password…");
  const { error } = await supabaseClient.auth.updateUser({ password });
  setFormBusy(passwordForm, false);

  if (error) {
    console.error("Password update error:", error);
    setStatus(error.message || "We couldn't save your password.", "error");
    return;
  }

  needsPasswordUpdate = false;
  passwordForm.reset();
  window.history.replaceState({}, document.title, window.location.pathname);
  setStatus("Your password has been saved.", "success");

  const { data: sessionData } = await supabaseClient.auth.getSession();
  await applyAuthState(sessionData.session);
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setFormBusy(profileForm, true);
  setStatus("Saving your athlete profile…");

  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();

  if (sessionError || !sessionData.session) {
    setFormBusy(profileForm, false);
    showSignedOut("Your session has expired. Please sign in again.", "error");
    return;
  }

  const formData = new FormData(profileForm);
  const profile = {
    id: sessionData.session.user.id,
    full_name: formData.get("full_name"),
    age_group: formData.get("age_group"),
    primary_event: formData.get("primary_event"),
    goals: formData.get("goals")
  };

  const { error } = await supabaseClient
    .from("athlete_profiles")
    .upsert(profile, { onConflict: "id" });

  setFormBusy(profileForm, false);

  if (error) {
    console.error("Profile save error:", error);
    setStatus("We couldn't save your athlete profile. Please try again.", "error");
    return;
  }

  setStatus("Your Odyssey athlete profile has been saved.", "success");
});

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  setStatus("Signing you out…");
  const { error } = await supabaseClient.auth.signOut();
  logoutButton.disabled = false;

  if (error) {
    console.error("Sign out error:", error);
    setStatus("We couldn't sign you out. Please try again.", "error");
  }
});
