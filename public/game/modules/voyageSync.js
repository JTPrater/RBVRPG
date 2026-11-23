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

  function handleReconnectionRoomJoin() {
    const currentRoom = RBV.gameState.currentRoom;
    if (currentRoom.name) {
      return;
    }

    const characterData = JSON.parse(sessionStorage.getItem("character"));
    if (!characterData) {
      return;
    }

    const deckRooms = window.deckRooms;
    // these two live inside game.js; it hands them over on RBV
    const enterRoom = RBV.enterRoom;
    const findPlayerCabin = RBV.findPlayerCabin;
    const voyageAnchor = v.voyageStartTime || v.pendingVoyageStartTime || null;
    const elapsedSeconds = voyageAnchor
      ? Math.max(0, Math.floor((Date.now() - voyageAnchor) / 1000))
      : 0;

    if (!voyageAnchor) {
    }

    if (elapsedSeconds >= TIMELINE_SECONDS.DEPARTURE_DELAY) {

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
      } else {
        console.error("Could not find ship spawn location for reconnection");
      }
    } else {

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
      } else {
        console.error(
          "Could not determine any spawn location during reconnection",
        );
      }
    }
  }

  window.handleReconnectionRoomJoin = handleReconnectionRoomJoin;
})(window.RBV);
