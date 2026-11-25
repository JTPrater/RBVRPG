// public/js/moderation.js: the moderation panel (/moderation). The server
// (server.js /api/mod/*) checks every action against the rules in
// lib/moderation.js; this page lists the passengers, where they are and any
// mute, ban or confinement, and offers what this moderator may do to the one
// chosen. It looks again every 15 seconds while it is in view.
//
// Players' and moderators' own words (names, reasons, emails) are marked
// data-no-i18n: the page's language never touches them.
(function () {
  const state = {
    me: null,
    players: [],
    selected: null,
    filter: "all",
    query: "",
    log: [],
    playerLog: [],
    playerMoney: [], // the passenger's money sent and received
    busy: false,
    note: null, // { text, error } under the actions
    newPassword: null, // { id, password }: shown once
  };

  const $ = (id) => document.getElementById(id);

  // An element; text goes in as text, never as markup. "own" marks a
  // player's or moderator's own words (left in the language they wrote).
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value == null || value === false) continue;
      if (key === "own") node.setAttribute("data-no-i18n", "");
      else if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value === true ? "" : value);
    }
    for (const child of children) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  const ROLE = { owner: "Owner", admin: "Admin" };
  const PLACE = { padded_room: "Padded room", hell: "Hell" };
  const DURATIONS = [
    [10, "10 minutes"],
    [60, "1 hour"],
    [360, "6 hours"],
    [1440, "1 day"],
    [10080, "1 week"],
    [43200, "30 days"],
    ["", "No end"],
  ];
  const ACTION_LABEL = {
    mute: "Muted",
    unmute: "Unmuted",
    ban: "Banned",
    unban: "Unbanned",
    padded: "Sent to the padded room",
    hell: "Sent to hell",
    release: "Released",
    "make-admin": "Made an admin",
    "remove-admin": "No longer an admin",
    "reset-password": "Given a new password",
    // (an event the passenger posted, taken off: the title is in "reason")
    "remove-event": "Event removed",
  };
  const NEEDS_REASON = new Set(["ban", "padded", "hell"]);
  const TIMED = new Set(["mute", "ban"]);
  const CONFIRM = {
    ban: "Ban this passenger?",
    hell: "Send this passenger to hell? Only the owner can let them out.",
    "make-admin": "Make this passenger an admin?",
    "remove-admin": "Take this passenger's admin rights away?",
    "reset-password":
      "Give this passenger a new password? Their old one stops working at once.",
  };

  // A date in the page's language: "25 November, 14:00"
  function when(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    const lang = (window.RBV_I18N && window.RBV_I18N.lang) || "en";
    const options = { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" };
    try {
      return d.toLocaleString(lang === "en" ? "en-GB" : lang, options);
    } catch (e) {
      return d.toLocaleString();
    }
  }

  // A room's name from its id: the deck plans' rooms, the padded room and hell
  const roomNames = (() => {
    const names = { padded_room: "Padded Room", hell: "Hell" };
    for (const list of Object.values(window.deckRooms || {})) {
      if (!Array.isArray(list)) continue;
      for (const r of list) {
        if (!r || !r.name) continue;
        if (r.id && !names[r.id]) names[r.id] = r.name;
        const chat = r.location && r.location.chatRoom;
        if (chat && !names[chat]) names[chat] = r.name;
      }
    }
    return names;
  })();
  function roomName(id) {
    if (!id) return "";
    if (roomNames[id]) return roomNames[id];
    const cabin = /^cabin_([a-z])(\d+)$/.exec(id);
    return cabin ? `Cabin ${cabin[1].toUpperCase()}${cabin[2]}` : id;
  }

  async function api(path, options = {}) {
    let res = null;
    let body = null;
    try {
      res = await fetch(path, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...options,
      });
      body = await res.json().catch(() => null);
    } catch (e) {}
    return { status: res ? res.status : 0, body };
  }

  function pageError(text) {
    const box = $("mod-page-error");
    box.textContent = text || "";
    box.hidden = !text;
  }

  // ------------------------------------------------------------- the list
  const lower = (s) => String(s || "").toLowerCase();
  function matches(p) {
    const f = state.filter;
    if (f === "aboard" && !p.online) return false;
    if (f === "muted" && !p.mute) return false;
    if (f === "banned" && !p.ban) return false;
    if (f === "locked" && !p.confinement) return false;
    if (f === "staff" && !p.role) return false;
    if (f === "flagged" && !p.flag) return false;
    const q = lower(state.query).trim();
    if (!q) return true;
    return [p.name, p.cabin, p.email].some((v) => lower(v).includes(q));
  }

  // a passenger's standing as tags; withFlag: and whether they may be a
  // second account (by the same browser, in red; by the network only, in grey)
  function tagsOf(p, withFlag = true) {
    const tags = [];
    if (p.role) tags.push([ROLE[p.role], "role"]);
    if (p.confinement) tags.push([PLACE[p.confinement.place], p.confinement.place]);
    if (p.ban) tags.push(["Banned", "ban"]);
    if (p.mute) tags.push(["Muted", "mute"]);
    if (withFlag && p.flag) {
      tags.push(["Possible second account", p.flag.kind === "browser" ? "flag" : "flag weak"]);
    }
    return tags;
  }

  function renderList() {
    const list = $("mod-players");
    list.textContent = "";
    const shown = state.players
      .filter(matches)
      .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
    $("mod-count").textContent = `${shown.length} passenger${shown.length === 1 ? "" : "s"}`;
    for (const p of shown) {
      const where = p.online
        ? el("span", { class: "mod-where on" }, p.room ? roomName(p.room) : "Aboard")
        : el("span", { class: "mod-where" }, "Not aboard");
      const tags = el(
        "span",
        { class: "mod-tags" },
        ...tagsOf(p).map(([text, kind]) => el("span", { class: `mod-tag ${kind}` }, text)),
      );
      const button = el(
        "button",
        {
          type: "button",
          class: "mod-player",
          "aria-current": p.id === state.selected ? "true" : null,
        },
        el("img", { class: "mod-avatar", src: p.avatar || "/images/default-avatar.svg", alt: "" }),
        el(
          "span",
          { class: "mod-player-text" },
          el("span", { class: "mod-name", own: true }, p.name),
          el("span", { class: "mod-line" }, el("span", { own: true }, p.cabin), " · ", where),
          tags,
        ),
      );
      button.addEventListener("click", () => select(p.id));
      list.append(el("li", null, button));
    }
  }

  // ------------------------------------------------------ one passenger
  function select(id) {
    if (state.selected !== id) {
      state.note = null;
      state.newPassword = null;
      state.playerLog = [];
      state.playerMoney = [];
    }
    state.selected = id;
    renderList();
    renderDetail(false);
    loadPlayerLog();
  }

  function standing(title, kind, rows) {
    return el(
      "div",
      { class: `mod-standing ${kind}` },
      el("h3", null, title),
      el(
        "dl",
        null,
        ...rows
          .filter(([, value]) => value)
          .flatMap(([label, value, own]) => [
            el("dt", null, label),
            el("dd", { own: !!own }, value),
          ]),
      ),
    );
  }

  // Why this moderator can do nothing to the passenger (null: they can)
  function whyNot(p) {
    const me = state.me;
    if (!me) return "Only moderators can do that.";
    if (p.id === me.id) return "This is you.";
    if (p.role === "owner") return "Nobody can do that to the owner.";
    if (p.role === "admin" && me.role !== "owner") return "Only the owner can do that to an admin.";
    return null;
  }

  function actionsFor(p) {
    const owner = state.me && state.me.role === "owner";
    const place = p.confinement && p.confinement.place;
    const out = [["mute", "Mute"]];
    if (p.mute) out.push(["unmute", "Unmute"]);
    out.push(["ban", "Ban"]);
    if (p.ban) out.push(["unban", "Unban"]);
    if (place !== "padded_room" && (place !== "hell" || owner)) {
      out.push(["padded", "Send to the padded room"]);
    }
    if (place !== "hell") out.push(["hell", "Send to hell"]);
    if (place && (place !== "hell" || owner)) out.push(["release", "Let out"]);
    if (owner) {
      out.push(p.role === "admin" ? ["remove-admin", "Remove admin"] : ["make-admin", "Make admin"]);
      out.push(["reset-password", "New password"]);
    }
    return out;
  }

  // The passenger's card. Its reason box and time list are made once for each
  // passenger chosen; a look again (every 15 s, or after the log comes)
  // redraws the rest around them (keepForm), so what the moderator is
  // writing is never lost or interrupted.
  function renderDetail(keepForm) {
    const box = $("mod-detail");
    const p = state.players.find((x) => x.id === state.selected);
    if (!p) {
      box.textContent = "";
      box.append(el("p", { class: "mod-empty" }, "Choose a passenger."));
      return;
    }
    let card = box.firstElementChild;
    if (!keepForm || !card || card.dataset.player !== p.id) {
      box.textContent = "";
      card = el(
        "div",
        { "data-player": p.id },
        el("div", { class: "mod-info" }),
        formFor(p),
        el("div", { class: "mod-feedback" }),
        el("div", { class: "mod-plog" }),
      );
      box.append(card);
    }
    fillInfo(card.querySelector(".mod-info"), p);
    fillActions(card, p);
    fillFeedback(card.querySelector(".mod-feedback"), p);
    const plog = card.querySelector(".mod-plog");
    plog.textContent = "";
    plog.append(el("h3", { class: "mod-sub" }, "This passenger's log"), logTable(state.playerLog, false));
    plog.append(el("h3", { class: "mod-sub" }, "Money sent and received"), moneyTable(state.playerMoney));
  }

  // the reason box, the time list, and a place for the buttons
  function formFor(p) {
    const reason = el("input", {
      type: "text",
      id: "mod-reason",
      maxlength: "300",
      placeholder: "Why (the passenger is told)",
      autocomplete: "off",
    });
    const minutes = el(
      "select",
      { id: "mod-minutes" },
      ...DURATIONS.map(([value, label]) => el("option", { value: String(value) }, label)),
    );
    minutes.value = "60";
    return el(
      "div",
      { class: "mod-form-area" },
      el(
        "div",
        { class: "mod-form" },
        el("div", { class: "mod-field" }, el("label", { for: "mod-reason" }, "Reason"), reason),
        el(
          "div",
          { class: "mod-field short" },
          el("label", { for: "mod-minutes" }, "For how long (mute, ban)"),
          minutes,
        ),
      ),
      el("div", { class: "mod-actions" }),
      el("p", { class: "mod-note mod-hell-note", hidden: true }, "Only the owner can let a player out of hell."),
    );
  }

  function fillActions(card, p) {
    const area = card.querySelector(".mod-form-area");
    const refusal = whyNot(p);
    area.hidden = !!refusal;
    let note = card.querySelector(".mod-refusal");
    if (refusal) {
      if (!note) {
        note = el("p", { class: "mod-note mod-refusal" });
        area.before(note);
      }
      note.textContent = refusal;
      return;
    }
    if (note) note.remove();
    const row = area.querySelector(".mod-actions");
    row.textContent = "";
    for (const [action, label] of actionsFor(p)) {
      const b = el(
        "button",
        { type: "button", class: `btn mod-act ${action}`, "data-action": action, disabled: state.busy },
        label,
      );
      b.addEventListener("click", () => act(p, action));
      row.append(b);
    }
    area.querySelector(".mod-hell-note").hidden = !(
      p.confinement &&
      p.confinement.place === "hell" &&
      state.me.role !== "owner"
    );
  }

  function fillFeedback(box, p) {
    box.textContent = "";
    if (state.note) {
      box.append(
        el("p", { class: state.note.error ? "form-error" : "mod-done", role: "status" }, state.note.text),
      );
    }
    if (state.newPassword && state.newPassword.id === p.id) {
      box.append(
        el(
          "div",
          { class: "mod-password" },
          el("p", null, "New password:"),
          el("code", { own: true }, state.newPassword.password),
          el("p", { class: "mod-note" }, "Give it to the passenger yourself. It is not shown again."),
        ),
      );
    }
  }

  function fillInfo(box, p) {
    box.textContent = "";
    box.append(
      el(
        "div",
        { class: "mod-card-head" },
        el("img", { class: "mod-avatar big", src: p.avatar || "/images/default-avatar.svg", alt: "" }),
        el(
          "div",
          null,
          el("h2", { own: true }, p.name),
          el("p", { class: "mod-line" }, p.cabin ? `Cabin ${p.cabin}` : ""),
          typeof p.money === "number"
            ? el("p", { class: "mod-line" }, el("span", null, "Money"), " ", el("span", { class: "mod-money" }, `£${p.money.toFixed(2)}`))
            : null,
          p.email ? el("p", { class: "mod-line", own: true }, p.email) : null,
          el(
            "p",
            { class: "mod-line" },
            p.online
              ? el("span", { class: "mod-where on" }, p.room ? roomName(p.room) : "Aboard")
              : el("span", { class: "mod-where" }, "Not aboard"),
          ),
          p.role ? el("p", { class: "mod-tags" }, el("span", { class: "mod-tag role" }, ROLE[p.role])) : null,
        ),
      ),
    );

    const blocks = [];
    if (p.confinement) {
      blocks.push(
        standing(PLACE[p.confinement.place], p.confinement.place, [
          ["Since", when(p.confinement.at)],
          ["By", p.confinement.by, true],
          ["Reason", p.confinement.reason, true],
        ]),
      );
    }
    if (p.ban) {
      blocks.push(
        standing("Banned", "ban", [
          ["Until", p.ban.until ? when(p.ban.until) : "No end"],
          ["By", p.ban.by, true],
          ["Reason", p.ban.reason, true],
        ]),
      );
    }
    if (p.mute) {
      blocks.push(
        standing("Muted", "mute", [
          ["Until", p.mute.until ? when(p.mute.until) : "No end"],
          ["By", p.mute.by, true],
          ["Reason", p.mute.reason, true],
        ]),
      );
    }
    if (blocks.length) box.append(el("div", { class: "mod-standings" }, ...blocks));
    const linked = linkedBlock(p);
    if (linked) box.append(linked);
  }

  // The accounts seen with this one's browser or network (server.js
  // recordSeen), each with its own standing, and whether that flags this one
  function linkedBlock(p) {
    const links = p.links || { browser: [], network: [] };
    if (!links.browser.length && !links.network.length) return null;
    const names = (ids) =>
      el(
        "dd",
        null,
        ...ids
          .map((id) => state.players.find((x) => x.id === id))
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((other) => {
            const link = el("button", { type: "button", class: "mod-link", own: true }, other.name);
            link.addEventListener("click", () => select(other.id));
            return el(
              "span",
              { class: "mod-linked" },
              link,
              ...tagsOf(other, false).map(([text, kind]) => el("span", { class: `mod-tag ${kind}` }, text)),
            );
          }),
      );
    return el(
      "div",
      { class: `mod-links${p.flag ? ` flagged ${p.flag.kind}` : ""}` },
      el("h3", null, "Linked accounts"),
      p.flag
        ? el(
            "p",
            { class: "mod-flag-note" },
            "Possibly a second account of a passenger who is banned, locked in or muted.",
          )
        : null,
      el(
        "dl",
        null,
        ...(links.browser.length ? [el("dt", null, "Same browser"), names(links.browser)] : []),
        ...(links.network.length ? [el("dt", null, "Same network"), names(links.network)] : []),
      ),
      links.network.length
        ? el("p", { class: "mod-note" }, "A shared network can be a family, a school or a café.")
        : null,
    );
  }

  async function act(p, action) {
    if (state.busy) return;
    const reasonBox = $("mod-reason");
    const reason = reasonBox ? reasonBox.value.trim() : "";
    const minutes = $("mod-minutes") ? $("mod-minutes").value : "";
    if (NEEDS_REASON.has(action) && !reason) {
      state.note = { text: "Write a reason.", error: true };
      renderDetail(true);
      if ($("mod-reason")) $("mod-reason").focus();
      return;
    }
    if (CONFIRM[action] && !window.confirm(CONFIRM[action])) return;
    state.busy = true;
    state.note = null;
    renderDetail(true);
    const payload = { player: p.id, action, reason };
    if (TIMED.has(action)) payload.minutes = minutes === "" ? null : Number(minutes);
    const { body } = await api("/api/mod/action", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    state.busy = false;
    if (body && body.ok) {
      const i = state.players.findIndex((x) => x.id === body.player.id);
      if (i >= 0) state.players[i] = body.player;
      state.note = { text: "Done.", error: false };
      state.newPassword = body.newPassword ? { id: p.id, password: body.newPassword } : null;
      if ($("mod-reason")) $("mod-reason").value = "";
      renderList();
      renderDetail(false);
      // the whole list again: a ban or a lock-in flags the accounts linked
      // to this one (and lifting it unflags them)
      refresh();
      loadLog();
      loadPlayerLog();
    } else {
      state.note = {
        text: (body && body.error) || "That did not work. Try again.",
        error: true,
      };
      renderDetail(true);
      if (body && /changed this passenger/.test(body.error || "")) refresh();
    }
  }

  // ------------------------------------------------------------- the log
  function logTable(entries, withPassenger = true) {
    if (!entries.length) return el("p", { class: "mod-empty" }, "Nothing yet.");
    return el(
      "div",
      { class: "mod-log-scroll" },
      el(
        "table",
        { class: "mod-log-table" },
        el(
          "thead",
          null,
          el(
            "tr",
            null,
            el("th", { scope: "col" }, "When"),
            el("th", { scope: "col" }, "Moderator"),
            el("th", { scope: "col" }, "Action"),
            withPassenger ? el("th", { scope: "col" }, "Passenger") : null,
            el("th", { scope: "col" }, "Until"),
            el("th", { scope: "col" }, "Reason"),
          ),
        ),
        el("tbody", null, ...entries.map((e) => logRow(e, withPassenger))),
      ),
    );
  }
  function logRow(e, withPassenger = true) {
    const target = el("td", null);
    if (withPassenger) {
      const link = el("button", { type: "button", class: "mod-link", own: true }, e.target);
      link.addEventListener("click", () => {
        if (state.players.some((p) => p.id === e.targetId)) select(e.targetId);
      });
      target.append(link);
    }
    return el(
      "tr",
      null,
      el("td", null, when(e.at)),
      el("td", { own: true }, e.actor),
      el("td", null, ACTION_LABEL[e.action] || e.action),
      withPassenger ? target : null,
      el("td", null, e.until ? when(e.until) : ""),
      el("td", { own: true }, e.reason),
    );
  }
  function renderLog() {
    const body = $("mod-log");
    body.textContent = "";
    for (const e of state.log) body.append(logRow(e));
    $("mod-log-empty").hidden = state.log.length > 0;
    body.closest("table").hidden = !state.log.length;
  }

  async function loadLog() {
    const { body } = await api("/api/mod/log");
    if (body && body.ok) {
      state.log = body.entries;
      renderLog();
    }
  }
  async function loadPlayerLog() {
    const id = state.selected;
    if (!id) return;
    const [{ body }, money] = await Promise.all([
      api(`/api/mod/log?player=${encodeURIComponent(id)}`),
      api(`/api/mod/transfers?player=${encodeURIComponent(id)}`),
    ]);
    if (state.selected !== id) return;
    if (body && body.ok) state.playerLog = body.entries;
    if (money.body && money.body.ok) state.playerMoney = money.body.transfers;
    renderDetail(true);
  }

  // The passenger's money sent and received (where a purse's money came
  // from: a player's second accounts emptying theirs into it show here)
  function moneyTable(list) {
    if (!list.length) return el("p", { class: "mod-empty" }, "Nothing yet.");
    return el(
      "div",
      { class: "mod-log-scroll" },
      el(
        "table",
        { class: "mod-log-table" },
        el(
          "thead",
          null,
          el(
            "tr",
            null,
            el("th", { scope: "col" }, "When"),
            el("th", { scope: "col" }, "Sent or received"),
            el("th", { scope: "col" }, "Passenger"),
            el("th", { scope: "col" }, "Amount"),
            el("th", { scope: "col" }, "Note"),
          ),
        ),
        el(
          "tbody",
          null,
          ...list.map((t) => {
            const who = el("button", { type: "button", class: "mod-link", own: true }, t.other);
            who.addEventListener("click", () => {
              if (state.players.some((x) => x.id === t.otherId)) select(t.otherId);
            });
            return el(
              "tr",
              null,
              el("td", null, when(t.at)),
              el("td", null, t.out ? "Sent" : "Received"),
              el("td", null, who),
              el("td", { class: "mod-money" }, `${t.out ? "−" : "+"}£${t.amount.toFixed(2)}`),
              el("td", { own: true }, t.note),
            );
          }),
        ),
      ),
    );
  }

  // --------------------------------------------------------- looking again
  async function refresh() {
    const { status, body } = await api("/api/mod/players");
    if (status === 403 || status === 401) {
      // no longer a moderator (or logged out)
      window.location.href = "/";
      return;
    }
    if (!body || !body.ok) {
      pageError("The ship could not be reached. Check your connection and try again.");
      return;
    }
    pageError("");
    state.me = body.me;
    state.players = body.players;
    $("mod-me").textContent = body.me.name;
    $("mod-role").textContent = ROLE[body.me.role] || "";
    $("mod-who").hidden = false;
    renderList();
    renderDetail(true);
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("mod-search").addEventListener("input", (e) => {
      state.query = e.target.value;
      renderList();
    });
    document.querySelectorAll(".mod-filters button").forEach((b) => {
      b.addEventListener("click", () => {
        state.filter = b.dataset.filter;
        document
          .querySelectorAll(".mod-filters button")
          .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderList();
      });
    });
    // dates are written in the page's language: again when it changes
    document.addEventListener("rbv:language", () => {
      renderList();
      renderDetail(true);
      renderLog();
    });
    refresh();
    loadLog();
    setInterval(() => {
      if (document.visibilityState !== "visible" || state.busy) return;
      refresh();
      loadLog();
    }, 15000);
  });
})();
