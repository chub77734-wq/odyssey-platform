document.documentElement.classList.add("js");

const menuToggle = document.querySelector(".menu-toggle");
const siteNavigation = document.querySelector("#main-navigation");

function setMenuOpen(isOpen, { returnFocus = false } = {}) {
  if (!menuToggle || !siteNavigation) return;

  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Close main menu" : "Open main menu");
  siteNavigation.classList.toggle("is-open", isOpen);
  document.body.classList.toggle("menu-is-open", isOpen);
  if (!isOpen && typeof menuOpenedByHover !== "undefined") {
    menuOpenedByHover = false;
    menuPinnedOpen = false;
  }

  if (!isOpen && returnFocus) {
    menuToggle.focus();
  }
}

const hoverMenu = window.matchMedia("(hover: hover) and (pointer: fine)");
const siteHeader = document.querySelector(".site-header");
let menuCloseTimer;
let pointerIsPressingMenu = false;
let menuOpenedByHover = false;
let menuPinnedOpen = false;

menuToggle?.addEventListener("click", () => {
  if (menuOpenedByHover) {
    menuOpenedByHover = false;
    menuPinnedOpen = true;
    setMenuOpen(true);
    return;
  }
  const willOpen = menuToggle.getAttribute("aria-expanded") !== "true";
  menuPinnedOpen = willOpen;
  setMenuOpen(willOpen);
});

menuToggle?.addEventListener("pointerdown", () => {
  pointerIsPressingMenu = true;
  window.setTimeout(() => { pointerIsPressingMenu = false; }, 0);
});

menuToggle?.addEventListener("focus", () => {
  if (!pointerIsPressingMenu) setMenuOpen(true);
});

[menuToggle, siteNavigation].filter(Boolean).forEach((element) => {
  element.addEventListener("pointerenter", () => {
    if (!hoverMenu.matches) return;
    window.clearTimeout(menuCloseTimer);
    if (menuToggle?.getAttribute("aria-expanded") !== "true") menuOpenedByHover = true;
    setMenuOpen(true);
  });
});

siteHeader?.addEventListener("pointerleave", () => {
  if (!hoverMenu.matches || menuPinnedOpen) return;
  menuCloseTimer = window.setTimeout(() => {
    menuOpenedByHover = false;
    setMenuOpen(false);
  }, 180);
});

siteHeader?.addEventListener("focusout", () => {
  window.setTimeout(() => {
    if (!siteHeader.contains(document.activeElement)) setMenuOpen(false);
  }, 0);
});

siteNavigation?.addEventListener("click", (event) => {
  if (event.target.closest("a")) setMenuOpen(false);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && menuToggle?.getAttribute("aria-expanded") === "true") {
    setMenuOpen(false, { returnFocus: true });
  }
});

document.addEventListener("click", (event) => {
  if (
    menuToggle?.getAttribute("aria-expanded") === "true" &&
    !event.target.closest(".site-header")
  ) {
    setMenuOpen(false);
  }
});

const contentDisclosures = [...document.querySelectorAll("main details")];
const hoverDisclosures = window.matchMedia("(hover: hover) and (pointer: fine)");
const disclosureReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

contentDisclosures.forEach((details) => {
  const summary = details.querySelector(":scope > summary");
  const content = [...details.children].filter((child) => child !== summary);
  let closeTimer;
  let detailsAnimation;
  let contentAnimations = [];
  let disclosureIsOpen = details.open;

  if (!summary) return;

  function setDisclosureOpen(shouldOpen) {
    if (disclosureIsOpen === shouldOpen && !detailsAnimation) return;

    disclosureIsOpen = shouldOpen;
    const startHeight = details.getBoundingClientRect().height;
    detailsAnimation?.cancel();
    contentAnimations.forEach((animation) => animation.cancel());
    detailsAnimation = undefined;
    contentAnimations = [];

    if (shouldOpen && !details.open) details.open = true;

    if (disclosureReducedMotion.matches || !details.animate) {
      details.open = shouldOpen;
      details.style.removeProperty("height");
      details.style.removeProperty("overflow");
      return;
    }

    const borderHeight = details.offsetHeight - details.clientHeight;
    const targetHeight = shouldOpen
      ? details.scrollHeight + borderHeight
      : summary.offsetHeight + borderHeight;

    details.style.height = `${startHeight}px`;
    details.style.overflow = "hidden";
    detailsAnimation = details.animate(
      { height: [`${startHeight}px`, `${targetHeight}px`] },
      { duration: 200, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "forwards" }
    );
    contentAnimations = content.map((element) => element.animate(
      shouldOpen
        ? [{ opacity: 0, transform: "translateY(-5px)" }, { opacity: 1, transform: "translateY(0)" }]
        : [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(-4px)" }],
      { duration: shouldOpen ? 180 : 140, easing: "ease-out", fill: "forwards" }
    ));

    detailsAnimation.addEventListener("finish", () => {
      if (!disclosureIsOpen) details.open = false;
      details.style.removeProperty("height");
      details.style.removeProperty("overflow");
      contentAnimations.forEach((animation) => animation.cancel());
      contentAnimations = [];
      detailsAnimation = undefined;
    }, { once: true });
  }

  function openTemporarily(reason) {
    window.clearTimeout(closeTimer);
    if (!disclosureIsOpen) {
      setDisclosureOpen(true);
      details.dataset.autoOpen = reason;
    }
  }

  function closeTemporaryDisclosure() {
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      if (
        details.dataset.autoOpen &&
        !details.matches(":hover") &&
        !details.matches(":focus-within")
      ) {
        setDisclosureOpen(false);
        delete details.dataset.autoOpen;
      }
    }, 140);
  }

  details.addEventListener("pointerenter", () => {
    if (hoverDisclosures.matches) openTemporarily("hover");
  });

  details.addEventListener("pointerleave", () => {
    if (hoverDisclosures.matches) closeTemporaryDisclosure();
  });

  details.addEventListener("focusin", () => {
    if (hoverDisclosures.matches) openTemporarily("focus");
  });

  details.addEventListener("focusout", closeTemporaryDisclosure);

  summary.addEventListener("click", (event) => {
    if (details.dataset.autoOpen) {
      event.preventDefault();
      delete details.dataset.autoOpen;
      setDisclosureOpen(true);
      return;
    }
    event.preventDefault();
    delete details.dataset.autoOpen;
    setDisclosureOpen(!disclosureIsOpen);
  });

  details.addEventListener("toggle", () => {
    if (!details.open) {
      disclosureIsOpen = false;
      delete details.dataset.autoOpen;
    }
  });
});

const ambientVideos = [...document.querySelectorAll(".ambient-video")];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
const slowConnection = ["slow-2g", "2g", "3g"].includes(connection?.effectiveType);

function getMediaControl(video) {
  return video.closest(".hero")?.querySelector(".media-pause-control")
    || video.parentElement?.querySelector(".media-pause-control");
}

function setMediaControl(control, state) {
  if (!control) return;
  const icon = control.querySelector("span[aria-hidden]");
  const label = control.querySelector("span:last-child");
  const isPaused = state === "resume";
  const nextLabel = isPaused ? label?.textContent.replace(/^Pause/, "Resume") : label?.textContent.replace(/^Resume/, "Pause");
  if (icon) icon.textContent = isPaused ? "▶" : "Ⅱ";
  if (label && nextLabel) label.textContent = nextLabel;
  control.setAttribute("aria-label", nextLabel || (isPaused ? "Resume video" : "Pause video"));
}

function disableAmbientVideo(video, control) {
  video.pause();
  video.classList.remove("is-visible");
  video.replaceChildren();
  video.removeAttribute("src");
  video.load();
  if (control) control.hidden = true;
}

if (ambientVideos.length && !reducedMotion.matches && !connection?.saveData && !slowConnection) {
  const isMobile = window.matchMedia("(max-width: 760px)").matches;

  ambientVideos.forEach((video) => {
    const control = getMediaControl(video);
    const isHeroVideo = video.classList.contains("hero-video");
    const observedTarget = isHeroVideo ? video.closest(".hero") : video;
    const candidates = isMobile || video.dataset.preferWebm === "true"
      ? [[video.dataset.mobileWebm, "video/webm"], [video.dataset.mobileMp4, "video/mp4"]]
      : [[video.dataset.desktopMp4, "video/mp4"], [video.dataset.desktopWebm, "video/webm"]];
    const sources = candidates.filter(([source]) => source);
    let wasOutsideViewport = true;
    let isInViewport = false;
    let userPaused = false;
    let playbackRequest = 0;

    if (!sources.length) return;

    sources.forEach(([source, type]) => {
      const sourceElement = document.createElement("source");
      sourceElement.src = source;
      sourceElement.type = type;
      video.append(sourceElement);
    });

    video.addEventListener("playing", () => {
      video.classList.add("is-visible");
      userPaused = false;
      if (control) {
        control.hidden = false;
        setMediaControl(control, "pause");
      }
    });

    video.addEventListener("ended", () => {
      if (control) control.hidden = true;
    });

    video.addEventListener("error", () => disableAmbientVideo(video, control));

    control?.addEventListener("click", () => {
      if (video.paused && !video.ended) {
        video.play().catch(() => setMediaControl(control, "resume"));
      } else if (!video.ended) {
        userPaused = true;
        video.pause();
        setMediaControl(control, "resume");
      }
    });

    function playFromStart() {
      if (!isInViewport || document.hidden) return;
      const request = ++playbackRequest;
      wasOutsideViewport = false;
      userPaused = false;

      const beginPlayback = () => {
        if (request !== playbackRequest || !isInViewport || document.hidden) return;
        try {
          video.currentTime = 0;
        } catch (_error) {
          // The poster remains visible if the browser cannot seek this source.
        }
        video.play().catch(() => {
          if (control) control.hidden = true;
        });
      };

      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
        beginPlayback();
      } else {
        video.addEventListener("loadedmetadata", beginPlayback, { once: true });
        video.load();
      }
    }

    function refreshHeroPlayback({ forceReplay = false } = {}) {
      if (!isHeroVideo || !observedTarget) return;
      const rect = observedTarget.getBoundingClientRect();
      const visibleHeight = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);
      const heroIsVisible = visibleHeight > Math.min(rect.height * 0.35, window.innerHeight * 0.35);

      if (!heroIsVisible) {
        isInViewport = false;
        wasOutsideViewport = true;
        if (!video.paused && !video.ended) video.pause();
        return;
      }

      isInViewport = true;
      if (wasOutsideViewport || forceReplay) playFromStart();
    }

    if ("IntersectionObserver" in window && observedTarget) {
      const observer = new IntersectionObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;

        if (!entry.isIntersecting) {
          playbackRequest += 1;
          isInViewport = false;
          if (!video.paused && !video.ended) video.pause();
          wasOutsideViewport = true;
          return;
        }

        isInViewport = true;
        if (wasOutsideViewport && !document.hidden) {
          playFromStart();
        }
      }, { threshold: 0.35 });
      observer.observe(observedTarget);
    }

    if (isHeroVideo) {
      window.requestAnimationFrame(() => refreshHeroPlayback());
      window.addEventListener("pageshow", (event) => {
        window.setTimeout(() => refreshHeroPlayback({ forceReplay: event.persisted }), 0);
      });
      window.addEventListener("popstate", () => {
        window.setTimeout(() => refreshHeroPlayback({ forceReplay: true }), 0);
      });
      window.addEventListener("hashchange", () => {
        window.setTimeout(() => refreshHeroPlayback({ forceReplay: true }), 0);
      });
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && !video.paused) {
        userPaused = true;
        video.pause();
        if (control) setMediaControl(control, "resume");
      }
    });

    video.addEventListener("pause", () => {
      if (userPaused && !video.ended && control) {
        control.hidden = false;
        setMediaControl(control, "resume");
      }
    });
  });
}

reducedMotion.addEventListener?.("change", (event) => {
  if (event.matches) {
    ambientVideos.forEach((video) => {
      const control = getMediaControl(video);
      disableAmbientVideo(video, control);
    });
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
