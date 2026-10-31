/**
 * Server voyage clock sync, narrative socket events, reconnection spawn.
 */
(function (RBV) {
  const socket = RBV.socket;
  const { TIMELINE_SECONDS } = window.VoyageState;
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
    console.debug(
      `⏰ Received voyage start time from server: ${new Date(
        v.voyageStartTime,
      ).toISOString()}`,
    );

    if (
      typeof updateInfoBar === "function" &&
      typeof updateSkyImage === "function"
    ) {
      performInitialSync();
    }
  });

  socket.on("voyage-state", (currentVoyageState) => {
    console.debug(
      "🚢 Received current voyage state from server:",
      currentVoyageState,
    );

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
    console.debug(
      `💨 Set window.currentSpeed to ${window.currentSpeed} and targetSpeed to ${window.targetSpeed} for visual effects`,
    );

    if (typeof updateSkyImage === "function") {
      updateSkyImage();
      console.debug("🌤️ Updated sky with server voyage state");
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
      performInitialSync();
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
      console.debug("📣 Received narrative-event from server:", data);
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
      console.error("❌ Failed to process narrative-event:", err);
    }
  });

  socket.on("narrative-current", (data) => {
    // Dev scenario owns the story text — don't let the server's voyage
    // narrative (e.g. Cherbourg approach) overwrite it
    if (v.DEV_NORTH_ATLANTIC) return;
    console.debug("📣 Received narrative-current from server:", data);
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

  function handleReconnectionRoomJoin() {
    const currentRoom = RBV.gameState.currentRoom;
    if (currentRoom.name) {
      console.debug(
        `🔄 Already in room ${currentRoom.name}, skipping auto-join`,
      );
      return;
    }

    const characterData = JSON.parse(sessionStorage.getItem("character"));
    if (!characterData) {
      console.warn("⚠️ No character data found, cannot auto-join room");
      return;
    }

    const deckRooms = window.deckRooms;
    const voyageAnchor = v.voyageStartTime || v.pendingVoyageStartTime || null;
    const elapsedSeconds = voyageAnchor
      ? Math.max(0, Math.floor((Date.now() - voyageAnchor) / 1000))
      : 0;

    if (!voyageAnchor) {
      console.warn(
        "⚠️ Voyage start time not yet available; defaulting spawn to Southampton",
      );
    }

    if (elapsedSeconds >= TIMELINE_SECONDS.DEPARTURE_DELAY) {
      console.debug(
        `🚢 Voyage already departed (${Math.floor(
          elapsedSeconds / 60,
        )} min elapsed) - auto-joining ship`,
      );

      const cabinRoom =
        typeof findPlayerCabin === "function" ? findPlayerCabin() : null;
      const defaultShipRoom =
        (deckRooms.boat || deckRooms.bd || deckRooms.boat_deck)?.find?.(
          (r) => r.id === "port_promenade_bd",
        ) || deckRooms?.a?.find?.((r) => r.id === "port_promenade_bd");

      const fallbackRoom =
        (deckRooms.boat || deckRooms.bd || deckRooms.boat_deck)?.[0] ||
        deckRooms?.a?.[0] ||
        deckRooms?.southampton?.[0] ||
        null;
      const spawnRoom = cabinRoom || defaultShipRoom || fallbackRoom;
      if (spawnRoom && typeof enterRoom === "function") {
        enterRoom(spawnRoom);
        console.debug(`🚪 Auto-joined ship room: ${spawnRoom.name}`);
      } else {
        console.error("❌ Could not find ship spawn location for reconnection");
      }
    } else {
      console.debug(
        `⚓ Voyage not yet departed (${elapsedSeconds}s elapsed) - auto-joining Southampton`,
      );

      const initialRoom = deckRooms.southampton?.find(
        (r) => r.name === "Berth 44 Forward Docks",
      );
      const fallbackRoom =
        initialRoom ||
        deckRooms?.southampton?.[0] ||
        (deckRooms.boat || deckRooms.bd || deckRooms.boat_deck)?.[0] ||
        null;

      if (fallbackRoom && typeof enterRoom === "function") {
        enterRoom(fallbackRoom);
        console.debug(`🚪 Auto-joined Southampton room: ${fallbackRoom.name}`);
      } else {
        console.error(
          "❌ Could not determine any spawn location during reconnection",
        );
      }
    }
  }

  window.handleReconnectionRoomJoin = handleReconnectionRoomJoin;
  console.debug("✅ Voyage sync socket handlers registered.");
})(window.RBV);
