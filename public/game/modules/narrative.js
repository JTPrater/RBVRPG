(function (RBV) {
  const narrativeSystem = {
    startTime: null,
    currentEventIndex: 0,
    events: [
      {
        time: 0,
        text: "Final preparations are being made for departure.",
      },
      {
        time: 720,
        text: "The ship's horn echoes across Southampton Water. The moorings are cast off, and Britannic slowly pulls away from the dock.",
      },
      {
        time: 930,
        text: "We depart Southampton Water and enter the Solent, increasing to cruising speed.",
      },
      {
        time: 2730,
        text: "The Solent stretches ahead as we make our way toward the open sea.",
      },
      {
        time: 4380,
        text: "The Isle of Wight coastline becomes visible on the starboard side.",
      },
      {
        time: 4980,
        text: "We are now passing the Nab Tower, a few miles east of us.",
      },
      {
        time: 5460,
        text: "The Isle of Wight fades astern as we enter the English Channel proper.",
      },
      {
        time: 6330,
        text: "The engines settle into their steady rhythm for the channel crossing.",
      },
      {
        time: 11130,
        text: "The English coast has disappeared from view. Only open water surrounds us now.",
      },
      {
        time: 14730,
        text: "We are now deep in the English Channel, making steady progress toward France.",
      },
      {
        time: 18330,
        text: "The French coast appears on the horizon as we approach Cherbourg.",
      },
    ],

    _lastWeatherText: null,

    init() {
      const savedIndex = sessionStorage.getItem("narrativeEventIndex");
      if (savedIndex !== null) {
        this.currentEventIndex = parseInt(savedIndex, 10);
      }

      this.updateNarrative();
      this.updateWeather();
      // Guard against double-init leaking the previous interval
      if (this._weatherInterval) clearInterval(this._weatherInterval);
      // Weather-app cadence: the observation itself evolves on an hourly
      // scale, so once a minute is plenty to catch every change
      this._weatherInterval = setInterval(() => this.updateWeather(), 60000);

      console.debug(
        "✅ Narrative system initialized (waiting for server time)",
      );
    },

    updateNarrative() {
      if (!this.startTime) return;
      // Dev scenario pins its own story text
      if (window.RBV && window.RBV.voyage && window.RBV.voyage.DEV_NORTH_ATLANTIC) {
        return;
      }

      const elapsed =
        typeof getElapsedSeconds === "function" ? getElapsedSeconds() : 0;
      const storyTextElement = document.getElementById("story-text");
      if (!storyTextElement) return;

      const nextEvent = this.events[this.currentEventIndex];
      if (nextEvent && elapsed >= nextEvent.time) {
        storyTextElement.style.opacity = "0";
        setTimeout(() => {
          storyTextElement.textContent = nextEvent.text;
          storyTextElement.style.opacity = "1";
          this.currentEventIndex++;
          sessionStorage.setItem(
            "narrativeEventIndex",
            this.currentEventIndex.toString(),
          );
          console.debug(`📖 Narrative event: ${nextEvent.text}`);
        }, 500);
      }
    },

    updateWeather() {
      const weatherElement = document.getElementById("current-weather");
      if (!weatherElement) return;
      if (!window.VoyageWeather) return;

      // Seed with the shared voyage start time so every client computes the
      // same observation; before the server handshake, fall back to 0 and
      // let the next sync correct it
      const voyage = window.RBV && window.RBV.voyage;
      const seed =
        (voyage && (voyage.voyageStartTime || voyage.pendingVoyageStartTime)) ||
        0;
      const dev =
        voyage &&
        voyage.DEV_NORTH_ATLANTIC &&
        typeof window.getDevElapsedSeconds === "function";
      const elapsed = dev
        ? window.getDevElapsedSeconds()
        : typeof getElapsedSeconds === "function"
          ? getElapsedSeconds()
          : 0;

      let state = window.VoyageWeather.computeWeatherAt(
        elapsed,
        seed,
        dev ? voyage.DEV_POSITION : undefined,
      );
      if (window.applyDevWeather) state = window.applyDevWeather(state);
      const text = window.VoyageWeather.formatWeatherReport(state);

      // Skip the fade + DOM write when the observation hasn't changed
      if (text === this._lastWeatherText) return;
      this._lastWeatherText = text;

      weatherElement.style.opacity = "0";
      setTimeout(() => {
        weatherElement.textContent = text;
        weatherElement.style.opacity = "1";
        console.debug(`🌤️ Weather updated: ${text}`);
      }, 300);
    },
  };

  RBV.narrative = { system: narrativeSystem };
  window.narrativeSystem = narrativeSystem;
  console.debug("✅ Defined narrative system.");
})(window.RBV);
