(function (RBV) {
  const RBV_LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    log: 2,
    debug: 3,
    trace: 4,
  };

  const storedLogLevel = localStorage.getItem("rbvrpg:logLevel") || "warn";
  let activeLogLevel = RBV_LOG_LEVELS[storedLogLevel] ?? RBV_LOG_LEVELS.info;

  const originalConsole = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug
      ? console.debug.bind(console)
      : console.log.bind(console),
  };

  function shouldLog(level) {
    return activeLogLevel >= (RBV_LOG_LEVELS[level] ?? RBV_LOG_LEVELS.info);
  }

  console.log = (...args) => {
    if (shouldLog("log")) originalConsole.log("[RBVRPG]", ...args);
  };
  console.info = (...args) => {
    if (shouldLog("info")) originalConsole.info("[RBVRPG]", ...args);
  };
  console.warn = (...args) => {
    if (shouldLog("warn")) originalConsole.warn("[RBVRPG]", ...args);
  };
  console.error = (...args) => {
    originalConsole.error("[RBVRPG]", ...args);
  };
  console.debug = (...args) => {
    if (shouldLog("debug")) originalConsole.debug("[RBVRPG]", ...args);
  };

  RBV.log = {
    setLevel(levelName) {
      if (levelName in RBV_LOG_LEVELS) {
        activeLogLevel = RBV_LOG_LEVELS[levelName];
        localStorage.setItem("rbvrpg:logLevel", levelName);
      }
    },
    getLevel() {
      return Object.keys(RBV_LOG_LEVELS).find(
        (key) => RBV_LOG_LEVELS[key] === activeLogLevel,
      );
    },
    levels: Object.keys(RBV_LOG_LEVELS),
    originalConsole,
  };

  window.RBVLog = RBV.log;
})(window.RBV);
