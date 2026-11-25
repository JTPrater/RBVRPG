// public/js/main.js: the home page

// Registration opens at this moment. While it lies ahead, the page counts
// down to it and Register Now is put away; it is long past, so the button
// shows.
const registrationOpenDate = new Date("2024-01-01T19:00:00");

document.addEventListener("DOMContentLoaded", () => {
  const countdownElement = document.getElementById("countdown");
  const registerButton = document.getElementById("register-btn");
  const climbAboardBtn = document.getElementById("climb-aboard-btn");
  const loginPopup = document.getElementById("login-popup");
  const closeBtn = loginPopup.querySelector(".close-btn");
  const loginForm = document.getElementById("login-form");

  // Countdown Timer
  let countdownInterval = null;
  function updateCountdown() {
    const timeDifference = registrationOpenDate - new Date();
    if (timeDifference <= 0) {
      countdownElement.textContent = "";
      registerButton.style.display = "";
      clearInterval(countdownInterval);
      return;
    }
    const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
    const hours = Math.floor(
      (timeDifference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
    );
    const minutes = Math.floor(
      (timeDifference % (1000 * 60 * 60)) / (1000 * 60),
    );
    const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000);
    registerButton.style.display = "none";
    countdownElement.textContent = `Registration will open in ${days}d ${hours}h ${minutes}m ${seconds}s`;
  }
  if (registrationOpenDate - new Date() > 0) {
    countdownInterval = setInterval(updateCountdown, 1000);
    updateCountdown();
  }

  // The login card
  let openedFrom = null;
  function openLogin() {
    openedFrom = document.activeElement;
    showLoginError("");
    loginPopup.style.display = "flex";
    document.getElementById("email").focus();
  }
  function closeLogin() {
    loginPopup.style.display = "none";
    if (openedFrom && openedFrom.focus) openedFrom.focus();
  }
  climbAboardBtn.addEventListener("click", openLogin);
  closeBtn.addEventListener("click", closeLogin);
  // a click on the page behind the card
  loginPopup.addEventListener("mousedown", (e) => {
    if (e.target === loginPopup) closeLogin();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && loginPopup.style.display !== "none") closeLogin();
  });
  loginForm.addEventListener("submit", handleLogin);
  // a refusal goes away as soon as the form is changed
  loginForm.addEventListener("input", () => showLoginError(""));
  // the other pages' Climb Aboard comes here to log in
  if (location.hash === "#login") openLogin();
  window.addEventListener("hashchange", () => {
    if (location.hash === "#login") openLogin();
  });

  // Sent here from the game by a moderator's ban (game core/socket.js): the
  // card says so
  let banned = null;
  try {
    banned = JSON.parse(sessionStorage.getItem("rbv:banned") || "null");
    sessionStorage.removeItem("rbv:banned");
  } catch (e) {}
  if (banned) {
    openLogin();
    showBan(banned);
  }
  // the ban's date is written in the page's language: again when it changes
  document.addEventListener("rbv:language", () => {
    if (shownBan) showBan(shownBan);
  });
});

// The ban the card is showing (or null)
let shownBan = null;
function showBan(ban) {
  showLoginError(banLines(ban));
  shownBan = ban;
}

// What went wrong, on the card itself (in the page's language: i18n.js
// watches the page). Several lines: one sentence each.
function showLoginError(message) {
  shownBan = null;
  const box = document.getElementById("login-error");
  const lines = (Array.isArray(message) ? message : [message]).filter(Boolean);
  box.textContent = "";
  lines.forEach((text, i) => {
    if (i) box.appendChild(document.createElement("br"));
    box.appendChild(document.createTextNode(text));
  });
  box.hidden = !lines.length;
}

// A ban, as the passenger is told it: until when (in the page's language),
// and why (the moderator's own words)
function banLines({ until, reason } = {}) {
  let when = "";
  const d = until ? new Date(until) : null;
  if (d && !isNaN(d.getTime())) {
    const lang = (window.RBV_I18N && window.RBV_I18N.lang) || "en";
    const options = { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" };
    try {
      when = d.toLocaleString(lang === "en" ? "en-GB" : lang, options);
    } catch (e) {
      when = d.toLocaleString();
    }
  }
  return [
    when
      ? `This passenger has been banned until ${when}.`
      : "This passenger has been banned.",
    reason ? `Reason: ${reason}` : "",
  ];
}

// Every outcome says something: a refused password, too many attempts, a
// server that did not answer (a reply that was not JSON used to throw here,
// and "Climb aboard" then did nothing at all)
async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  const button =
    event.submitter || event.target.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  showLoginError("");

  let response = null;
  let result = null;
  try {
    response = await fetch("/api/check-credentials", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // (device: this browser's mark for the moderators, js/device.js)
      body: JSON.stringify({ email, password, device: window.RBV_DEVICE || "" }),
    });
    result = await response.json().catch(() => null);
  } catch (error) {
    response = null;
  } finally {
    if (button) button.disabled = false;
  }

  if (result && result.success) {
    // this tab plays this character, whoever else is logged in on the browser
    sessionStorage.setItem("character", JSON.stringify(result.character));
    if (result.playerId) sessionStorage.setItem("playerId", result.playerId);
    else sessionStorage.removeItem("playerId");
    window.location.href = "/game";
  } else if (result && result.banned) {
    showBan(result);
  } else if (response && response.status === 429) {
    // the server says how long to wait
    showLoginError(
      (result && result.error) ||
        "Too many login attempts. Please wait a few minutes and try again.",
    );
  } else if (!response || response.status >= 500 || !result) {
    showLoginError(
      "The ship could not be reached. Check your connection and try again.",
    );
  } else {
    showLoginError("Login failed. Please check your credentials.");
    const passwordBox = document.getElementById("password");
    passwordBox.focus();
    passwordBox.select();
  }
}
