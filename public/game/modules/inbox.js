// Inbox (2026-11-25): messages between passengers. The bottom bar's Inbox
// button opens the card (game.html #inbox-popup): the passengers written
// with on the left, newest first, with their unread; the thread with one of
// them on the right, and a box to write in. A new message starts by typing a
// name (modules/picker.js). The server keeps the messages and checks every
// one (server.js "inbox-list", "inbox-thread", "inbox-send"; the rules in
// lib/inbox.js); the number on the button counts the unread
// (modules/badges.js).
(function (RBV) {
  const socket = RBV.socket;
  const $ = (id) => document.getElementById(id);
  const when = (iso) => RBV.cards.when(iso);

  // The server's refusals, as the page says them
  const REFUSED = {
    "no-one": "This passenger can't receive messages.",
    empty: "Write something first.",
    "too-long": "That message is too long.",
    self: "You can't write to yourself.",
    confined: "You can't send messages from here.",
    "too-fast": "Wait a moment before sending again.",
    "too-many": "That's enough messages for now. Try again later.",
  };
  const NO_ANSWER = "The message could not be sent. Try again.";

  // An element; text goes in as text. "own": a passenger's own words (names,
  // messages), which the page's language leaves as written.
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

  // The server's answer to a question, or null (no connection, no answer)
  function ask(event, data) {
    return new Promise((resolve) => {
      if (!socket || !socket.connected) return resolve(null);
      socket.timeout(8000).emit(event, data, (err, res) => resolve(err ? null : res));
    });
  }
  // asked again once, a moment later, if asked too soon
  async function askPatiently(event, data) {
    const res = await ask(event, data);
    if (res && !res.ok && res.reason === "too-fast") {
      await new Promise((r) => setTimeout(r, 1500));
      return ask(event, data);
    }
    return res;
  }

  function say(text) {
    if (typeof RBV.sayInChat === "function") RBV.sayInChat(text);
  }
  function status(text, bad) {
    const line = $("inbox-status");
    if (!line) return;
    line.textContent = text || "";
    line.classList.toggle("bad", !!bad);
  }

  // ------------------------------------------------------------ the card
  let threads = [];
  let current = null; // { id, name, aboard, canWrite }: the thread open
  let messages = [];
  let picker = null;

  const cardOpen = () => $("inbox-popup").style.display === "block";

  function renderThreads() {
    const list = $("inbox-threads");
    list.textContent = "";
    if (!threads.length) {
      list.append(el("li", { class: "inbox-empty" }, "No messages yet."));
      return;
    }
    for (const t of threads) {
      const open = current && current.id === t.id;
      const button = el(
        "button",
        { type: "button", class: "inbox-thread-btn", "aria-current": open ? "true" : null },
        el(
          "span",
          { class: "inbox-thread-top" },
          el("span", { class: "inbox-thread-name", own: true }, t.name),
          t.unread ? el("span", { class: "inbox-unread" }, t.unread > 99 ? "99+" : String(t.unread)) : null,
        ),
        el(
          "span",
          { class: "inbox-thread-last" },
          t.out ? el("span", null, "You") : null,
          t.out ? ": " : null,
          el("span", { own: true }, t.text.replace(/\s+/g, " ")),
        ),
        el("span", { class: "inbox-thread-when" }, when(t.at)),
      );
      button.addEventListener("click", () => openThread(t.id, t.name));
      list.append(el("li", { class: t.unread ? "unread" : null }, button));
    }
  }

  async function loadThreads() {
    const res = await askPatiently("inbox-list", {});
    if (!res || !res.ok) return;
    threads = res.threads || [];
    renderThreads();
  }

  function renderThread() {
    const head = $("inbox-head");
    const box = $("inbox-thread");
    const write = $("inbox-write");
    box.textContent = "";
    if (!current) {
      head.hidden = true;
      write.hidden = true;
      return;
    }
    head.hidden = false;
    $("inbox-with").textContent = current.name;
    $("inbox-aboard").hidden = !current.aboard;
    write.hidden = !current.canWrite;
    if (!messages.length) {
      box.append(el("li", { class: "inbox-empty" }, "No messages yet."));
    }
    // "Read" under the last of one's own, once the other has opened it
    let lastOut = -1;
    messages.forEach((m, i) => {
      if (m.out) lastOut = i;
    });
    messages.forEach((m, i) => {
      box.append(
        el(
          "li",
          { class: `inbox-msg ${m.out ? "out" : "in"}` },
          el("span", { class: "inbox-msg-when" }, when(m.at)),
          el("span", { class: "inbox-msg-text", own: true }, m.text),
          i === lastOut && m.read ? el("span", { class: "inbox-msg-read" }, "Read") : null,
        ),
      );
    });
    box.scrollTop = box.scrollHeight;
    if (!current.canWrite) status(REFUSED["no-one"], true);
  }

  let threadAsk = 0;
  async function openThread(id, name, { focus = false } = {}) {
    const changed = !current || current.id !== id;
    if (changed) {
      current = { id, name: name || "", aboard: false, canWrite: true };
      messages = [];
      status("");
      $("inbox-text").value = "";
      renderThread();
    }
    renderThreads();
    const mine = ++threadAsk;
    const res = await askPatiently("inbox-thread", { with: id });
    if (mine !== threadAsk || !current || current.id !== id) return; // another opened since
    if (!res) return status(NO_ANSWER, true);
    if (!res.ok) {
      if (res.reason === "no-one") {
        current.canWrite = false;
        renderThread();
      }
      return;
    }
    current = res.with;
    messages = res.messages || [];
    // its unread are read now (the server sends the new number on the
    // button; asked again a moment later, in case that crossed a message)
    const listed = threads.find((t) => t.id === id);
    if (listed) listed.unread = 0;
    if (res.marked) setTimeout(RBV.badges.refresh, 1500);
    renderThread();
    renderThreads();
    if (focus && current.canWrite) $("inbox-text").focus();
  }

  // a new message: the name typed, then the thread with them (none shown
  // until then)
  async function newMessage() {
    current = null;
    messages = [];
    threadAsk++;
    status("");
    renderThread();
    renderThreads();
    $("inbox-to-row").hidden = false;
    picker.clear();
    $("inbox-to").focus();
    const people = await RBV.picker.people();
    picker.setItems(people.map(RBV.picker.personItem));
  }

  let sending = false;
  async function send() {
    if (sending) return;
    if (!current) return status("Choose a passenger.", true);
    const text = $("inbox-text").value;
    if (!text.trim()) return status(REFUSED.empty, true);
    sending = true;
    $("inbox-send-btn").disabled = true;
    status("");
    const to = current.id;
    const res = await ask("inbox-send", { to, text });
    sending = false;
    $("inbox-send-btn").disabled = false;
    if (!res) return status(NO_ANSWER, true);
    if (!res.ok) {
      if (res.reason === "muted") {
        return status(
          res.until ? `Not sent: you are muted until ${when(res.until)}.` : "Not sent: you are muted.",
          true,
        );
      }
      if (res.reason === "no-one" && current && current.id === to) {
        current.canWrite = false;
        renderThread();
        return;
      }
      return status(REFUSED[res.reason] || NO_ANSWER, true);
    }
    $("inbox-text").value = "";
    $("inbox-to-row").hidden = true;
    if (current && current.id === to) {
      messages.push(res.message);
      renderThread();
    }
    loadThreads();
  }

  function openCard() {
    RBV.cards.only("inbox-popup");
    $("inbox-popup").style.display = "block";
    status("");
    loadThreads().then(() => {
      // the thread open before, or the newest with something unread
      if (current) return openThread(current.id, current.name);
      const unread = threads.find((t) => t.unread);
      if (unread) openThread(unread.id, unread.name);
      else if (!threads.length) newMessage();
    });
  }
  function closeCard() {
    $("inbox-popup").style.display = "none";
  }

  // ------------------------------------------------- the server's word
  // A message to this passenger: in the open thread at once (and read), or
  // a line in the chat; the number on the button comes from the server
  socket.on("inbox-message", (d) => {
    if (!d || typeof d !== "object" || !d.from || !d.message) return;
    if (cardOpen()) {
      if (current && current.id === d.from.id) openThread(d.from.id, d.from.name);
      else loadThreads();
    }
    if (!cardOpen() || !current || current.id !== d.from.id) {
      say(`New message from ${d.from.name}.`);
    }
  });
  // one sent from another page of the same passenger
  socket.on("inbox-sent", (d) => {
    if (!d || typeof d !== "object" || !d.to || !d.message) return;
    if (!cardOpen()) return;
    if (current && current.id === d.to.id && !messages.some((m) => m.id === d.message.id)) {
      messages.push(d.message);
      renderThread();
    }
    loadThreads();
  });
  // the other has opened the thread: one's own are read
  socket.on("inbox-read", (d) => {
    if (!d || !current || current.id !== d.by) return;
    let changed = false;
    messages.forEach((m) => {
      if (m.out && !m.read) {
        m.read = true;
        changed = true;
      }
    });
    if (changed && cardOpen()) renderThread();
  });

  document.addEventListener("DOMContentLoaded", () => {
    const btn = $("inbox-btn");
    if (!btn || !$("inbox-popup")) return;
    btn.addEventListener("click", () => (cardOpen() ? closeCard() : openCard()));
    const close = document.querySelector(".close-inbox");
    close.addEventListener("click", closeCard);
    close.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") closeCard();
    });
    picker = RBV.picker.create($("inbox-to"), {
      own: true,
      none: "No passenger by that name.",
      onPick: (item) => openThread(item.id, item.label, { focus: true }),
    });
    $("inbox-new-btn").addEventListener("click", newMessage);
    $("inbox-send-btn").addEventListener("click", send);
    // Enter sends; Shift and Enter starts a new line
    $("inbox-text").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        send();
      }
    });
    RBV.cards.closeOnOthers("inbox-popup", closeCard);
    // the dates are written in the page's language: again when it changes
    document.addEventListener("rbv:language", () => {
      if (!cardOpen()) return;
      renderThreads();
      renderThread();
    });
  });

  RBV.inbox = { open: openCard, close: closeCard, write: (id, name) => {
    openCard();
    openThread(id, name, { focus: true });
  } };
})(window.RBV);
