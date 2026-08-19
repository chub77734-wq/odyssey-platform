document.documentElement.classList.add("js");

const menuToggle = document.querySelector(".menu-toggle");
const siteNavigation = document.querySelector("#main-navigation");

function setMenuOpen(isOpen, { returnFocus = false } = {}) {
  if (!menuToggle || !siteNavigation) return;

  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Close main menu" : "Open main menu");
  siteNavigation.classList.toggle("is-open", isOpen);
  document.body.classList.toggle("menu-is-open", isOpen);

  if (isOpen) {
    siteNavigation.querySelector("a")?.focus();
  } else if (returnFocus) {
    menuToggle.focus();
  }
}

menuToggle?.addEventListener("click", () => {
  setMenuOpen(menuToggle.getAttribute("aria-expanded") !== "true");
});

siteNavigation?.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuToggle?.getAttribute("aria-expanded") === "true") {
    setMenuOpen(false, { returnFocus: true });
  }
});

const SUPABASE_KEY = "sb_publishable_UKztkCcChAcgx7ATcoeFIA_76EP9Ytl";
const SUPABASE_URL = "https://ijasonewhoizpqzwymot.supabase.co";
const athleteAccessLinks = document.querySelectorAll(".athlete-access-link");

function updateAthleteAccessLabels(session) {
  athleteAccessLinks.forEach((link) => {
    link.textContent = session ? "Athlete Portal" : "Athlete Sign In";
  });
}

if (window.supabase?.createClient) {
  const publicSiteSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  publicSiteSupabase.auth.onAuthStateChange((_event, session) => {
    updateAthleteAccessLabels(session);
  });
}
