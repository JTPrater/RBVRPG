// Money (2026-11-25): the Money card (game.html #money-popup, the bottom
// bar's Money button) and the server's word on money sent and received.
// The server keeps every purse and checks every send (server.js
// "money-overview", "money-people", "money-send"; the rules in lib/money.js);
// this only shows them and asks.
(function (RBV) {
  const socket = RBV.socket;
  const $ = (id) => document.getElementById(id);
  const pounds = (n) => `£${(Number(n) || 0).toFixed(2)}`;

  // The server's refusals, as the page says them
  const REFUSED = {
    "no-one": "Choose a passenger.",
    amount: "Enter an amount, in pounds and pence.",
    "not-enough": "You haven't enough money for that.",
    self: "You can't send money to yourself.",
    confined: "You can't send money from here.",
    "muted-note": "You are muted: send it without a note.",
    "too-fast": "Wait a moment before sending again.",
    "too-many": "That's enough sending for now. Try again later.",
  };
  const NO_ANSWER = "The money could not be sent. Try again.";

  // An element; text goes in as text. "own": a passenger's own words (names,
  // notes), which the page's language leaves as written.
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

  // A date and time in the page's language
  function when(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const lang = (window.RBV_I18N && window.RBV_I18N.lang) || "en";
    const options = { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" };
    try {
      return d.toLocaleString(lang === "en" ? "en-GB" : lang, options);
    } catch (e) {
      return d.toLocaleString();
    }
  }

  // The server's answer to a question, or null (no connection, no answer)
  function ask(event, data) {
    return new Promise((resolve) => {
      if (!socket || !socket.connected) return resolve(null);
      socket.timeout(8000).emit(event, data, (err, res) => resolve(err ? null : res));
    });
  }

  // The purse shown everywhere: the passenger's card and this one
  function setPurse(balance) {
    if (typeof balance !== "number") return;
    if (RBV.stats) {
      RBV.stats.playerMoney = balance;
      RBV.stats.updateMoneyDisplay();
    }
    const shown = $("money-balance");
    if (shown) shown.textContent = pounds(balance);
  }
  // a line in the chat (game.js), for what happened to the purse
  function say(text) {
    if (typeof RBV.sayInChat === "function") RBV.sayInChat(text);
  }
  function status(text, bad) {
    const line = $("money-status");
    if (!line) return;
    line.textContent = text || "";
    line.classList.toggle("bad", !!bad);
  }

  // ------------------------------------------------------------ the card
  let people = [];
  const personText = (p) => (p.cabin ? `${p.name} (${p.cabin})` : p.name);

  async function loadPeople() {
    const res = await ask("money-people", {});
    if (!res || !res.ok) return;
    people = res.people;
    const select = $("money-to");
    const chosen = select.value;
    select.textContent = "";
    select.append(el("option", { value: "" }, "Choose a passenger"));
    const aboard = people.filter((p) => p.aboard);
    const others = people.filter((p) => !p.aboard);
    if (aboard.length) {
      select.append(el("option", { value: "", disabled: true }, "Aboard now"));
      aboard.forEach((p) => select.append(el("option", { value: p.id, own: true }, personText(p))));
    }
    if (others.length) {
      select.append(el("option", { value: "", disabled: true }, "Everyone else"));
      others.forEach((p) => select.append(el("option", { value: p.id, own: true }, personText(p))));
    }
    if (chosen && people.some((p) => p.id === chosen)) select.value = chosen;
  }

  async function loadOverview() {
    const res = await ask("money-overview", {});
    if (!res || !res.ok) return;
    setPurse(res.balance);
    $("money-place").textContent = `Place ${res.place} of ${res.of}`;

    const richest = $("money-richest");
    richest.textContent = "";
    const row = (place, name, amount, me) =>
      el(
        "li",
        { class: me ? "me" : null },
        el("span", { class: "money-rank" }, `${place}.`),
        name,
        el("span", { class: "money-amount" }, pounds(amount)),
      );
    for (const r of res.richest) {
      richest.append(row(r.place, el("span", { class: "money-name", own: true }, personText(r)), r.amount, r.me));
    }
    // one's own place, when it is not among the ten
    if (!res.richest.some((r) => r.me)) {
      richest.append(row(res.place, el("span", { class: "money-name" }, "You"), res.balance, true));
    }

    const recent = $("money-recent");
    recent.textContent = "";
    if (!res.recent.length) recent.append(el("li", { class: "money-empty" }, "Nothing yet."));
    for (const t of res.recent) {
      recent.append(
        el(
          "li",
          null,
          el("span", { class: "money-when" }, when(t.at)),
          el(
            "span",
            { class: "money-who" },
            el("span", null, t.out ? "To" : "From"),
            " ",
            el("span", { own: true }, t.other),
          ),
          el("span", { class: `money-amount ${t.out ? "out" : "in"}` }, `${t.out ? "−" : "+"}${pounds(t.amount)}`),
          t.note ? el("span", { class: "money-note", own: true }, t.note) : null,
        ),
      );
    }
  }

  let sending = false;
  async function send() {
    if (sending) return;
    const to = $("money-to").value;
    const amountText = $("money-amount").value.trim();
    const note = $("money-note").value.trim();
    if (!to) return status(REFUSED["no-one"], true);
    const amount = Number(amountText);
    if (!amountText || !Number.isFinite(amount) || amount < 0.01) return status(REFUSED.amount, true);
    const person = people.find((p) => p.id === to);
    if (!window.confirm(`Send ${pounds(amount)} to ${person ? person.name : "this passenger"}?`)) return;
    sending = true;
    $("money-send-btn").disabled = true;
    status("");
    const res = await ask("money-send", { to, amount: amountText, note });
    sending = false;
    $("money-send-btn").disabled = false;
    if (!res) return status(NO_ANSWER, true);
    if (!res.ok) return status(REFUSED[res.reason] || NO_ANSWER, true);
    setPurse(res.balance);
    $("money-amount").value = "";
    $("money-note").value = "";
    const line = `You sent ${pounds(res.amount)} to ${res.to}.`;
    status(line, false);
    say(line);
    // (the figures again, past the server's once-a-second pace)
    setTimeout(loadOverview, 1100);
  }

  const cardOpen = () => $("money-popup").style.display === "block";
  function openCard() {
    ["settings-popup", "rules-popup", "deckplans-popup"].forEach((id) => {
      const card = $(id);
      if (card) card.style.display = "none";
    });
    $("money-popup").style.display = "block";
    status("");
    loadPeople();
    loadOverview();
  }
  function closeCard() {
    $("money-popup").style.display = "none";
  }

  // ------------------------------------------------- the server's word
  // Money received (the purse and a line in the chat), and the purse after a
  // send from another tab of the same passenger
  socket.on("money-received", (d) => {
    if (!d || typeof d !== "object") return;
    setPurse(d.balance);
    say(
      d.note
        ? `${d.from} sent you ${pounds(d.amount)} with a note: ${d.note}`
        : `${d.from} sent you ${pounds(d.amount)}.`,
    );
    if (cardOpen()) setTimeout(loadOverview, 1100);
  });
  socket.on("money-balance", (d) => {
    if (d && typeof d === "object") setPurse(d.balance);
  });

  document.addEventListener("DOMContentLoaded", () => {
    const btn = $("money-btn");
    if (!btn || !$("money-popup")) return;
    btn.addEventListener("click", () => (cardOpen() ? closeCard() : openCard()));
    const close = document.querySelector(".close-money");
    close.addEventListener("click", closeCard);
    close.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") closeCard();
    });
    $("money-send-btn").addEventListener("click", send);
    ["money-amount", "money-note"].forEach((id) =>
      $(id).addEventListener("keydown", (e) => {
        if (e.key === "Enter") send();
      }),
    );
    // another card opened puts this one away
    ["settings-btn", "rules-btn", "deckplans-btn"].forEach((id) => {
      const other = $(id);
      if (other) other.addEventListener("click", closeCard);
    });
    // the dates are written in the page's language: again when it changes
    document.addEventListener("rbv:language", () => {
      if (cardOpen()) loadOverview();
    });
  });

  RBV.money = { open: openCard, close: closeCard, refresh: loadOverview };
})(window.RBV);
