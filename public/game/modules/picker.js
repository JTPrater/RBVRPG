// Type to choose (2026-11-25): a text box that offers what matches as one
// types, in place of a long list to scroll. Passengers by name or cabin (the
// Money and Inbox cards), rooms by name or deck (the Events card). And the
// bottom bar's cards, one open at a time.
(function (RBV) {
  const socket = RBV.socket;

  // letters compared without case or accents: "zoe" finds "Zoë"
  const fold = (s) =>
    String(s == null ? "" : s)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();
  // the game's words in the page's language (js/i18n.js)
  const tr = (s) => {
    const i18n = window.RBV_I18N;
    return i18n && typeof i18n.tr === "function" ? i18n.tr(s) : s;
  };

  let made = 0;

  // A text box (inside a .pick box, which holds the list under it) offering
  // items { id, label, sub, tag } as one types: the best matches first, the
  // arrow keys and Enter to choose, or the mouse. own: the labels are the
  // passengers' own words (names), which the page's language leaves as
  // written; otherwise they are the game's (rooms), shown and found in the
  // page's language too.
  function create(input, options) {
    const o = Object.assign({ max: 8, own: false, none: "Nothing by that name.", onPick: null }, options);
    const listId = `pick-list-${++made}`;
    const list = document.createElement("ul");
    list.className = "pick-list";
    list.id = listId;
    list.setAttribute("role", "listbox");
    list.hidden = true;
    input.parentNode.append(list);
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", listId);
    input.setAttribute("autocomplete", "off");
    input.spellcheck = false;

    let items = [];
    let shown = [];
    let active = -1;
    let picked = null;

    const textOf = (item) => (o.own ? item.label : tr(item.label));
    const keyOf = (item) =>
      fold([item.label, item.sub, o.own ? "" : tr(item.label), item.sub ? tr(item.sub) : ""].join(" "));

    // the best matches for what is typed: every word of it found, those
    // starting with it first, then those with a word starting with it
    function matches(query) {
      const q = fold(query).trim();
      const words = q.split(/\s+/).filter(Boolean);
      if (!words.length) return items.slice(0, o.max);
      const found = [];
      items.forEach((item, i) => {
        const key = keyOf(item);
        if (!words.every((w) => key.includes(w))) return;
        const label = fold(textOf(item));
        const rank = label.startsWith(q) ? 0 : ` ${key}`.includes(` ${words[0]}`) ? 1 : 2;
        found.push([rank, i, item]);
      });
      found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      return found.slice(0, o.max).map((f) => f[2]);
    }

    function setOpen(open) {
      list.hidden = !open;
      input.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open) {
        active = -1;
        input.removeAttribute("aria-activedescendant");
      }
    }

    function render() {
      shown = matches(input.value);
      if (active >= shown.length) active = shown.length - 1;
      list.textContent = "";
      if (!shown.length) {
        const none = document.createElement("li");
        none.className = "pick-none";
        none.textContent = items.length ? o.none : "Loading…";
        list.append(none);
      }
      shown.forEach((item, i) => {
        const li = document.createElement("li");
        li.id = `${listId}-${i}`;
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", i === active ? "true" : "false");
        if (i === active) li.classList.add("active");
        const name = document.createElement("span");
        name.className = "pick-name";
        name.textContent = item.label;
        if (o.own) name.setAttribute("data-no-i18n", "");
        li.append(name);
        if (item.sub) {
          const sub = document.createElement("span");
          sub.className = "pick-sub";
          sub.textContent = item.sub;
          if (o.own) sub.setAttribute("data-no-i18n", "");
          li.append(sub);
        }
        if (item.tag) {
          const tag = document.createElement("span");
          tag.className = "pick-tag";
          tag.textContent = item.tag;
          li.append(tag);
        }
        // (pressed, not clicked: the box keeps the focus)
        li.addEventListener("mousedown", (e) => {
          e.preventDefault();
          choose(item);
        });
        list.append(li);
      });
      setOpen(true);
      if (active >= 0) input.setAttribute("aria-activedescendant", `${listId}-${active}`);
      else input.removeAttribute("aria-activedescendant");
    }

    function choose(item, quiet) {
      picked = item;
      input.value = textOf(item);
      setOpen(false);
      if (!quiet && o.onPick) o.onPick(item);
    }

    input.addEventListener("input", () => {
      if (picked && input.value !== textOf(picked)) picked = null;
      active = input.value.trim() ? 0 : -1;
      render();
    });
    input.addEventListener("focus", render);
    input.addEventListener("click", () => {
      if (list.hidden) render();
    });
    input.addEventListener("blur", () => {
      // a name typed out in full is as good as chosen
      if (!picked && input.value.trim()) {
        const typed = fold(input.value).trim();
        const same = items.filter((item) => fold(textOf(item)) === typed);
        if (same.length === 1) choose(same[0]);
      }
      setOpen(false);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (list.hidden) render();
        if (!shown.length) return;
        active =
          e.key === "ArrowDown"
            ? Math.min(shown.length - 1, active + 1)
            : Math.max(0, active - 1);
        render();
      } else if (e.key === "Enter") {
        if (!list.hidden && shown[active]) {
          e.preventDefault();
          e.stopPropagation();
          choose(shown[active]);
        }
      } else if (e.key === "Escape") {
        if (!list.hidden) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
        }
      }
    });
    // a room's name chosen stays in the page's language
    document.addEventListener("rbv:language", () => {
      if (picked && !o.own) input.value = textOf(picked);
    });

    return {
      setItems(next) {
        items = Array.isArray(next) ? next : [];
        if (picked) picked = items.find((item) => item.id === picked.id) || picked;
        if (!list.hidden) render();
      },
      get value() {
        return picked ? picked.id : "";
      },
      get item() {
        return picked;
      },
      // chosen from elsewhere (a reply, a room already known)
      pick(id) {
        const item = items.find((i) => i.id === id);
        if (item) choose(item, true);
        return !!item;
      },
      clear() {
        picked = null;
        input.value = "";
        setOpen(false);
      },
    };
  }

  // ------------------------------------------- passengers, for the pickers
  // Every passenger but oneself and the banned, those aboard first (the
  // server's "passengers"), asked again after half a minute
  let people = null;
  let peopleAt = 0;
  let asking = null;
  function loadPeople(fresh) {
    if (!fresh && people && Date.now() - peopleAt < 30000) return Promise.resolve(people);
    if (asking) return asking;
    asking = new Promise((resolve) => {
      if (!socket || !socket.connected) {
        asking = null;
        return resolve(people || []);
      }
      socket.timeout(8000).emit("passengers", {}, (err, res) => {
        asking = null;
        if (!err && res && res.ok && Array.isArray(res.people)) {
          people = res.people;
          peopleAt = Date.now();
        }
        resolve(people || []);
      });
    });
    return asking;
  }
  const personItem = (p) => ({
    id: p.id,
    label: p.name,
    sub: p.cabin || "",
    tag: p.aboard ? "Aboard now" : "",
  });

  // ------------------------------------------------ one card at a time
  // The cards of the menus and the bottom bar, by their buttons
  const CARDS = {
    "settings-popup": "settings-btn",
    "rules-popup": "rules-btn",
    "deckplans-popup": "deckplans-btn",
    "money-popup": "money-btn",
    "inbox-popup": "inbox-btn",
    "events-popup": "events-btn",
  };
  // the others put away as one opens
  function only(cardId) {
    for (const id of Object.keys(CARDS)) {
      if (id === cardId) continue;
      const card = document.getElementById(id);
      if (card && card.style.display !== "none") card.style.display = "none";
    }
  }
  // one put away as another's button is pressed
  function closeOnOthers(cardId, close) {
    for (const [id, button] of Object.entries(CARDS)) {
      if (id === cardId) continue;
      const btn = document.getElementById(button);
      if (btn) btn.addEventListener("click", close);
    }
  }

  // A date and time in the page's language
  function when(iso, withDay = true) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    const lang = (window.RBV_I18N && window.RBV_I18N.lang) || "en";
    const options = withDay
      ? { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" };
    try {
      return d.toLocaleString(lang === "en" ? "en-GB" : lang, options);
    } catch (e) {
      return d.toLocaleString();
    }
  }

  RBV.picker = { create, people: loadPeople, personItem, fold, tr };
  RBV.cards = { only, closeOnOthers, when };
})(window.RBV);
