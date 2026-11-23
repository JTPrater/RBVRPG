/**
 * Voyage track chart: a globe button (top-left) opening a small nautical
 * chart of the full Southampton → New York route. A red dot tracks the ship
 * live along the path, and the portion already sailed is inked in darker.
 *
 * Rendering notes: coastlines and the route are drawn as Catmull-Rom
 * splines through embedded lat/lon points, so the geography reads as drawn
 * curves rather than polygon segments. Continental land closes invisibly
 * along the chart edges; only true coastline is stroked.
 */
(function (RBV) {
  // Southampton → Cherbourg → Queenstown → North Atlantic → New York
  const ROUTE = [
    { lat: 50.89519017880291, lon: -1.406300067901583 }, // 0 Berth 44
    { lat: 50.89309232551032, lon: -1.4071583747863485 },
    { lat: 50.879772136496165, lon: -1.3964509963988974 },
    { lat: 50.86211431044757, lon: -1.3591146469115927 },
    { lat: 50.814686761532336, lon: -1.2925100326537802 },
    { lat: 50.77996637090227, lon: -1.2748289108276083 }, // 5 Calshot
    { lat: 50.76223659721589, lon: -1.2149047851562784 },
    { lat: 50.73191207677468, lon: -1.035661697387667 },
    { lat: 50.62836016073824, lon: -0.9869098663329794 }, // 8 Nab
    { lat: 49.75613728471726, lon: -1.451797485351591 }, // 9 Cherbourg approach
    { lat: 49.6797848824448, lon: -1.6186881065368368 }, // 10 Cherbourg anchorage
    { lat: 49.74316019059776, lon: -1.891422271728544 },
    { lat: 49.76, lon: -3.6 },
    { lat: 49.84466584121889, lon: -5.669345855712919 },
    { lat: 50.15, lon: -6.55 },
    { lat: 50.85, lon: -7.55 },
    { lat: 51.52, lon: -8.0 },
    { lat: 51.76362978507181, lon: -8.208217620849638 }, // 17 Queenstown
    { lat: 51.69579620914249, lon: -8.327350616455107 },
    { lat: 51.55, lon: -8.5333333 },
    { lat: 51.367962121746146, lon: -9.603481292724638 }, // 20 Fastnet
    { lat: 50.1, lon: -20.7166667 },
    { lat: 47.3666667, lon: -33.1666667 },
    { lat: 43.0333333, lon: -44.5166667 },
    { lat: 41.9583333, lon: -47.0416667 },
    { lat: 41.81766432731966, lon: -47.93835639953613 },
    { lat: 41.727535357434014, lon: -50.28943061828613 },
    { lat: 40.5833333, lon: -69.6083333 },
    { lat: 40.451151487039695, lon: -73.56791496276857 },
    { lat: 40.5237410330109, lon: -73.99981498718263 },
    { lat: 40.596219465818635, lon: -74.04039144515988 },
    { lat: 40.615898652875586, lon: -74.04897451400754 },
    { lat: 40.66009052532888, lon: -74.0478801727295 },
    { lat: 40.705, lon: -74.025 },
    { lat: 40.745460352472044, lon: -74.01474952697755 }, // 34 Pier 59
  ];

  const PORTS = [
    // The three European ports occupy only a few chart pixels at full-route
    // scale, so each label sits off to its own side with a leader line back
    // to its exact port — Southampton above England (the chart edge leaves
    // no room east of it, and to the west its label would land on
    // Queenstown's dot), level with Queenstown's out at sea, and Cherbourg
    // drops into open water south of the Cotentin peninsula rather than
    // sitting on the French coastline.
    // (Zooming in via the toolbar/scroll-wheel gives even this cluster
    // plenty of room.)
    { i: 0, name: "Southampton", dx: -13, dy: -28, anchor: "middle" },
    { i: 10, name: "Cherbourg", dx: -4, dy: 23, anchor: "end" },
    { i: 17, name: "Queenstown", dx: -36, dy: -17, anchor: "end" },
    { i: 34, name: "New York", dx: 9, dy: 4, anchor: "start" },
  ];

  // Real coastline polygons come from public/game/data/mapCoast.js
  // (window.RBV_COAST): Natural Earth 50m land data, clipped to a window
  // slightly larger than the chart so the clip edges fall outside the
  // visible frame, and simplified to ~2 km.

  // Chart bounds and projection (simple equirectangular)
  const B = { minLon: -77, maxLon: 2, minLat: 38.5, maxLat: 55.5 };
  const CW = 660;
  const CH = 250;
  const PAD = 16;
  function proj(lat, lon) {
    return {
      x: PAD + ((lon - B.minLon) / (B.maxLon - B.minLon)) * (CW - PAD * 2),
      y: PAD + ((B.maxLat - lat) / (B.maxLat - B.minLat)) * (CH - PAD * 2),
    };
  }
  function projPair(p) {
    return proj(p.lat !== undefined ? p.lat : p[0], p.lon !== undefined ? p.lon : p[1]);
  }

  // Catmull-Rom spline through projected points → SVG path
  function smoothPath(pts, closed) {
    if (pts.length < 3) {
      return pts.length === 2
        ? `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)} ${pts[1].y.toFixed(1)}`
        : "";
    }
    const n = pts.length;
    const at = (i) => pts[closed ? ((i % n) + n) % n : Math.max(0, Math.min(n - 1, i))];
    const segs = closed ? n : n - 1;
    let d = `M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < segs; i++) {
      const p0 = at(i - 1);
      const p1 = at(i);
      const p2 = at(i + 1);
      const p3 = at(i + 2);
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    if (closed) d += " Z";
    return d;
  }

  // Cumulative route distances (flat-earth approx, fine at this scale)
  const cum = [0];
  for (let i = 1; i < ROUTE.length; i++) {
    const a = ROUTE[i - 1];
    const b = ROUTE[i];
    const dx = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
    cum.push(cum[i - 1] + Math.hypot(dx, b.lat - a.lat));
  }

  function pointAtDistance(d) {
    if (d <= 0) return ROUTE[0];
    if (d >= cum[cum.length - 1]) return ROUTE[ROUTE.length - 1];
    let i = 1;
    while (cum[i] < d) i++;
    const f = (d - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
    return {
      lat: ROUTE[i - 1].lat + (ROUTE[i].lat - ROUTE[i - 1].lat) * f,
      lon: ROUTE[i - 1].lon + (ROUTE[i].lon - ROUTE[i - 1].lon) * f,
    };
  }

  function nearestRouteDist(lat, lon) {
    let best = 0;
    let bestD2 = Infinity;
    for (let i = 1; i < ROUTE.length; i++) {
      const ax = ROUTE[i - 1].lon;
      const ay = ROUTE[i - 1].lat;
      const vx = ROUTE[i].lon - ax;
      const vy = ROUTE[i].lat - ay;
      const t = Math.max(
        0,
        Math.min(1, ((lon - ax) * vx + (lat - ay) * vy) / (vx * vx + vy * vy || 1)),
      );
      const d2 = (lon - (ax + vx * t)) ** 2 + (lat - (ay + vy * t)) ** 2;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = cum[i - 1] + (cum[i] - cum[i - 1]) * t;
      }
    }
    return best;
  }

  function shipState() {
    const v = RBV.voyage || {};
    if (v.DEV_NORTH_ATLANTIC && v.DEV_POSITION) {
      const p = v.DEV_POSITION;
      return { lat: p.lat, lon: p.lon, dist: nearestRouteDist(p.lat, p.lon) };
    }
    if (!window.VoyageState) return { lat: ROUTE[0].lat, lon: ROUTE[0].lon, dist: 0 };
    const T = window.VoyageState.TIMELINE_SECONDS;
    const dep = T.DEPARTURE_DELAY;
    const anchors = [
      { t: 0, i: 0 },
      { t: dep, i: 0 },
      { t: dep + T.SOUTHAMPTON_WATER_END, i: 5 },
      { t: dep + T.NEEDLES_COMPLETE, i: 8 },
      { t: dep + T.CHANNEL_COMPLETE, i: 9 },
      { t: dep + T.BERTHING_COMPLETE, i: 10 },
    ];
    const e =
      typeof window.getElapsedSeconds === "function"
        ? window.getElapsedSeconds()
        : 0;
    const last = anchors[anchors.length - 1];
    let dist;
    if (e >= last.t) {
      dist = cum[last.i]; // berthed at Cherbourg (until the voyage grows)
    } else {
      let k = 1;
      while (k < anchors.length && e > anchors[k].t) k++;
      const a0 = anchors[k - 1];
      const a1 = anchors[k];
      const f = (e - a0.t) / (a1.t - a0.t || 1);
      dist = cum[a0.i] + (cum[a1.i] - cum[a0.i]) * f;
    }
    const p = pointAtDistance(dist);
    return { lat: p.lat, lon: p.lon, dist };
  }

  const NS = "http://www.w3.org/2000/svg";
  function el(name, attrs, parent) {
    const n = document.createElementNS(NS, name);
    for (const key of Object.keys(attrs)) n.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(n);
    return n;
  }

  let shipDot = null;
  let shipRing = null;
  let progressPath = null;

  // ── Zoom / pan ──
  // The whole chart lives in one viewBox; zooming just shrinks/grows the
  // slice of it we show. Line strokes stay crisp at any zoom via CSS
  // `vector-effect: non-scaling-stroke`; circle radii and label font sizes
  // don't get that for free, so `scalables` tracks them and we rescale by
  // hand each time the view changes, keeping dots and text a constant
  // on-screen size instead of ballooning as you zoom in.
  let svgEl = null;
  let view = { x: 0, y: 0, w: CW, h: CH };
  const MIN_VIEW_W = CW / 9; // ~9x max zoom
  const MAX_VIEW_W = CW; // fully zoomed out = the original chart
  const scalables = [];

  function markScalable(node, kind, base) {
    node.__base = base;
    node.__kind = kind; // 'r' (circle radius) or 'font' (font-size)
    scalables.push(node);
  }

  function effectiveScale() {
    return CW / view.w;
  }

  function applyScales() {
    const s = effectiveScale();
    for (const node of scalables) {
      const v = (node.__base / s).toFixed(2);
      if (node.__kind === "r") node.setAttribute("r", v);
      else node.style.fontSize = v + "px";
    }
  }

  function clampView() {
    view.w = Math.max(MIN_VIEW_W, Math.min(MAX_VIEW_W, view.w));
    view.h = view.w * (CH / CW);
    // Allow panning a bit past the chart's own edges, but not into the void
    const marginX = view.w * 0.35;
    const marginY = view.h * 0.35;
    view.x = Math.max(-marginX, Math.min(CW - view.w + marginX, view.x));
    view.y = Math.max(-marginY, Math.min(CH - view.h + marginY, view.y));
  }

  function setView() {
    clampView();
    if (svgEl) {
      svgEl.setAttribute(
        "viewBox",
        `${view.x.toFixed(2)} ${view.y.toFixed(2)} ${view.w.toFixed(2)} ${view.h.toFixed(2)}`,
      );
    }
    applyScales();
  }

  function zoomAt(ux, uy, factor) {
    const newW = Math.max(MIN_VIEW_W, Math.min(MAX_VIEW_W, view.w * factor));
    const ratio = newW / view.w;
    view.x = ux - (ux - view.x) * ratio;
    view.y = uy - (uy - view.y) * ratio;
    view.w = newW;
    view.h = newW * (CH / CW);
    setView();
  }

  function zoomByFactor(factor) {
    zoomAt(view.x + view.w / 2, view.y + view.h / 2, factor);
  }

  function attachInteraction() {
    svgEl.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const rect = svgEl.getBoundingClientRect();
        const px = (e.clientX - rect.left) / rect.width;
        const py = (e.clientY - rect.top) / rect.height;
        zoomAt(
          view.x + px * view.w,
          view.y + py * view.h,
          e.deltaY < 0 ? 0.82 : 1 / 0.82,
        );
      },
      { passive: false },
    );

    let dragging = false;
    let dragStart = null;
    let viewStart = null;
    svgEl.addEventListener("pointerdown", (e) => {
      dragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      viewStart = { x: view.x, y: view.y, w: view.w, h: view.h };
      svgEl.classList.add("rm-dragging");
      try {
        svgEl.setPointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    });
    svgEl.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const rect = svgEl.getBoundingClientRect();
      view.x = viewStart.x - (e.clientX - dragStart.x) * (viewStart.w / rect.width);
      view.y = viewStart.y - (e.clientY - dragStart.y) * (viewStart.h / rect.height);
      setView();
    });
    const endDrag = (e) => {
      dragging = false;
      svgEl.classList.remove("rm-dragging");
      try {
        svgEl.releasePointerCapture(e.pointerId);
      } catch (err) {
        /* ignore */
      }
    };
    svgEl.addEventListener("pointerup", endDrag);
    svgEl.addEventListener("pointercancel", endDrag);
  }

  function buildChart(container) {
    const svg = el("svg", { viewBox: `0 0 ${CW} ${CH}`, width: "100%" }, container);
    svgEl = svg;

    // Sea + frame
    el("rect", {
      x: PAD, y: PAD, width: CW - PAD * 2, height: CH - PAD * 2,
      class: "rm-sea",
    }, svg);

    // Graticule with edge tick labels
    for (let lon = -70; lon <= 0; lon += 10) {
      const a = proj(B.minLat, lon);
      const b = proj(B.maxLat, lon);
      el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "rm-grat" }, svg);
      if (lon % 20 !== 0) continue;
      const t = el("text", { x: a.x, y: CH - 4, class: "rm-tick", "text-anchor": "middle" }, svg);
      t.textContent = lon === 0 ? "0°" : `${-lon}°W`;
      markScalable(t, "font", 6);
    }
    for (let lat = 40; lat <= 55; lat += 5) {
      const a = proj(lat, B.minLon);
      const b = proj(lat, B.maxLon);
      el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: "rm-grat" }, svg);
      const t = el("text", { x: 3, y: a.y + 2, class: "rm-tick" }, svg);
      t.textContent = `${lat}°`;
      markScalable(t, "font", 6);
    }

    // Everything geographic renders inside a clip to the sea rectangle so
    // land crossing the frame edge never spills into the chart margin
    const clip = el("clipPath", { id: "rm-clip" }, svg);
    el("rect", {
      x: PAD, y: PAD, width: CW - PAD * 2, height: CH - PAD * 2,
    }, clip);
    const geo = el("g", { "clip-path": "url(#rm-clip)" }, svg);

    // Real land polygons (closed rings; their clip-window edges lie outside
    // the visible frame, so stroking the ring only draws true coastline)
    const rings = window.RBV_COAST || [];
    for (const ring of rings) {
      const pts = ring
        .map((p) => proj(p[0], p[1]))
        .map((q) => q.x.toFixed(1) + "," + q.y.toFixed(1))
        .join(" ");
      el("polygon", { points: pts, class: "rm-land" }, geo);
      el("polygon", { points: pts, class: "rm-coast" }, geo);
    }

    // Compass rose in the open ocean — a fixed geographic ornament, like a
    // printed chart symbol, so it (deliberately) scales with the map as a
    // whole rather than staying pinned to a constant screen size
    const rose = proj(43.0, -30);
    el("circle", { cx: rose.x, cy: rose.y, r: 13, class: "rm-rose" }, geo);
    el("circle", { cx: rose.x, cy: rose.y, r: 9.5, class: "rm-rose" }, geo);
    for (let k = 0; k < 8; k++) {
      const ang = (k * Math.PI) / 4;
      const len = k % 2 === 0 ? 13 : 7;
      el("line", {
        x1: rose.x - Math.sin(ang) * len, y1: rose.y + Math.cos(ang) * len,
        x2: rose.x + Math.sin(ang) * len, y2: rose.y - Math.cos(ang) * len,
        class: "rm-rose",
      }, geo);
    }
    const roseN = el("text", {
      x: rose.x, y: rose.y - 16, class: "rm-tick", "text-anchor": "middle",
    }, geo);
    roseN.textContent = "N";

    // Route: full track faint, sailed portion inked live
    const routePts = ROUTE.map(projPair);
    el("path", { d: smoothPath(routePts, false), class: "rm-route" }, geo);
    progressPath = el("path", { d: "", class: "rm-progress" }, geo);

    // Waypoint ticks
    for (const p of ROUTE) {
      const q = projPair(p);
      const wpt = el("circle", { cx: q.x, cy: q.y, r: 0.9, class: "rm-wpt" }, geo);
      markScalable(wpt, "r", 0.9);
    }

    // Ports
    for (const p of PORTS) {
      const q = projPair(ROUTE[p.i]);
      const labelX = q.x + p.dx;
      const labelY = q.y + p.dy;
      el("line", {
        x1: q.x,
        y1: q.y,
        x2: labelX,
        y2: labelY,
        class: "rm-port-leader",
      }, svg);
      const portDot = el("circle", { cx: q.x, cy: q.y, r: 2.4, class: "rm-port" }, svg);
      markScalable(portDot, "r", 2.4);
      const t = el("text", {
        x: labelX, y: labelY, class: "rm-label",
        "text-anchor": p.anchor,
      }, svg);
      t.textContent = p.name;
      markScalable(t, "font", 8);
    }

    // Ship
    shipRing = el("circle", { cx: 0, cy: 0, r: 5.5, class: "rm-ship-ring" }, svg);
    shipDot = el("circle", { cx: 0, cy: 0, r: 3, class: "rm-ship" }, svg);
    markScalable(shipRing, "r", 5.5);
    markScalable(shipDot, "r", 3);
    updateShip();

    // Toolbar (zoom in / zoom out / reset) and pan/zoom interaction
    const toolbar = document.createElement("div");
    toolbar.className = "rm-toolbar";
    toolbar.innerHTML =
      '<button type="button" data-act="in" title="Zoom in">+</button>' +
      '<button type="button" data-act="out" title="Zoom out">−</button>' +
      '<button type="button" data-act="reset" title="Reset view">⟲</button>';
    container.appendChild(toolbar);
    toolbar.addEventListener("click", (e) => {
      const act = e.target.getAttribute("data-act");
      if (act === "in") zoomByFactor(0.72);
      else if (act === "out") zoomByFactor(1 / 0.72);
      else if (act === "reset") {
        view = { x: 0, y: 0, w: CW, h: CH };
        setView();
      }
    });

    attachInteraction();
    setView();
  }

  function updateShip() {
    if (!shipDot) return;
    const s = shipState();
    const q = proj(s.lat, s.lon);
    shipDot.setAttribute("cx", q.x);
    shipDot.setAttribute("cy", q.y);
    shipRing.setAttribute("cx", q.x);
    shipRing.setAttribute("cy", q.y);
    // Ink in the sailed portion of the track
    if (progressPath) {
      const pts = [];
      for (let i = 0; i < ROUTE.length && cum[i] <= s.dist; i++) {
        pts.push(projPair(ROUTE[i]));
      }
      pts.push(q);
      progressPath.setAttribute("d", pts.length >= 2 ? smoothPath(pts, false) : "");
    }
  }

  function init() {
    const btn = document.createElement("button");
    btn.id = "route-globe-btn";
    btn.type = "button";
    btn.title = "Voyage track chart";
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" ' +
      'stroke="currentColor" stroke-width="1.5">' +
      '<circle cx="12" cy="12" r="9"/>' +
      '<ellipse cx="12" cy="12" rx="4" ry="9"/>' +
      '<line x1="3" y1="12" x2="21" y2="12"/>' +
      '<path d="M4.5 7.5 C 9 9.5, 15 9.5, 19.5 7.5"/>' +
      '<path d="M4.5 16.5 C 9 14.5, 15 14.5, 19.5 16.5"/>' +
      "</svg>";
    // Nested inside .top-bar so it centers on the bar's own (responsive)
    // height via CSS rather than a fixed viewport pixel offset — see the
    // comment on #route-globe-btn in game.css.
    const topBar = document.querySelector(".top-bar");
    (topBar || document.body).appendChild(btn);

    const panel = document.createElement("div");
    panel.id = "route-map-panel";
    panel.innerHTML =
      '<div class="rm-title">Track Chart — Southampton to New York</div>';
    document.body.appendChild(panel);
    buildChart(panel);

    const setOpen = (open) => {
      panel.style.display = open ? "block" : "none";
      btn.classList.toggle("open", open);
      localStorage.setItem("rbv:routeMapOpen", open ? "1" : "0");
      if (open) updateShip();
    };
    btn.addEventListener("click", () => {
      setOpen(panel.style.display === "none");
    });
    setOpen(localStorage.getItem("rbv:routeMapOpen") === "1");

    setInterval(updateShip, 1000);
  }

  document.addEventListener("DOMContentLoaded", init);
  RBV.routeMap = { updateShip };
})(window.RBV);
