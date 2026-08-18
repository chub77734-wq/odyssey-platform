const SUPABASE_KEY = "sb_publishable_UKztkCcChAcgx7ATcoeFIA_76EP9Ytl";
const SUPABASE_URL = "https://ijasonewhoizpqzwymot.supabase.co";
const publicSiteSupabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const athleteAccessLinks = document.querySelectorAll(".athlete-access-link");

function updateAthleteAccessLabels(session) {
  athleteAccessLinks.forEach((link) => {
    link.textContent = session ? "Athlete Portal" : "Athlete Sign In";
  });
}

publicSiteSupabase.auth.onAuthStateChange((_event, session) => {
  updateAthleteAccessLabels(session);
});
