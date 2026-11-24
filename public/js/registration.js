// registration.js: the registration form
document.addEventListener("DOMContentLoaded", function () {
  const birthdateInput = document.getElementById("birthdate");
  const ageDisplay = document.getElementById("age-display");
  const avatarInput = document.getElementById("avatar");
  const avatarPreview = document.getElementById("avatar-preview");
  const form = document.getElementById("registrationForm");

  const cabinSelect = document.getElementById("cabin");
  const cabinNumberSelect = document.getElementById("cabin_number");
  const formError = document.getElementById("form-error");
  const submitButton = form.querySelector('button[type="submit"]');

  // What went wrong, on the form itself beside the Register button (in the
  // page's language: i18n.js watches the page)
  function showFormError(message) {
    formError.textContent = message || "";
    formError.hidden = !message;
    if (message) formError.scrollIntoView({ block: "nearest" });
  }
  // a refusal goes away as soon as the form is changed
  form.addEventListener("input", () => showFormError(""));

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
    birthdateInput.classList.toggle("invalid", show);
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
        avatarPreview.classList.add("has-picture");
      };
      reader.readAsDataURL(file);
    } else {
      avatarPreview.style.backgroundImage = "";
      avatarPreview.classList.remove("has-picture");
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

    // Show loading state
    cabinNumberSelect.innerHTML = '<option value="">Loading cabins...</option>';
    cabinNumberSelect.disabled = true;

    try {
      // Fetch available cabins from the server
      const response = await fetch(
        `/api/get_available_cabins?cabin_type=${encodeURIComponent(cabinType)}`,
      );


      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Cabin API error:", errorData);
        throw new Error(
          errorData.error || `Server responded with status: ${response.status}`,
        );
      }

      const rawCabins = await response.json();
      // Server now returns objects: { number, capacity, occupied, available }
      const availableCabins =
        Array.isArray(rawCabins) &&
        rawCabins.length &&
        typeof rawCabins[0] === "object"
          ? rawCabins
          : rawCabins; // Backwards compatible if server returns strings

      // Clear existing options
      cabinNumberSelect.innerHTML =
        '<option value="">-- Select a cabin --</option>';

      // Populate dropdown with available cabins
      if (availableCabins.length > 0) {
        // Clear capacity info
        document.getElementById("cabin-capacity-info").style.display = "none";
        availableCabins.forEach((cabin) => {
          const option = document.createElement("option");
          if (typeof cabin === "string") {
            option.value = cabin;
            option.textContent = cabin;
            option.dataset.capacity = "";
            option.dataset.occupied = "";
          } else {
            option.value = cabin.number;
            // Show occupied/total (e.g., 1/2) to make it clear how many are taken
            option.textContent = `${cabin.number} (${cabin.occupied}/${cabin.capacity})`;
            option.dataset.capacity = cabin.capacity;
            option.dataset.occupied = cabin.occupied;
            option.dataset.available = cabin.available;
          }
          cabinNumberSelect.appendChild(option);
        });
        // If only one cabin is available, pre-select it and refresh capacity info
        if (cabinNumberSelect.options.length === 2) {
          cabinNumberSelect.selectedIndex = 1;
          cabinNumberSelect.dispatchEvent(new Event("change"));
        }
        cabinNumberSelect.disabled = false;
      }
      // else handled below

      // Listen for cabin selection and show capacity info
      if (!cabinNumberSelect.dataset.capacityListener) {
        cabinNumberSelect.addEventListener("change", function () {
          const selected = this.options[this.selectedIndex];
          const capInfo = document.getElementById("cabin-capacity-info");
          const total = selected?.dataset?.capacity;
          const occupied = selected?.dataset?.occupied;
          const left = selected?.dataset?.available;
          if (total && left !== undefined) {
            // Display occupied/total and seats left
            const occ = selected?.dataset?.occupied ?? 0;
            document.getElementById("capacity-total").textContent =
              `${occ}/${total}`;
            document.getElementById("capacity-left").textContent = left;
            capInfo.style.display = "block";
          } else {
            capInfo.style.display = "none";
          }
        });
        cabinNumberSelect.dataset.capacityListener = "true";
      }

      if (availableCabins.length === 0) {
        cabinNumberSelect.innerHTML =
          '<option value="">-- No cabins available --</option>';
        showFormError("No cabins are currently available for this cabin type.");
      }
    } catch (error) {
      console.error("Error fetching available cabins:", error);
      cabinNumberSelect.innerHTML =
        '<option value="">-- Error loading cabins --</option>';
      showFormError(
        `Failed to load cabin numbers: ${error.message}\n\nPlease try refreshing the page or contact support if the issue persists.`,
      );
    } finally {
      cabinNumberSelect.disabled = false;
    }
  });

  // Load cabins on page load if cabin type is already selected
  if (cabinSelect.value) {
    cabinSelect.dispatchEvent(new Event("change"));
  }

  // Form submission
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const birthDate = new Date(birthdateInput.value);
    if (!isValidDate(birthDate)) {
      displayDateError(true);
      return;
    }

    const formData = new FormData(this);
    showFormError("");
    // one registration a press: the button waits for the answer
    submitButton.disabled = true;
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();
      if (result.success) {
        // this tab plays the new character, whoever else is logged in on the browser
        sessionStorage.setItem("character", JSON.stringify(result.passenger));
        if (result.playerId) sessionStorage.setItem("playerId", result.playerId);
        else sessionStorage.removeItem("playerId");
        window.location.href = "/main/list.html";
        return;
      }
      showFormError(result.error || "Registration failed. Please try again.");
    } catch (error) {
      console.error("Registration error:", error);
      showFormError("Registration failed. Please try again.");
    }
    submitButton.disabled = false;
  });
});
