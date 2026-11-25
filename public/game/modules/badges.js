// The numbers on the bottom bar's buttons (2026-11-25), as a phone shows them
// on its apps: on Inbox the messages unread; on Money the money received,
// and on Events the events others have posted, since that card was last
// opened. The server counts them (server.js badgesOf) and tells every open
// page when one changes; the cards say when they have been looked at.
(function (RBV) {
  const socket = RBV.socket;
  const BUTTONS = { inbox: "inbox-btn", money: "money-btn", events: "events-btn" };
  const counts = { inbox: 0, money: 0, events: 0 };

  function show(name) {
    const btn = document.getElementById(BUTTONS[name]);
    if (!btn) return;
    let badge = btn.querySelector(".btn-badge");
    const n = counts[name];
    if (!n) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "btn-badge";
      btn.append(badge);
    }
    badge.textContent = n > 99 ? "99+" : String(n);
  }
  function showAll() {
    Object.keys(BUTTONS).forEach(show);
  }

  // whether a card is open (told by the cards): a count for an open card is
  // seen as it comes
  const openCards = {};
  const lastSeen = {};
  const seenLater = {};
  const isOpen = (name) => !!(openCards[name] && openCards[name]());

  // the counts the server gives (any of them)
  function set(next) {
    if (!next || typeof next !== "object") return;
    for (const name of Object.keys(BUTTONS)) {
      if (typeof next[name] === "number" && Number.isFinite(next[name])) {
        counts[name] = Math.max(0, Math.floor(next[name]));
        show(name);
        if (counts[name] && isOpen(name)) {
          // (no more than once in two seconds: the server's answer to it, a
          // nought, ends it)
          const wait = lastSeen[name] ? 2000 - (Date.now() - lastSeen[name]) : 0;
          clearTimeout(seenLater[name]);
          if (wait <= 0) seen(name);
          else {
            seenLater[name] = setTimeout(() => {
              if (counts[name] && isOpen(name)) seen(name);
            }, wait);
          }
        }
      }
    }
  }
  function add(name, n = 1) {
    if (!(name in counts)) return;
    counts[name] += n;
    show(name);
  }
  // a card looked at: its count starts again (here at once, on the server
  // and the passenger's other pages after it)
  function seen(name) {
    if (name !== "money" && name !== "events") return;
    lastSeen[name] = Date.now();
    counts[name] = 0;
    show(name);
    if (socket && socket.connected) socket.emit("card-seen", { card: name });
  }

  let asked = null;
  function refresh() {
    if (!socket || !socket.connected) return;
    socket.timeout(8000).emit("badges", {}, (err, res) => {
      if (!err && res && res.ok) set(res);
      // (asked too soon: once more in a moment)
      else if (!err && res && res.reason === "too-fast" && !asked) {
        asked = setTimeout(() => {
          asked = null;
          refresh();
        }, 1500);
      }
    });
  }

  socket.on("badges", set);
  socket.on("connect", refresh);
  if (socket.connected) refresh();
  document.addEventListener("DOMContentLoaded", showAll);

  RBV.badges = {
    set,
    add,
    seen,
    refresh,
    count: (name) => counts[name] || 0,
    // a card says how to tell whether it is open
    watch: (name, isOpen) => {
      openCards[name] = isOpen;
    },
  };
})(window.RBV);
