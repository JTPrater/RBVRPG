(function (RBV) {
  const socket = RBV.socket;
  let statsSyncTimer = null;
  const STAT_SYNC_DELAY = 30000;
  // The server keeps each player's needs and sends them as the game connects
  // ("stats-loaded"). Nothing is saved before they have come: the bars start
  // from placeholders, and saving those would overwrite the player's own.
  let statsLoaded = false;

  // A copy used to be kept in the browser's storage, for whoever used it
  // next (one key for every player on the computer): gone
  try {
    localStorage.removeItem("rbvrpg:lastStats");
  } catch (err) {}

  const statusBars = {
    hunger: { value: 100, rate: 0.005 },
    thirst: { value: 100, rate: 0.007 },
    energy: { value: 100, rate: 0.003 },
    hygiene: { value: 100, rate: 0.002 },
    bladder: { value: 100, rate: 0.006 },
    intoxication: { value: 0, rate: 0.01 },
  };

  let playerMoney = 0;

  function updateMoneyDisplay() {
    const el = document.getElementById("character-money");
    if (el) el.textContent = `£${playerMoney.toFixed(2)}`;
  }

  function clampStat(value) {
    return Math.max(0, Math.min(100, Number(value) || 0));
  }

  function applyStatsToState(stats) {
    Object.entries(stats).forEach(([key, value]) => {
      if (statusBars[key]) {
        statusBars[key].value = clampStat(value);
      }
    });

    if (typeof stats.money === "number") {
      playerMoney = stats.money;
      updateMoneyDisplay();
    }

    Object.keys(statusBars).forEach((key) => {
      const bar = document.querySelector(`.bar.${key}`);
      if (!bar) return;
      const value = statusBars[key].value;
      bar.style.width = `${value}%`;
      const hue =
        key === "intoxication"
          ? 120 - (value / 100) * 120
          : (value / 100) * 120;
      bar.style.setProperty(`--${key}-hue`, hue);
      bar.style.animation =
        value < 20 && key !== "intoxication" ? "pulse 2s infinite" : "none";
    });
  }

  function scheduleStatsSync() {
    if (statsSyncTimer) return;
    statsSyncTimer = setTimeout(() => {
      statsSyncTimer = null;
      saveStatsToServer();
    }, STAT_SYNC_DELAY);
  }

  function updateStatusBars() {
    let statsChanged = false;
    Object.entries(statusBars).forEach(([key, status]) => {
      const previous = status.value;
      if (key === "intoxication") {
        if (status.value > 0) {
          status.value = Math.max(0, status.value - status.rate);
        }
      } else {
        status.value = Math.max(0, Math.min(100, status.value - status.rate));
      }

      const bar = document.querySelector(`.bar.${key}`);
      if (bar) {
        bar.style.width = `${status.value}%`;
        const hue =
          key === "intoxication"
            ? 120 - (status.value / 100) * 120
            : (status.value / 100) * 120;
        bar.style.setProperty(`--${key}-hue`, hue);
        bar.style.animation =
          status.value < 20 && key !== "intoxication"
            ? "pulse 2s infinite"
            : "none";
      }

      if (!statsChanged && Math.abs(previous - status.value) > 0.01) {
        statsChanged = true;
      }
    });

    if (statsChanged) {
      scheduleStatsSync();
    }
  }

  function saveStatsToServer() {
    if (!statsLoaded) return;
    const statsData = {
      hunger: statusBars.hunger.value,
      thirst: statusBars.thirst.value,
      energy: statusBars.energy.value,
      hygiene: statusBars.hygiene.value,
      bladder: statusBars.bladder.value,
      intoxication: statusBars.intoxication.value,
    };
    socket.emit("save-stats", statsData);
  }

  const statusBarsInterval = setInterval(updateStatusBars, 1000);

  socket.on("stats-loaded", (statsData) => {
    if (!statsData || typeof statsData !== "object") return;
    applyStatsToState(statsData);
    statsLoaded = true;
  });
  // The server sends them as the game connects, which can be before this file
  // has run: the connection opens while the page is still loading its scripts,
  // and an answer that came first was lost (money £0.00 and full bars until the
  // next reconnection). So ask, now that this is listening (sent as soon as
  // the connection is up).
  socket.emit("load-stats");

  window.addEventListener("beforeunload", () => {
    try {
      saveStatsToServer();
    } catch (err) {
    }
    clearInterval(statusBarsInterval);
    if (window.RBV?.narrative?.system?._narrativeInterval) {
      clearInterval(window.RBV.narrative.system._narrativeInterval);
    }
    if (window.RBV?.narrative?.system?._weatherInterval) {
      clearInterval(window.RBV.narrative.system._weatherInterval);
    }
  });

  RBV.stats = {
    statusBars,
    get playerMoney() {
      return playerMoney;
    },
    set playerMoney(value) {
      playerMoney = value;
    },
    get loaded() {
      return statsLoaded;
    },
    updateMoneyDisplay,
    applyStatsToState,
    scheduleStatsSync,
    updateStatusBars,
    saveStatsToServer,
    statusBarsInterval,
  };

  window.statusBars = statusBars;
  window.applyStatsToState = applyStatsToState;
  window.scheduleStatsSync = scheduleStatsSync;
  window.updateStatusBars = updateStatusBars;
  window.saveStatsToServer = saveStatsToServer;
  window.updateMoneyDisplay = updateMoneyDisplay;

  Object.defineProperty(window, "playerMoney", {
    get() {
      return playerMoney;
    },
    set(value) {
      playerMoney = value;
    },
  });
})(window.RBV);
