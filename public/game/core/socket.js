(function (RBV) {
  RBV.socket = io({
    withCredentials: true,
    // Which of the characters logged in on this browser this tab plays (see
    // core/me.js), named again at every reconnection: without it a dropped
    // connection came back as whoever had logged in last, in any tab
    auth: (cb) => {
      let player = "";
      try {
        player = sessionStorage.getItem("playerId") || "";
      } catch (e) {}
      cb({ player });
    },
  });

  RBV.socket.on("auth-error", (data) => {
    console.error("Authentication required for game action:", data?.message);
    alert("Your session expired. Please log in again.");
    window.location.href = "/";
  });

  // Banned by a moderator (as the game connects, or while playing): this tab's
  // character is logged out, and the start page says why and until when
  // (public/js/main.js shows "rbv:banned")
  let leaving = false;
  function leaveBanned(info) {
    if (leaving) return;
    leaving = true;
    let player = "";
    try {
      player = sessionStorage.getItem("playerId") || "";
      sessionStorage.setItem(
        "rbv:banned",
        JSON.stringify({
          until: (info && info.until) || null,
          reason: (info && (info.reason || info.why)) || "",
        }),
      );
      sessionStorage.removeItem("character");
      sessionStorage.removeItem("playerId");
    } catch (e) {}
    const go = () => {
      window.location.href = "/";
    };
    fetch("/api/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player }),
    }).then(go, go);
  }
  RBV.socket.on("moderation-banned", leaveBanned);

  // The server let this connection go without a ban (it could not read the
  // player's record just then): connect again in a moment, to be checked again
  RBV.socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect" && !leaving) {
      setTimeout(() => {
        if (!leaving && !RBV.socket.connected) RBV.socket.connect();
      }, 3000);
    }
  });

  // The server takes connections from logged-in players only: without a
  // session (it ended, or the page was opened logged out), or when this tab's
  // character has been logged out (in another tab), back to the start page.
  // The tab forgets that character, so the game opened again in it takes
  // whoever is logged in on the browser then. A banned player is turned away
  // (above); and when the server could not read the player's record just
  // then, the connection is tried again in a moment.
  RBV.socket.on("connect_error", (err) => {
    const reason = err && err.message;
    if (reason === "not-logged-in") {
      try {
        sessionStorage.removeItem("character");
        sessionStorage.removeItem("playerId");
      } catch (e) {}
      window.location.href = "/";
    } else if (reason === "banned") {
      leaveBanned(err.data);
    } else if (reason === "try-again") {
      setTimeout(() => RBV.socket.connect(), 3000);
    }
  });

  // A few values the server sends once, as the game connects: the player's own
  // chat colour, how many are aboard, and their standing with the moderators.
  // The game's handlers are added as its last script runs, and the connection
  // opens before that while the page is still loading: a value that came first
  // was lost. The latest of each is kept here for a handler added later
  // (game.js).
  RBV.socketLatest = {};
  ["assign-chat-color", "game-user-count", "moderation-status"].forEach((event) =>
    RBV.socket.on(event, (value) => {
      RBV.socketLatest[event] = value;
    }),
  );

  window.socket = RBV.socket;
})(window.RBV);
