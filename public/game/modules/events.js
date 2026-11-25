// Events (2026-11-25): events passengers hold aboard. The bottom bar's Events
// button opens the card (game.html #events-popup): what is on now and
// coming, soonest first, each with its room (pressed, it takes one there),
// its host and who means to go; and a form to hold one: a title, a room
// (chosen by typing, modules/picker.js), a time of the ship's day, today or
// tomorrow, and a few words on it. The server keeps them and checks every
// one (server.js "events-list", "events-create", "events-going",
// "events-cancel"; the rules in lib/shipEvents.js) and tells every chat as
// one starts. The number on the button counts the events others have posted
// since the card was last opened (modules/badges.js).
(function (RBV) {
  const socket = RBV.socket;
  const $ = (id) => document.getElementById(id);
  const myId = () => sessionStorage.getItem("playerId") || "";

  // The server's refusals, as the page says them
  const REFUSED = {
    title: "Give the event a title.",
    room: "Choose a room from the list.",
    time: "Choose a time.",
    past: "That time has passed. Choose a later one, or tomorrow.",
    hosting: "You can hold three events at a time.",
    taken: "Another event is in that room then.",
    confined: "You can't hold events from here.",
    "too-fast": "Wait a moment before posting another.",
    "too-many": "That's enough events for now. Try again later.",
    gone: "That event is no longer on.",
    "not-yours": "That event is not yours to cancel.",
  };
  const NO_ANSWER = "The event could not be posted. Try again.";

  // The decks of the deck plans, in order, and what they are called
  // (the docks at Southampton hold no events)
  const DECKS = {
    boat_deck: "Boat Deck",
    a_deck: "A Deck",
    b_deck: "B Deck",
    c_deck: "C Deck",
    d_deck: "D Deck",
  };

  // An element; text goes in as text. "own": a passenger's own words (titles,
  // descriptions, names), which the page's language leaves as written.
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "own") node.setAttribute("data-no-i18n", "");
      else if (key === "class") node.className = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function ask(event, data) {
    return new Promise((resolve) => {
      if (!socket || !socket.connected) return resolve(null);
      socket.timeout(8000).emit(event, data, (err, res) => resolve(err ? null : res));
    });
  }
  async function askPatiently(event, data) {
    const res = await ask(event, data);
    if (res && !res.ok && res.reason === "too-fast") {
      await new Promise((r) => setTimeout(r, 1200));
      return ask(event, data);
    }
    return res;
  }

  function say(text) {
    if (typeof RBV.sayInChat === "function") RBV.sayInChat(text);
  }
  function status(text, bad) {
    const line = $("events-status");
    if (!line) return;
    line.textContent = text || "";
    line.classList.toggle("bad", !!bad);
  }

  // ------------------------------------------------------------ the rooms
  function decks() {
    return window.deckRooms || (RBV.data && RBV.data.deckRooms) || {};
  }
  // every room of the ship's decks, a deck at a time, for the picker
  function roomItems() {
    const items = [];
    const all = decks();
    const order = [...Object.keys(DECKS), ...Object.keys(all).filter((d) => !(d in DECKS))];
    for (const deck of order) {
      if (deck === "southampton" || !Array.isArray(all[deck])) continue;
      for (const r of all[deck]) {
        if (!r || !r.id || !r.name) continue;
        items.push({ id: r.id, label: r.name, sub: DECKS[deck] || "" });
      }
    }
    return items;
  }
  function roomName(id) {
    const all = decks();
    for (const deck of Object.keys(all)) {
      const rooms = all[deck];
      if (!Array.isArray(rooms)) continue;
      const r = rooms.find((x) => x && x.id === id);
      if (r) return r.name;
    }
    return id;
  }

  // ------------------------------------------------------------ the clock
  // The ship's minute of the day, as the server last said it, run on since
  let clock = null; // { minute, at }
  const shipMinute = () =>
    clock ? (clock.minute + Math.floor((Date.now() - clock.at) / 60000)) % 1440 : null;
  const two = (n) => String(n).padStart(2, "0");
  const clockText = (minute) => `${two(Math.floor(minute / 60))}:${two(minute % 60)}`;
  function showClock() {
    const m = shipMinute();
    $("events-clock").textContent = m === null ? "" : clockText(m);
  }

  function fillTimes() {
    const hour = $("events-hour");
    const minute = $("events-minute");
    if (hour.options.length) return;
    for (let h = 0; h < 24; h++) hour.append(el("option", { value: two(h) }, two(h)));
    for (let m = 0; m < 60; m += 5) minute.append(el("option", { value: two(m) }, two(m)));
  }
  // the next whole hour of the ship's clock (tomorrow's first, after 23:00)
  function suggestTime() {
    const m = shipMinute();
    if (m === null) return;
    const next = Math.floor(m / 60) + 1;
    $("events-day").value = next >= 24 ? "1" : "0";
    $("events-hour").value = two(next % 24);
    $("events-minute").value = "00";
  }

  // ------------------------------------------------------------ the list
  let events = [];
  let picker = null;
  const cardOpen = () => $("events-popup").style.display === "block";

  const DAY_WORD = { "-1": "Yesterday", 0: "Today", 1: "Tomorrow" };

  function renderList() {
    const list = $("events-list");
    list.textContent = "";
    if (!events.length) {
      list.append(el("li", { class: "events-empty" }, "No events yet."));
      return;
    }
    for (const e of events) {
      const room = el("button", { type: "button", class: "events-room", title: "Go there" }, roomName(e.room));
      room.addEventListener("click", () => {
        if (RBV.goToRoom && RBV.goToRoom(e.room)) closeCard();
      });
      const going = el(
        "button",
        { type: "button", class: "events-going", "aria-pressed": e.imGoing ? "true" : "false" },
        e.imGoing ? "Going" : "I'll be there",
      );
      going.addEventListener("click", () => setGoing(e, !e.imGoing));
      let cancel = null;
      if (e.canCancel) {
        cancel = el("button", { type: "button", class: "events-cancel" }, e.mine ? "Cancel" : "Remove");
        cancel.addEventListener("click", () => cancelEvent(e));
      }
      list.append(
        el(
          "li",
          { class: `events-item${e.on ? " on" : ""}` },
          el(
            "div",
            { class: "events-when" },
            e.on ? el("span", { class: "events-on" }, "On now") : el("span", null, DAY_WORD[e.day] || ""),
            " ",
            el("span", { class: "events-time" }, e.time),
          ),
          el("div", { class: "events-title", own: true }, e.title),
          el(
            "div",
            { class: "events-where" },
            room,
            el("span", { class: "events-host" }, `Hosted by ${e.host}`),
          ),
          e.details ? el("p", { class: "events-details", own: true }, e.details) : null,
          el(
            "div",
            { class: "events-actions" },
            going,
            el("span", { class: "events-count" }, `${e.going} going`),
            cancel,
          ),
        ),
      );
    }
  }

  async function loadList() {
    const res = await askPatiently("events-list", {});
    if (!res || !res.ok) return;
    clock = { minute: res.clock, at: Date.now() };
    events = res.events || [];
    showClock();
    renderList();
  }

  async function setGoing(e, going) {
    const res = await ask("events-going", { id: e.id, going });
    if (!res) return status(NO_ANSWER, true);
    if (!res.ok) {
      status(REFUSED[res.reason] || NO_ANSWER, true);
      return loadList();
    }
    e.imGoing = res.imGoing;
    e.going = res.going;
    renderList();
  }

  async function cancelEvent(e) {
    if (!window.confirm(e.mine ? "Cancel this event?" : "Remove this event?")) return;
    const res = await ask("events-cancel", { id: e.id });
    if (!res) return status(NO_ANSWER, true);
    if (!res.ok) status(REFUSED[res.reason] || NO_ANSWER, true);
    loadList();
  }

  // ------------------------------------------------------------ the form
  let posting = false;
  async function post() {
    if (posting) return;
    const title = $("events-title").value.trim();
    if (!title) return status(REFUSED.title, true);
    const room = picker && picker.value;
    if (!room) return status(REFUSED.room, true);
    posting = true;
    $("events-post-btn").disabled = true;
    status("");
    const res = await ask("events-create", {
      title,
      room,
      day: Number($("events-day").value),
      time: `${$("events-hour").value}:${$("events-minute").value}`,
      details: $("events-details").value,
    });
    posting = false;
    $("events-post-btn").disabled = false;
    if (!res) return status(NO_ANSWER, true);
    if (!res.ok) {
      if (res.reason === "muted") {
        return status(
          res.until
            ? `Not posted: you are muted until ${RBV.cards.when(res.until)}.`
            : "Not posted: you are muted.",
          true,
        );
      }
      return status(REFUSED[res.reason] || NO_ANSWER, true);
    }
    $("events-title").value = "";
    $("events-details").value = "";
    picker.clear();
    status("Posted.", false);
    // (the list again, past the server's once-a-second pace)
    setTimeout(loadList, 1100);
  }

  // ------------------------------------------------------------ the card
  let ticking = null;
  function openCard() {
    RBV.cards.only("events-popup");
    $("events-popup").style.display = "block";
    status("");
    RBV.badges.seen("events");
    picker.setItems(roomItems());
    fillTimes();
    loadList().then(suggestTime);
    clearInterval(ticking);
    let ticks = 0;
    ticking = setInterval(() => {
      if (!cardOpen()) return clearInterval(ticking);
      showClock();
      // the list again every half minute: "On now", and the day's words
      if (++ticks % 2 === 0) loadList();
    }, 15000);
  }
  function closeCard() {
    $("events-popup").style.display = "none";
    clearInterval(ticking);
  }

  // ------------------------------------------------- the server's word
  // An event posted or taken off: the open card looks again; the number on
  // the button counts the new ones by others
  let reloading = null;
  socket.on("events-changed", (d) => {
    if (!d || typeof d !== "object") return;
    if (d.kind === "new" && d.host !== myId()) {
      if (cardOpen()) RBV.badges.seen("events");
      else RBV.badges.add("events");
    } else if (d.kind === "cancelled" && !cardOpen()) {
      // (it may have been one of those counted; asked when the pages are not
      // all asking at once)
      setTimeout(RBV.badges.refresh, 500 + Math.random() * 4000);
    }
    if (cardOpen()) {
      clearTimeout(reloading);
      reloading = setTimeout(loadList, 300 + Math.random() * 700);
    }
  });
  socket.on("event-starting", (d) => {
    if (!d || typeof d !== "object") return;
    say(`Starting now in ${roomName(d.room)}: ${d.title}`);
    if (cardOpen()) setTimeout(loadList, 1100 + Math.random() * 1000);
  });
  socket.on("event-cancelled", (d) => {
    if (!d || typeof d !== "object") return;
    say(`The event "${d.title}" has been cancelled.`);
  });

  document.addEventListener("DOMContentLoaded", () => {
    const btn = $("events-btn");
    if (!btn || !$("events-popup")) return;
    btn.addEventListener("click", () => (cardOpen() ? closeCard() : openCard()));
    const close = document.querySelector(".close-events");
    close.addEventListener("click", closeCard);
    close.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") closeCard();
    });
    picker = RBV.picker.create($("events-room"), {
      none: "No room by that name.",
      onPick: () => status(""),
    });
    $("events-post-btn").addEventListener("click", post);
    $("events-title").addEventListener("keydown", (e) => {
      if (e.key === "Enter") post();
    });
    RBV.cards.closeOnOthers("events-popup", closeCard);
    RBV.badges.watch("events", cardOpen);
  });

  RBV.events = { open: openCard, close: closeCard, refresh: loadList };
})(window.RBV);
