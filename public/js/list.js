document.addEventListener("DOMContentLoaded", function () {
  const passengerGrid = document.getElementById("passengerGrid");
  const passengerCount = document.getElementById("passengerCount");
  const modal = document.getElementById("passengerModal");
  const closeBtn = document.querySelector(".close-btn");
  let openedFrom = null;

  // A passenger who has just registered, or is logged in on this tab, goes
  // straight aboard; anyone else is asked to log in first
  try {
    if (sessionStorage.getItem("character")) {
      document.getElementById("aboard-link").href = "/game";
    }
  } catch (e) {
    /* no storage: the link asks for a login */
  }

  // Function to open modal
  // A passenger's own text goes into the page as text, not as markup
  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(
      /[&<>"']/g,
      (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
          c
        ]
    );
  }

  // "17 May 1890": the day as it was entered, whatever the reader's time
  // zone (a date alone is midnight UTC, which is the evening before in the
  // Americas), and in words, for i18n.js to put into the page's language
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function birthText(value) {
    const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
    if (parts) return `${Number(parts[3])} ${MONTHS[Number(parts[2]) - 1]} ${parts[1]}`;
    const date = new Date(value);
    if (isNaN(date)) return "";
    return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
  }

  function openModal(passenger) {
    const birthDate = birthText(passenger.birthdate);

    // Populate the modal with all available information
    document.getElementById("modalAvatar").src = passenger.avatar;
    document.getElementById(
      "modalAvatar"
    ).alt = `${passenger.forename} ${passenger.surname}`;
    document.getElementById(
      "modalName"
    ).textContent = `${passenger.forename} ${passenger.surname}`;
    document.getElementById("modalDob").textContent = birthDate
      ? `Born: ${birthDate}`
      : "";
    document.getElementById("modalCabin").textContent = `Cabin: ${
      passenger.cabin_number || passenger.cabin
    }`;
    document.getElementById("modalBio").innerHTML = DOMPurify.sanitize(
      `<p>${escapeHtml(passenger.bio || "No biography provided.").replace(
        /\r?\n/g,
        "<br>"
      )}</p>`
    );

    // Show the modal and disable background scrolling
    openedFrom = document.activeElement;
    modal.style.display = "flex";
    document.body.style.overflow = "hidden";

    // Focus the close button for accessibility
    setTimeout(() => closeBtn.focus(), 100);
  }

  // Function to close modal
  function closeModal() {
    modal.style.display = "none";
    document.body.style.overflow = "";
    if (openedFrom && openedFrom.focus) openedFrom.focus();
  }

  // Create passenger card
  function createPassengerCard(passenger) {
    const card = document.createElement("div");
    card.className = "passenger-card";
    card.setAttribute("tabindex", "0");
    card.setAttribute("role", "button");
    card.setAttribute(
      "aria-label",
      `View details for ${passenger.forename} ${passenger.surname}`
    );

    // Store the entire passenger object in the card's dataset
    card.dataset.passenger = JSON.stringify(passenger);

    // Format the birthdate
    const birthDate = birthText(passenger.birthdate);

    card.innerHTML = DOMPurify.sanitize(`
      <div class="avatar">
        <img src="${escapeHtml(passenger.avatar)}" alt="${escapeHtml(
      passenger.forename
    )} ${escapeHtml(passenger.surname)}">
      </div>
      <div class="info">
        <h2>${escapeHtml(passenger.forename)} ${escapeHtml(passenger.surname)}</h2>
        <p class="cabin">Cabin: ${escapeHtml(
          passenger.cabin_number || passenger.cabin
        )}</p>
        ${birthDate ? `<p class="dob">Born: ${escapeHtml(birthDate)}</p>` : ""}
      </div>
    `);

    // Add click event to open modal
    card.addEventListener("click", function () {
      const passenger = JSON.parse(card.dataset.passenger);
      openModal(passenger);
    });

    // Add keyboard event for accessibility
    card.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const passenger = JSON.parse(card.dataset.passenger);
        openModal(passenger);
      }
    });

    return card;
  }

  // The passengers, from the server (a page that is left open shows newcomers
  // when it is opened again)
  fetch("/api/passengers")
    .then((response) => (response.ok ? response.json() : []))
    .then((passengers) => {
      passengerGrid.innerHTML = "";
      let shown = 0;
      if (Array.isArray(passengers)) {
        passengers.forEach((passenger) => {
          if (passenger) {
            passengerGrid.appendChild(createPassengerCard(passenger));
            shown += 1;
          }
        });
      }
      passengerCount.textContent =
        shown === 1 ? "1 passenger" : `${shown} passengers`;
    })
    .catch((error) => console.error("Passenger list:", error));

  // Close modal when clicking the close button
  closeBtn.addEventListener("click", closeModal);

  // Close modal when clicking outside the modal content
  window.addEventListener("click", function (event) {
    if (event.target === modal) {
      closeModal();
    }
  });

  // Close modal when pressing the Escape key
  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && modal.style.display !== "none") {
      closeModal();
    }
  });
});
