// The page in the player's language (2026-11-23).
//
// The game's code writes English; this watches the page and puts each known
// phrase into the chosen language where it appears, so nothing else has to
// change. Each language is a dictionary in /js/i18n/<code>.js: exact phrases
// ("exact") and the wording of the phrases with a number or a name in them
// ("t", filled in by the patterns below). Alerts are translated too. A page
// can ask for more of a dictionary: <script src="/js/i18n.js" data-parts="game">
// also loads /js/i18n/<code>-game.js (the rooms and the menus, 2026-11-24).
//
// Left as written: what players write (chat, names, biographies) and the
// songs' titles. An element inside one of those that is the game's own words
// (the room beside a line in the global chat) is marked data-i18n.
//
// The choice is kept in localStorage ("rbv:lang"); the first time, the
// browser's own language is used if there is a dictionary for it.
(function () {
  const LANGS = [
    ["en", "English"],
    ["ru", "Русский"],
    ["es", "Español"],
  ];
  const KEY = "rbv:lang";
  const CODES = new Set(LANGS.map((l) => l[0]));
  // data-i18n-content: text a stylesheet shows (content: attr(data-i18n-content))
  const ATTRS = ["placeholder", "title", "aria-label", "alt", "data-i18n-content"];
  // never touched: players' own words, icons (their names are ligatures),
  // the songs' titles and the language list itself
  const SKIP = [
    "script",
    "style",
    ".material-icons",
    ".material-symbols-outlined",
    "[data-no-i18n]",
    ".chat-message:not(.system)",
    ".player-name",
    ".player-cabin",
    ".player-popup-name",
    ".player-popup-bio",
    "#profile-name",
    "#profile-bio",
    // the songs' titles (the prompt and "Now Playing:" are translated)
    "#song-select option:not([value=''])",
    ".lang-select",
  ].join(",");

  // inside those, the game's own words again
  const OPT_IN = "[data-i18n]";

  // the dictionary's parts this page asks for (data-parts="game")
  const PARTS = ((document.currentScript && document.currentScript.dataset.parts) || "")
    .split(/[\s,]+/)
    .filter((p) => /^[a-z]+$/.test(p));

  const dicts = (window.RBV_I18N_DICT = window.RBV_I18N_DICT || {});
  const origText = new WeakMap(); // text node -> the English the game wrote
  const shownText = new WeakMap(); // text node -> what this wrote over it
  const origAttr = new WeakMap(); // element -> { attribute: English, "=attribute": shown }

  function choose() {
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch (e) {}
    if (saved && CODES.has(saved)) return saved;
    const wanted = (navigator.languages || [navigator.language || "en"]).map((l) =>
      String(l).slice(0, 2).toLowerCase(),
    );
    return wanted.find((l) => CODES.has(l)) || "en";
  }
  let lang = choose();

  // ---------------------------------------------------------------- strings
  // "{0} has left" with ["Ada"] -> "Ada has left"
  // the form for a count: ["one", "many"], or by the language's plural rules
  // ({ one, few, many, other }: 1 пассажир, 2 пассажира, 5 пассажиров)
  function plural(forms, n) {
    if (forms == null || typeof forms === "string") return forms;
    if (Array.isArray(forms)) return Number(n) === 1 ? forms[0] : forms[1];
    let cat = "other";
    try {
      cat = new Intl.PluralRules(lang).select(Number(n));
    } catch (e) {}
    return forms[cat] || forms.other;
  }
  function fill(tpl, ...args) {
    return String(tpl).replace(/\{(\d)\}/g, (_, i) => (args[i] == null ? "" : args[i]));
  }
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const HANDS = "Royal flush|Straight flush|Four of a kind|Full house|Flush|Straight|Three of a kind|Two pair|Jacks or better|Pair|High card";
  const COMPASS = "NNE|NNW|ENE|ESE|SSE|SSW|WSW|WNW|NE|NW|SE|SW|N|E|S|W";
  // the English phrases with something in them; t is the language's wording
  const PATTERNS = [
    [/^Location: (.+)$/, (m, t) => t.location && fill(t.location, tr(m[1]))],
    [/^Speed: ([\d.]+) knots?$/, (m, t) => t.speed && fill(t.speed, m[1])],
    [/^Passengers: (\d+)$/, (m, t) => t.passengers && fill(t.passengers, m[1])],
    [new RegExp(`^Date: (\\d{1,2}) (${MONTHS.join("|")}), (.+)$`), (m, t) => t.date && fill(t.date, m[1], t.months[MONTHS.indexOf(m[2])], m[3])],
    [new RegExp(`^(\\d{1,2}) (${MONTHS.join("|")}) (\\d{4})$`), (m, t) => t.dateLong && fill(t.dateLong, m[1], t.months[MONTHS.indexOf(m[2])], m[3])],
    [/^(\d+) [Pp]assengers?$/, (m, t) => t.passengerCount && fill(plural(t.passengerCount, m[1]), m[1])],
    [/^You have entered (.+)$/, (m, t) => t.entered && fill(t.entered, tr(m[1]))],
    [/^(.+) has entered the room$/, (m, t) => t.joined && fill(t.joined, m[1])],
    [/^(.+) has left the room$/, (m, t) => t.left && fill(t.left, m[1])],
    [/^Switched to (.+) chat$/, (m, t) => t.switched && fill(t.switched, tr(m[1]))],
    [/^Now Playing: (.*)$/, (m, t) => t.nowPlaying && fill(t.nowPlaying, m[1])],
    [/^Engine order telegraph rung to (.+) by (.+)\.$/, (m, t) => t.telegraph && fill(t.telegraph, tr(m[1]), m[2])],
    [new RegExp(`^Wind (${COMPASS}) (\\d+) kn \\((.+)\\)$`), (m, t) => t.wind && fill(t.wind, m[1].replace(/[NESW]/g, (c) => (t.compass || {})[c] || c), m[2], tr(m[3]))],
    [/^Air (-?\d+)°C$/, (m, t) => t.air && fill(t.air, m[1])],
    [/^(\d+) mb, (rising|falling|steady)$/, (m, t) => t.pressure && fill(t.pressure, m[1], tr(m[2]))],
    [new RegExp(`^(${HANDS})\\. (£[\\d.]+) paid\\.$`), (m, t) => t.paid && fill(t.paid, tr(m[1]), m[2])],
    [new RegExp(`^(${HANDS})\\. The (£[\\d.]+) stake is lost\\.$`), (m, t) => t.lost && fill(t.lost, tr(m[1]), m[2])],
    [new RegExp(`^(${HANDS})\\. No win\\.$`), (m, t) => t.noWin && fill(t.noWin, tr(m[1]))],
    [new RegExp(`^(${HANDS})\\.$`), (m) => tr(m[1]) + "."],
    [/^You haven't enough money for a (£[\d.]+) stake\.$/, (m, t) => t.noMoney && fill(t.noMoney, m[1])],
    [/^(Ace|King|Queen|Jack|\d+) of (clubs|diamonds|hearts|spades)(, held)?$/, (m, t) => t.card && fill(t.card, tr(m[1]), tr(m[2])) + (m[3] ? tr(", held") : "")],
    [/^View bio for (.+)$/, (m, t) => t.viewBio && fill(t.viewBio, m[1])],
    [/^View details for (.+)$/, (m, t) => t.viewDetails && fill(t.viewDetails, m[1])],
    [/^Born: (.+)$/, (m, t) => t.born && fill(t.born, tr(m[1]))],
    [/^Cabin: (.+)$/, (m, t) => t.cabin && fill(t.cabin, m[1])],
    [/^Age during voyage: (\d+) years$/, (m, t) => t.age && fill(plural(t.age, m[1]), m[1])],
    [/^Registration will open in (\d+)d (\d+)h (\d+)m (\d+)s$/, (m, t) => t.countdown && fill(t.countdown, m[1], m[2], m[3], m[4])],
    [/^Failed to load cabin numbers: ([\s\S]+?)\s*Please try refreshing the page or contact support if the issue persists\.$/, (m, t) => t.cabinsFailed && fill(t.cabinsFailed, m[1])],
    // the server's rate limits (server.js limitReached)
    [/^Too many (?:attempts|login attempts|requests)\. Please wait (\d+) minutes? and try again\.$/, (m, t) => t.tooMany && fill(t.tooMany, m[1])],
    // a cabin by its number: "Cabin A1", "Cabin B-81"
    [/^Cabin ([A-Z]-?\d+)$/, (m, t) => t.cabinNamed && fill(t.cabinNamed, m[1])],
    // a room named in brackets beside a line of the global chat
    [/^\((.+)\)$/, (m) => {
      const inner = tr(m[1]);
      return inner !== m[1] ? `(${inner})` : undefined;
    }],
    // a registration field over its length (server.js REGISTRATION_FIELD_LIMITS)
    [/^(Forename|Surname|Bio) must be (\d+) characters or fewer$/, (m, t) => t.fieldTooLong && fill(t.fieldTooLong, tr(m[1]), m[2])],
    // the moderators' word (game.js applyModerationStatus, main.js banLines):
    // the date is written in the page's language already, the reason is the
    // moderator's own
    [/^A moderator has muted you until (.+)\.$/, (m, t) => t.modMutedUntil && fill(t.modMutedUntil, m[1])],
    [/^You are muted until (.+)\.$/, (m, t) => t.mutedUntil && fill(t.mutedUntil, m[1])],
    [/^Not sent: you are muted until (.+)\.$/, (m, t) => t.notSentMutedUntil && fill(t.notSentMutedUntil, m[1])],
    [/^This passenger has been banned until (.+)\.$/, (m, t) => t.bannedUntil && fill(t.bannedUntil, m[1])],
    [/^Reason: (.+)$/, (m, t) => t.reason && fill(t.reason, m[1])],
  ];
  window.RBV_I18N_PATTERNS = PATTERNS; // (for the checks in scripts/i18n)

  function lookup(core) {
    const d = dicts[lang];
    if (!d) return undefined;
    if (Object.prototype.hasOwnProperty.call(d.exact, core)) return d.exact[core];
    const t = d.t || {};
    for (const [re, make] of PATTERNS) {
      const m = re.exec(core);
      if (m) {
        const out = make(m, t);
        if (out) return out;
      }
    }
    // the weather and similar lines: parts joined by " · ", each on its own
    if (core.includes(" · ")) {
      const parts = core.split(" · ");
      const done = parts.map((p) => {
        const t = lookup(p);
        return t === undefined ? p : t;
      });
      if (done.some((t, i) => t !== parts[i])) return done.join(" · ");
    }
    return undefined;
  }
  // a phrase in the current language (English, or unknown, as it is)
  function tr(text) {
    if (lang === "en" || text == null) return text;
    const s = String(text);
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!m[2]) return s;
    // a page's text may run over lines: its spacing is not part of the phrase
    const t = lookup(m[2].replace(/\s+/g, " "));
    return t === undefined ? s : m[1] + t + m[3];
  }

  // ------------------------------------------------------------------ page
  function skipped(el) {
    if (!el || !el.closest) return true;
    return !!el.closest(SKIP) && !el.closest(OPT_IN);
  }
  // a skipped element with some of the game's own words inside it
  function holdsOptIn(el) {
    return !!(el.querySelector && el.querySelector(OPT_IN));
  }
  function doText(node) {
    const cur = node.data;
    const orig = shownText.get(node) === cur && origText.has(node) ? origText.get(node) : cur;
    origText.set(node, orig);
    const t = tr(orig);
    shownText.set(node, t);
    if (t !== cur) node.data = t;
  }
  function doAttrs(el) {
    // a button's label is its value; a text box's value is the player's own
    const list =
      el.tagName === "INPUT" && /^(submit|button|reset)$/i.test(el.type)
        ? ATTRS.concat(["value"])
        : ATTRS;
    for (const a of list) {
      if (!el.hasAttribute(a)) continue;
      const cur = el.getAttribute(a);
      let rec = origAttr.get(el);
      if (!rec) origAttr.set(el, (rec = {}));
      const orig = rec["=" + a] === cur && a in rec ? rec[a] : cur;
      rec[a] = orig;
      const t = tr(orig);
      rec["=" + a] = t;
      if (t !== cur) el.setAttribute(a, t);
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) {
      if (!skipped(root.parentElement) && /[A-Za-z]/.test(root.data)) doText(root);
      return;
    }
    if (root.nodeType !== 1) return;
    const rootSkipped = skipped(root);
    if (rootSkipped && !holdsOptIn(root)) return;
    if (!rootSkipped) doAttrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        // a skipped part is passed over whole, unless it holds the game's
        // own words (then only those are visited)
        if (n.nodeType === 1 && n.matches(SKIP) && !n.matches(OPT_IN)) {
          return holdsOptIn(n) ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) {
        if ((/[A-Za-z]/.test(n.data) || origText.has(n)) && !skipped(n.parentElement)) doText(n);
      } else if (!skipped(n)) doAttrs(n);
    }
  }

  const watcher = new MutationObserver((records) => {
    if (lang === "en" && !document.documentElement.hasAttribute("data-i18n-was")) return;
    for (const r of records) {
      if (r.type === "characterData") {
        if (!skipped(r.target.parentElement)) doText(r.target);
      } else if (r.type === "childList") {
        r.addedNodes.forEach(walk);
      } else if (r.type === "attributes") {
        if (!skipped(r.target)) doAttrs(r.target);
      }
    }
  });

  function start() {
    if (lang !== "en") walk(document.body);
    watcher.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS.concat(["value"]),
    });
  }

  // ------------------------------------------------------ the dictionaries
  const loading = {};
  function load(code) {
    if (code === "en") return Promise.resolve();
    if (!loading[code]) {
      // the language's dictionary, then the parts this page asks for, run in
      // that order (a part adds to its language's dictionary)
      const files = [code, ...PARTS.map((p) => `${code}-${p}`)];
      loading[code] = Promise.all(
        files.map(
          (file) =>
            new Promise((resolve) => {
              const s = document.createElement("script");
              s.src = `/js/i18n/${file}.js?v=2`;
              s.async = false;
              s.onload = () => resolve();
              s.onerror = () => resolve(); // no dictionary: the page stays in English
              document.head.appendChild(s);
            }),
        ),
      );
    }
    return loading[code];
  }

  function setLang(code) {
    if (!CODES.has(code)) code = "en";
    lang = code;
    try {
      localStorage.setItem(KEY, code);
    } catch (e) {}
    document.documentElement.lang = code;
    // once translated, the page is watched in English too (to undo it)
    if (code !== "en") document.documentElement.setAttribute("data-i18n-was", "1");
    return load(code).then(() => {
      if (document.body) walk(document.body);
      document.querySelectorAll(".lang-select").forEach((s) => (s.value = code));
      document.dispatchEvent(new CustomEvent("rbv:language", { detail: code }));
    });
  }

  // <select class="lang-select"> anywhere on the page becomes the picker
  function mountPickers() {
    document.querySelectorAll("select.lang-select").forEach((sel) => {
      if (sel.dataset.ready) return;
      sel.dataset.ready = "1";
      sel.innerHTML = "";
      for (const [code, name] of LANGS) {
        const o = document.createElement("option");
        o.value = code;
        o.textContent = name;
        o.lang = code;
        sel.appendChild(o);
      }
      sel.value = lang;
      sel.addEventListener("change", () => setLang(sel.value));
    });
  }

  // the browser's own message boxes are not part of the page: their text is
  // put into the language on its way in
  const nativeAlert = window.alert.bind(window);
  const nativeConfirm = window.confirm.bind(window);
  window.alert = (message) => nativeAlert(tr(message));
  window.confirm = (message) => nativeConfirm(tr(message));

  window.RBV_I18N = { tr, setLang, get lang() { return lang; }, languages: LANGS };

  function boot() {
    mountPickers();
    document.documentElement.lang = lang;
    if (lang !== "en") document.documentElement.setAttribute("data-i18n-was", "1");
    load(lang).then(start);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
