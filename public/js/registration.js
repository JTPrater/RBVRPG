// registration.js - Enhanced with 1910s UX
document.addEventListener("DOMContentLoaded", function () {
  const birthdateInput = document.getElementById("birthdate");
  const ageDisplay = document.getElementById("age-display");
  const avatarInput = document.getElementById("avatar");
  const avatarPreview = document.getElementById("avatar-preview");
  const form = document.getElementById("registrationForm");

  const cabinSelect = document.getElementById("cabin");
  const cabinNumberSelect = document.getElementById("cabin_number");

  // Set birthdate constraints
  const minDate = new Date("1819-01-01");
  const maxDate = new Date("1919-07-09");

  birthdateInput.min = "1819-01-01";
  birthdateInput.max = "1919-07-09";

  function isValidDate(date) {
    return date >= minDate && date <= maxDate;
  }

  function displayDateError(show) {
    const errorMsg =
      birthdateInput.parentElement.querySelector(".error-message") ||
      (() => {
        const div = document.createElement("div");
        div.className = "error-message";
        div.textContent =
          "Birth date must be between January 1st, 1819 and July 9th, 1919";
        birthdateInput.parentElement.appendChild(div);
        return div;
      })();

    errorMsg.style.display = show ? "block" : "none";
    birthdateInput.style.borderColor = show
      ? "#c41e3a"
      : "var(--secondary-color)";
  }

  // Calculate age as of July 9th, 1919
  birthdateInput.addEventListener("change", function () {
    const birthDate = new Date(this.value);

    if (!isValidDate(birthDate)) {
      displayDateError(true);
      ageDisplay.textContent = "";
      return;
    }

    displayDateError(false);
    const voyageDate = new Date("1919-07-09");

    let age = voyageDate.getFullYear() - birthDate.getFullYear();
    const monthDiff = voyageDate.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && voyageDate.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    ageDisplay.textContent = `Age during voyage: ${age} years`;
  });

  // Avatar preview
  avatarInput.addEventListener("change", function (e) {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function (e) {
        avatarPreview.style.backgroundImage = `url(${e.target.result})`;
        avatarPreview.style.backgroundSize = "cover";
        avatarPreview.style.backgroundPosition = "center";
      };
      reader.readAsDataURL(file);
    }
  });

  // Event listener for cabin type selection
  cabinSelect.addEventListener("change", async function () {
    const cabinType = this.value;
    if (!cabinType) {
      cabinNumberSelect.innerHTML =
        '<option value="">-- Select a cabin type first --</option>';
      return;
    }

    try {
      // Fetch available cabins from the server
      const response = await fetch(
        `/api/get_available_cabins?cabin_type=${cabinType}`
      );
      if (!response.ok) {
        throw new Error(`Server responded with status: ${response.status}`);
      }
      const availableCabins = await response.json();

      // Clear existing options
      cabinNumberSelect.innerHTML =
        '<option value="">-- Select a cabin --</option>';

      // Populate dropdown with available cabins
      if (availableCabins.length > 0) {
        availableCabins.forEach((cabin) => {
          const option = document.createElement("option");
          option.value = cabin;
          option.textContent = cabin;
          cabinNumberSelect.appendChild(option);
        });
      } else {
        cabinNumberSelect.innerHTML =
          '<option value="">-- No cabins available --</option>';
      }
    } catch (error) {
      console.error("Error fetching available cabins:", error);
      cabinNumberSelect.innerHTML =
        '<option value="">-- Error loading cabins --</option>';
    }
  });

  // Form submission
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const birthDate = new Date(birthdateInput.value);
    if (!isValidDate(birthDate)) {
      displayDateError(true);
      return;
    }

    const formData = new FormData(this);
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        sessionStorage.setItem("character", JSON.stringify(result.passenger));
        window.location.href = "/main/list.html";
      } else {
        alert(result.error || "Registration failed");
      }
    } catch (error) {
      console.error("Registration error:", error);
      alert("Registration failed. Please try again.");
    }
  });
});
