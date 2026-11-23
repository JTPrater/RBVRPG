document.addEventListener("DOMContentLoaded", function () {
  const socket = io();
  const passengerGrid = document.getElementById("passengerGrid");
  const modal = document.getElementById("passengerModal");
  const closeBtn = document.querySelector(".close-btn");

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

  function openModal(passenger) {
    const birthDate = new Date(passenger.birthdate).toLocaleDateString();

    // Populate the modal with all available information
    document.getElementById("modalAvatar").src = passenger.avatar;
    document.getElementById(
      "modalAvatar"
    ).alt = `${passenger.forename} ${passenger.surname}`;
    document.getElementById(
      "modalName"
    ).textContent = `${passenger.forename} ${passenger.surname}`;
    document.getElementById("modalDob").innerHTML = DOMPurify.sanitize(
      `<i class="fas fa-calendar-alt"></i> Born: ${birthDate}`
    );
    document.getElementById("modalCabin").innerHTML = DOMPurify.sanitize(
      `<i class="fas fa-key"></i> Cabin: ${escapeHtml(
        passenger.cabin_number || passenger.cabin
      )}`
    );
    document.getElementById("modalBio").innerHTML = DOMPurify.sanitize(
      `<p>${escapeHtml(passenger.bio || "No biography provided.").replace(
        /\r?\n/g,
        "<br>"
      )}</p>`
    );

    // Show the modal and disable background scrolling
    modal.style.display = "block";
    document.body.style.overflow = "hidden";

    // Focus the close button for accessibility
    setTimeout(() => closeBtn.focus(), 100);
  }

  // Function to close modal
  function closeModal() {
    modal.style.display = "none";
    document.body.style.overflow = "auto";
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
    const birthDate = new Date(passenger.birthdate).toLocaleDateString();

    card.innerHTML = DOMPurify.sanitize(`
      <div class="avatar">
        <img src="${escapeHtml(passenger.avatar)}" alt="${escapeHtml(
      passenger.forename
    )} ${escapeHtml(passenger.surname)}">
      </div>
      <div class="info">
        <h2>${escapeHtml(passenger.forename)} ${escapeHtml(passenger.surname)}</h2>
        <p class="dob"><i class="fas fa-calendar-alt"></i> Born: ${escapeHtml(birthDate)}</p>
        <p class="cabin"><i class="fas fa-key"></i> Cabin: ${escapeHtml(
          passenger.cabin_number || passenger.cabin
        )}</p>
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

  // Handle initial passengers load
  socket.on("initial-passengers", (passengers) => {
    passengerGrid.innerHTML = "";
    if (Array.isArray(passengers)) {
      passengers.forEach((passenger) => {
        if (passenger) {
          passengerGrid.appendChild(createPassengerCard(passenger));
        }
      });
    }
  });

  // Handle new passenger additions
  socket.on("new-passenger", (passenger) => {
    if (passenger) {
      passengerGrid.appendChild(createPassengerCard(passenger));
    }
  });

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
    if (event.key === "Escape" && modal.style.display === "block") {
      closeModal();
    }
  });
});
