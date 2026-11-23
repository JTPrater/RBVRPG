/**
 * Bridge prop: engine order telegraph. Roleplay only — dragging it does not
 * touch the ship's actual speed/timeline, it just swings the handle to one
 * of the printed orders on the dial and tells everyone else in the room.
 *
 * UI: a brass header bar (top-right of the location panel) that drops down a
 * backed panel holding the dial. The dial face is the real J.W. Ray & Co.
 * decal (images/telegraph.png) clipped to a circle; the handle.webp lever is
 * pinned on top by its pommel and rotated to point at the selected order.
 *
 * The wedge angles are MEASURED from the decal (a radial scan of its divider
 * lines), not assumed — it is NOT a uniform 12×30° layout. STOP is dead top,
 * the order grades are squeezed to ~24° each, and a wide ~90° maker's plate
 * fills the bottom, so FULL AHEAD is at 123.5°, not 150°. Everything is
 * centered on the image's geometric center — the pivot for both the handle
 * and the drag-angle math.
 *
 * Selecting an order "rings" it like the real instrument: the lever recoils
 * the other way, then swings firmly to the order with a bell. State is
 * synced through the server so everyone present sees the same handle and
 * hears the ring; a late joiner just gets the current position placed
 * silently (server flags that sync as `initial`).
 */
(function (RBV) {
  const socket = RBV.socket;

  // Handle pommel (pivot) within handle.webp, as fractions of its 287×631.
  const HANDLE_PIVOT_X = 49.1; // %
  const HANDLE_PIVOT_Y = 94.2; // %

  // Measured wedge centers, degrees clockwise from top. STAND_BY is printed
  // on both shoulders of STOP → two angles, same order.
  const POSITIONS = [
    { key: "STOP", angle: 0 },
    { key: "STAND_BY", angle: 26 },
    { key: "DEAD_SLOW_AHEAD", angle: 49.5 },
    { key: "SLOW_AHEAD", angle: 73.5 },
    { key: "HALF_AHEAD", angle: 98.5 },
    { key: "FULL_AHEAD", angle: 123.5 },
    { key: "FULL_ASTERN", angle: 236.5 },
    { key: "HALF_ASTERN", angle: 261.5 },
    { key: "SLOW_ASTERN", angle: 286.5 },
    { key: "DEAD_SLOW_ASTERN", angle: 310.5 },
    { key: "STAND_BY", angle: 334 },
  ];
  const FRIENDLY = {
    STOP: "STOP",
    STAND_BY: "STAND BY",
    DEAD_SLOW_AHEAD: "DEAD SLOW AHEAD",
    SLOW_AHEAD: "SLOW AHEAD",
    HALF_AHEAD: "HALF AHEAD",
    FULL_AHEAD: "FULL AHEAD",
    FULL_ASTERN: "FULL ASTERN",
    HALF_ASTERN: "HALF ASTERN",
    SLOW_ASTERN: "SLOW ASTERN",
    DEAD_SLOW_ASTERN: "DEAD SLOW ASTERN",
  };

  function angleGap(a, b) {
    return Math.abs(((a - b + 540) % 360) - 180);
  }
  function toSigned(deg) {
    return (((deg % 360) + 540) % 360) - 180;
  }

  // The lever sweeps from FULL AHEAD (+123.5°) up over STOP to FULL ASTERN
  // (−123.5°); it can't cross the maker's-plate arc across the bottom or
  // spin round. This clamps a raw heading into that reachable arc. Over the
  // forbidden bottom it holds the stop on the side it's already on (via
  // prevSigned) so you can't drag through the plate.
  const MAX_SWEEP = 123.5;
  function clampSweep(rawDeg, prevSigned) {
    const s = toSigned(rawDeg);
    if (s >= -MAX_SWEEP && s <= MAX_SWEEP) return s;
    const side = typeof prevSigned === "number" ? prevSigned : s;
    return side >= 0 ? MAX_SWEEP : -MAX_SWEEP;
  }

  function nearestPosition(angleDeg) {
    let best = POSITIONS[0];
    let bestDiff = Infinity;
    for (const p of POSITIONS) {
      const diff = angleGap(angleDeg, p.angle);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p;
      }
    }
    return best;
  }

  // Signed target angle for a command (STAND_BY picks the nearer shoulder).
  // Signed so the CSS rotate transition travels over the top, never through
  // the forbidden bottom.
  function angleForKey(key, fromAngle) {
    const matches = POSITIONS.filter((p) => p.key === key);
    let best = matches[0].angle;
    let bestDiff = Infinity;
    for (const p of matches) {
      const diff = angleGap(fromAngle, p.angle);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = p.angle;
      }
    }
    return toSigned(best);
  }

  let currentKey = "STOP";
  let currentAngle = 0;
  let widgetEl = null;
  let dialEl = null;
  let handleEl = null;
  let readoutEl = null;
  let headerOrderEl = null;
  let dragging = false;
  let ringTimer = null;

  function setHandle(angle, ms, easing) {
    handleEl.style.transition = ms ? `transform ${ms}ms ${easing}` : "none";
    handleEl.style.transform =
      `translate(-${HANDLE_PIVOT_X}%, -${HANDLE_PIVOT_Y}%) rotate(${angle}deg)`;
  }
  function forceReflow() {
    // Commit pending style so the next transition has a real start value.
    void handleEl.offsetWidth;
  }

  function updateOrderText(key) {
    const name = FRIENDLY[key] || "STOP";
    if (readoutEl) readoutEl.textContent = name;
    if (headerOrderEl) headerOrderEl.textContent = name;
  }

  // Place the lever instantly (no animation, no sound) — initial state and
  // remote late-join sync.
  function place(key) {
    if (ringTimer) {
      clearTimeout(ringTimer);
      ringTimer = null;
    }
    currentAngle = angleForKey(key, currentAngle);
    setHandle(currentAngle, 0);
    updateOrderText(key);
  }

  function playRing() {
    const s = RBV.audio && RBV.audio.telegraphSound;
    if (!s) return;
    try {
      s.currentTime = 0;
      s.play().catch(() => {});
    } catch (err) {
      /* ignore */
    }
  }

  // "Ring" the order: recoil the lever back the other way, then swing to the
  // order with a little settle — bell and all. The forced reflows guarantee
  // each leg animates instead of jumping (a timed transition set right after
  // transition:none won't fire otherwise).
  const WINDUP_DEG = 34;
  const WINDUP_MS = 240;
  const SETTLE_MS = 560;
  function ringTo(key, withSound) {
    const target = angleForKey(key, currentAngle);
    if (ringTimer) {
      clearTimeout(ringTimer);
      ringTimer = null;
    }
    if (withSound) playRing();
    updateOrderText(key);

    // Leg 1: recoil to the opposite side of STOP from the target.
    const windup = clampSweep(target >= 0 ? -WINDUP_DEG : WINDUP_DEG, 0);
    setHandle(currentAngle, 0); // pin current position, transition off
    forceReflow();
    setHandle(windup, WINDUP_MS, "cubic-bezier(0.45, 0, 0.55, 1)");
    currentAngle = windup;

    // Leg 2: swing to the ordered position with a spring settle.
    ringTimer = setTimeout(() => {
      ringTimer = null;
      forceReflow();
      setHandle(target, SETTLE_MS, "cubic-bezier(0.34, 1.35, 0.5, 1)");
      currentAngle = target;
    }, WINDUP_MS);
  }

  function commit(key) {
    const changed = key !== currentKey;
    currentKey = key;
    ringTo(key, true);
    if (!changed) return;
    const room = RBV.gameState && RBV.gameState.currentRoom;
    if (room && room.name && socket) {
      socket.emit("telegraph-set", { room: room.name, position: key });
    }
  }

  // Pointer angle relative to the dial's geometric center, 0 = up, cw+.
  function angleFromEvent(e, rect) {
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    return ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  }

  function attachInteraction() {
    const trackTo = (e) => {
      const raw = angleFromEvent(e, dialEl.getBoundingClientRect());
      currentAngle = clampSweep(raw, currentAngle);
      setHandle(currentAngle, 0);
    };
    dialEl.addEventListener("pointerdown", (e) => {
      dragging = true;
      dialEl.classList.add("teleg-dragging");
      if (ringTimer) {
        clearTimeout(ringTimer);
        ringTimer = null;
      }
      try {
        dialEl.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
      trackTo(e);
    });
    dialEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      trackTo(e);
    });
    const endDrag = (e) => {
      if (!dragging) return;
      dragging = false;
      dialEl.classList.remove("teleg-dragging");
      const clamped = clampSweep(
        angleFromEvent(e, dialEl.getBoundingClientRect()),
        currentAngle,
      );
      currentAngle = clamped;
      commit(nearestPosition((clamped + 360) % 360).key);
      try {
        dialEl.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    };
    dialEl.addEventListener("pointerup", endDrag);
    dialEl.addEventListener("pointercancel", endDrag);
  }

  function build() {
    widgetEl = document.getElementById("telegraph-widget");
    if (!widgetEl) return;

    // Header bar: click to drop the panel down / roll it up.
    const header = document.createElement("button");
    header.type = "button";
    header.className = "teleg-header";
    header.innerHTML =
      '<span class="teleg-header-label">Engine Telegraph</span>' +
      '<span class="teleg-header-order">STOP</span>' +
      '<span class="teleg-header-caret">▾</span>';
    headerOrderEl = header.querySelector(".teleg-header-order");

    const panel = document.createElement("div");
    panel.className = "teleg-panel";

    dialEl = document.createElement("div");
    dialEl.className = "teleg-case";

    const face = document.createElement("img");
    face.className = "teleg-face-img";
    face.src = "/images/telegraph.png";
    face.alt = "Engine order telegraph";
    face.draggable = false;

    handleEl = document.createElement("img");
    handleEl.className = "teleg-handle-img";
    handleEl.src = "/images/handle.webp";
    handleEl.alt = "";
    handleEl.draggable = false;

    dialEl.appendChild(face);
    dialEl.appendChild(handleEl);

    // The current order shows in the header bar (headerOrderEl), so the
    // panel holds just the dial — keeps the dropdown compact enough to fit
    // the location panel even at the smallest supported window.
    panel.appendChild(dialEl);
    widgetEl.appendChild(header);
    widgetEl.appendChild(panel);

    const setOpen = (open) => {
      widgetEl.classList.toggle("teleg-open", open);
      const caret = header.querySelector(".teleg-header-caret");
      if (caret) caret.textContent = open ? "▴" : "▾";
      localStorage.setItem("rbv:telegraphOpen", open ? "1" : "0");
    };
    header.addEventListener("click", () => {
      setOpen(!widgetEl.classList.contains("teleg-open"));
    });
    setOpen(localStorage.getItem("rbv:telegraphOpen") === "1");

    attachInteraction();
    place(currentKey);
  }

  function show() {
    if (widgetEl) widgetEl.style.display = "flex";
  }
  function hide() {
    if (widgetEl) widgetEl.style.display = "none";
    dragging = false;
    if (ringTimer) {
      clearTimeout(ringTimer);
      ringTimer = null;
    }
  }

  if (socket) {
    socket.on("telegraph-update", (data) => {
      if (!data || !FRIENDLY[data.position]) return;
      const room = RBV.gameState && RBV.gameState.currentRoom;
      if (room && data.room && data.room !== room.name) return;
      const changed = data.position !== currentKey;
      currentKey = data.position;
      if (!handleEl) return; // will be placed on build()
      if (data.initial || !changed) place(currentKey);
      else ringTo(currentKey, true);
    });
  }

  document.addEventListener("DOMContentLoaded", build);

  RBV.telegraph = {
    show,
    hide,
    get position() {
      return currentKey;
    },
  };
})(window.RBV);
