(function (RBV) {
  const socket = RBV.socket;
  const STORED_STATS_KEY = "rbvrpg:lastStats";
  let statsSyncTimer = null;
  const STAT_SYNC_DELAY = 30000;

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
    if (el) el.textContent = `\u00a3${playerMoney.toFixed(2)}`;
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

  function persistStatsLocally() {
    const snapshot = {
      hunger: statusBars.hunger.value,
      thirst: statusBars.thirst.value,
      energy: statusBars.energy.value,
      hygiene: statusBars.hygiene.value,
      bladder: statusBars.bladder.value,
      intoxication: statusBars.intoxication.value,
      money: playerMoney,
      savedAt: Date.now(),
    };
    try {
      localStorage.setItem(STORED_STATS_KEY, JSON.stringify(snapshot));
    } catch (err) {
      console.warn("⚠️ Failed to persist stats locally:", err);
    }
  }

  function restoreStatsFromStorage() {
    try {
      const stored = localStorage.getItem(STORED_STATS_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (!parsed) return;
      const { money: _ignoredMoney, ...localStats } = parsed;
      applyStatsToState(localStats);
      console.debug("📦 Restored stats from local storage snapshot", localStats);
    } catch (err) {
      console.warn("⚠️ Failed to restore stats snapshot:", err);
    }
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
      persistStatsLocally();
      scheduleStatsSync();
    }
  }

  function saveStatsToServer() {
    const statsData = {
      hunger: statusBars.hunger.value,
      thirst: statusBars.thirst.value,
      energy: statusBars.energy.value,
      hygiene: statusBars.hygiene.value,
      bladder: statusBars.bladder.value,
      intoxication: statusBars.intoxication.value,
    };
    console.debug("💾 Saving stats to server:", statsData);
    socket.emit("save-stats", statsData);
    persistStatsLocally();
  }

  const statusBarsInterval = setInterval(updateStatusBars, 1000);

  socket.on("stats-loaded", (statsData) => {
    console.debug("📊 Received stats from server:", statsData);
    applyStatsToState(statsData);
    persistStatsLocally();
    console.debug("📊 Stats loaded and visual bars updated");
  });

  restoreStatsFromStorage();

  window.addEventListener("beforeunload", () => {
    try {
      saveStatsToServer();
    } catch (err) {
      console.warn("⚠️ Failed to persist stats on unload:", err);
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
    updateMoneyDisplay,
    applyStatsToState,
    persistStatsLocally,
    restoreStatsFromStorage,
    scheduleStatsSync,
    updateStatusBars,
    saveStatsToServer,
    statusBarsInterval,
  };

  window.statusBars = statusBars;
  window.applyStatsToState = applyStatsToState;
  window.persistStatsLocally = persistStatsLocally;
  window.restoreStatsFromStorage = restoreStatsFromStorage;
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
