/**
 * Server voyage clock sync and narrative socket events. (Where a player starts
 * is game.js's waitForSpawn, after the Start button.)
 */
(function (RBV) {
  const socket = RBV.socket;
  const narrativeSystem = window.narrativeSystem;

  RBV.voyage = {
    voyageStartTime: null,
    pendingVoyageState: null,
    pendingVoyageStartTime: null,
    initialSyncDone: false,
    lastServerElapsed: 0,
    lastServerElapsedAt: 0,
    latestVoyageState: null,
    CHERBOURG_SHOW_KNOTS: 10,
    CHERBOURG_SLOW_MOVE_FACTOR: 0.15,
    DEV_NORTH_ATLANTIC: false,
    DEV_HOUR: 12,
  };

  const v = RBV.voyage;

  socket.on("voyage-start-time", (serverStartTime) => {
    v.voyageStartTime = serverStartTime;
    v.pendingVoyageStartTime = serverStartTime;

    if (
      typeof updateInfoBar === "function" &&
      typeof updateSkyImage === "function"
    ) {
      if (typeof window.performInitialSync === "function") {
        window.performInitialSync();
      }
    }
  });

  socket.on("voyage-state", (currentVoyageState) => {
    if (!currentVoyageState) return;
    // the voyage's start comes in the same message (it was a second one)
    if (typeof currentVoyageState.startTime === "number") {
      v.voyageStartTime = currentVoyageState.startTime;
      v.pendingVoyageStartTime = currentVoyageState.startTime;
    }

    v.pendingVoyageState = currentVoyageState;
    v.latestVoyageState = currentVoyageState;

    if (typeof currentVoyageState.elapsedSeconds === "number") {
      v.lastServerElapsed = currentVoyageState.elapsedSeconds;
      v.lastServerElapsedAt = Date.now();
    }

    if (v.DEV_NORTH_ATLANTIC) {
      window.currentSpeed = 22;
      window.targetSpeed = 22;
    } else {
      window.currentSpeed = currentVoyageState.speedValue;
      window.targetSpeed = currentVoyageState.targetSpeed;
    }

    if (typeof updateSkyImage === "function") {
      updateSkyImage();
    }

    if (typeof updateInfoBar === "function") {
      updateInfoBar();
    }

    if (narrativeSystem && typeof narrativeSystem.updateWeather === "function") {
      narrativeSystem.updateWeather();
    }

    if (RBV.weatherFx && typeof RBV.weatherFx.apply === "function") {
      RBV.weatherFx.apply();
    }

    if (
      typeof updateInfoBar === "function" &&
      typeof updateSkyImage === "function"
    ) {
      if (typeof window.performInitialSync === "function") {
        window.performInitialSync();
      }
    }
  });

  socket.on("narrative-event", (data) => {
    try {
      if (v.DEV_NORTH_ATLANTIC) {
        const el = document.getElementById("story-text");
        if (el) {
          el.textContent =
            "We are now deep in the North Atlantic, making steady progress. The open ocean stretches to every horizon.";
        }
        return;
      }
      const storyTextElement = document.getElementById("story-text");
      if (storyTextElement) {
        storyTextElement.style.opacity = "0";
        setTimeout(() => {
          storyTextElement.textContent = data.text;
          storyTextElement.style.opacity = "1";
        }, 500);
      }

      if (narrativeSystem) {
        narrativeSystem.currentEventIndex = data.index + 1;
        sessionStorage.setItem(
          "narrativeEventIndex",
          narrativeSystem.currentEventIndex.toString(),
        );
      }
    } catch (err) {
      console.error("Failed to process narrative-event:", err);
    }
  });

  socket.on("narrative-current", (data) => {
    // Dev scenario owns the story text — don't let the server's voyage
    // narrative (e.g. Cherbourg approach) overwrite it
    if (v.DEV_NORTH_ATLANTIC) return;
    const storyTextElement = document.getElementById("story-text");
    if (storyTextElement && data && data.text) {
      storyTextElement.textContent = data.text;
      storyTextElement.style.opacity = "1";
    }
    if (narrativeSystem && data && typeof data.index === "number") {
      narrativeSystem.currentEventIndex = data.index + 1;
      sessionStorage.setItem(
        "narrativeEventIndex",
        narrativeSystem.currentEventIndex.toString(),
      );
    }
  });

})(window.RBV);
