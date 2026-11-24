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

  // The server takes connections from logged-in players only: without a
  // session (it ended, or the page was opened logged out), or when this tab's
  // character has been logged out (in another tab), back to the start page.
  // The tab forgets that character, so the game opened again in it takes
  // whoever is logged in on the browser then.
  RBV.socket.on("connect_error", (err) => {
    if (err && err.message === "not-logged-in") {
      try {
        sessionStorage.removeItem("character");
        sessionStorage.removeItem("playerId");
      } catch (e) {}
      window.location.href = "/";
    }
  });

  // A few values the server sends once, as the game connects: the player's own
  // chat colour and how many are aboard. The game's handlers are added as its
  // last script runs, and the connection opens before that while the page is
  // still loading: a value that came first was lost. The latest of each is kept
  // here for a handler added later (game.js).
  RBV.socketLatest = {};
  ["assign-chat-color", "game-user-count"].forEach((event) =>
    RBV.socket.on(event, (value) => {
      RBV.socketLatest[event] = value;
    }),
  );

  window.socket = RBV.socket;
})(window.RBV);
