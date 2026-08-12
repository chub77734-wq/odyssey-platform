const SUPABASE_KEY = "sb_publishable_UKztkCcChAcgx7ATcoeFIA_76EP9Ytl";
const SUPABASE_URL = "https://ijasonewhoizpqzwymot.supabase.co";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkSession() {
  const { data, error } = await supabaseClient.auth.getSession();

  if (error) {
    console.error("Session error:", error);
    return;
  }

  if (!data.session) {
    console.log("No athlete is signed in yet.");
    return;
  }

  console.log("Signed in as:", data.session.user.email);
}

checkSession();
const profileForm = document.querySelector(".portal-form");

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const { data: sessionData, error: sessionError } =
    await supabaseClient.auth.getSession();

  if (sessionError || !sessionData.session) {
    alert("Your session is not active. Please use your Odyssey invitation link.");
    return;
  }

  const user = sessionData.session.user;
  const formData = new FormData(profileForm);

  const profile = {
    id: user.id,
    full_name: formData.get("full_name"),
    age_group: formData.get("age_group"),
    primary_event: formData.get("primary_event"),
    goals: formData.get("goals"),
    role: "athlete"
  };

  const { error } = await supabaseClient
    .from("athlete_profiles")
    .upsert(profile, { onConflict: "id" });

  if (error) {
    console.error("Profile creation error:", error);
    alert("We couldn't create your profile yet.");
    return;
  }

  alert("Your Odyssey athlete profile has been saved.");
});

const loginForm = document.querySelector(".login-form");

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(loginForm);

  const email = formData.get("email");
  const password = formData.get("password");

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    console.error("Login error:", error);
    alert("Sign in failed. Check the email and password.");
    return;
  }

  alert("Signed in successfully.");
  console.log("Signed in as:", data.user.email);
});