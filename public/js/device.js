// This browser's mark, for the moderators (2026-11-25): a random id made
// once and kept in this browser's storage, sent as a passenger logs in,
// registers and as the game connects. The server keeps only a scrambled copy
// of it (server.js recordSeen), and uses it for one thing: to show the
// moderators which accounts are played from the same browser, so a banned
// passenger's second account can be told apart (lib/moderation.js linkAccounts).
(function () {
  const KEY = "rbv:device";
  const PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  function fresh() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    const b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  let id = "";
  try {
    id = localStorage.getItem(KEY) || "";
    if (!PATTERN.test(id)) {
      id = fresh();
      localStorage.setItem(KEY, id);
    }
  } catch (e) {
    id = "";
  }
  window.RBV_DEVICE = id;
})();
