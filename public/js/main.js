// public/js/main.js

// Initialize Socket.io
const socket = io();

// Smooth Scrolling
document.querySelectorAll(".nav-links a").forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault();

    document.querySelector(this.getAttribute("href")).scrollIntoView({
      behavior: "smooth",
    });
  });
});

// Responsive Navigation Menu
const burger = document.querySelector(".burger");
const navLinks = document.querySelector(".nav-links");

burger.addEventListener("click", () => {
  navLinks.classList.toggle("nav-active");
});

// Fade-in Animations
window.addEventListener("load", () => {
  const heroElements = document.querySelectorAll(".hero > *");
  heroElements.forEach((element, index) => {
    setTimeout(() => {
      element.classList.add("fade-in");
    }, index * 300); // Reduced delay
  });
});

// Countdown Timer
const countdownElement = document.getElementById("countdown");
const registerButton = document.getElementById("register-btn");

// Set the date and time for registration to open
const registrationOpenDate = new Date("2024-01-01T19:00:00"); // Example date

function updateCountdown() {
  const now = new Date();
  const timeDifference = registrationOpenDate - now;

  if (timeDifference <= 0) {
    countdownElement.style.display = "none";
    registerButton.style.display = "inline-block";
    clearInterval(countdownInterval);
    return;
  }

  const days = Math.floor(timeDifference / (1000 * 60 * 60 * 24));
  const hours = Math.floor(
    (timeDifference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );
  const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000);

  countdownElement.textContent = `Registration will open in ${days}d ${hours}h ${minutes}m ${seconds}s`;
}

// Update the countdown every second
const countdownInterval = setInterval(updateCountdown, 1000);

document.addEventListener("DOMContentLoaded", () => {
  const climbAboardBtn = document.getElementById("climb-aboard-btn");
  const loginPopup = document.getElementById("login-popup");
  const closeBtn = document.querySelector(".close-btn");
  const loginForm = document.getElementById("login-form");

  // Show the "Climb Aboard" button
  climbAboardBtn.style.display = "inline-block"; // Matches CSS

  // Open the login popup
  climbAboardBtn.addEventListener("click", () => {
    loginPopup.style.display = "flex";
  });

  // Close the login popup
  closeBtn.addEventListener("click", () => {
    loginPopup.style.display = "none";
  });

  // Close popup on outside click
  loginPopup.addEventListener("click", (e) => {
    if (e.target === loginPopup) {
      loginPopup.style.display = "none";
    }
  });

  // Handle login form submission
  loginForm.addEventListener("submit", handleLogin);
});

async function handleLogin(event) {
  event.preventDefault();
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  const response = await fetch("/api/check-credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const result = await response.json();

  if (result.success) {
    sessionStorage.setItem("character", JSON.stringify(result.character));
    sessionStorage.setItem("userEmail", email); // Store email for chat color persistence
    // Redirect to the game or main page
    window.location.href = "/game";
  } else {
    alert("Login failed. Please check your credentials.");
  }
}
