(function (RBV) {
  // The scene always fills the viewport width (full-bleed environment: sky,
  // water, and every canvas effect reach the edges with no seams). The
  // camera-zoom feel comes from --cam-zoom instead: when the viewport is
  // wider than the scene's native 1920 (browser zoom-out, ultrawide), the
  // .camera-rig — ship, wake, smoke, ports — scales down in place, so
  // pulling back shows a smaller ship on a bigger unbroken sea. Below the
  // water, a black extender runs to the bottom of the page (the water
  // texture's own bottom rows are pure black, so the seam is invisible).
  const WATER_H_FRAC = 0.5425; // .water element height (54.25% of scene)

  function ensureBackdrop() {
    const host = document.querySelector(".sprite-container");
    if (!host) return null;
    let ocean = document.getElementById("ocean-extender");
    if (!ocean) {
      ocean = document.createElement("div");
      ocean.id = "ocean-extender";
      host.insertBefore(ocean, host.firstChild);
    }
    let sky = document.getElementById("sky-wing");
    if (!sky) {
      sky = document.createElement("div");
      sky.id = "sky-wing";
      host.insertBefore(sky, ocean.nextSibling);
    }
    let water = document.getElementById("water-wing");
    if (!water) {
      water = document.createElement("div");
      water.id = "water-wing";
      host.insertBefore(water, sky.nextSibling);
    }
    return { ocean, sky, water };
  }

  // A window narrower than the interface needs (its bottom board needs about
  // 1100 px) gets the whole game drawn smaller: laid out as a 1100 px window
  // and zoomed down to fit, the way a phone shows it (its page is 1280 wide).
  // The boards are pinned to the window, so a minimum page width could not
  // help them: below about 1000 px their contents were squeezed unreadable.
  // --vw / --vh are that laid-out size, for the rules that place things from
  // the window's width (CSS's own vw ignores the zoom).
  const UI_MIN_WIDTH = 1100;
  let uiZoom = 1;
  function fitNarrowWindow() {
    const root = document.documentElement;
    const fit = Math.min(1, window.innerWidth / UI_MIN_WIDTH);
    root.style.zoom = fit < 1 ? fit.toFixed(4) : "";
    uiZoom = fit < 1 ? parseFloat(fit.toFixed(4)) : 1;
    root.style.setProperty("--vw", `${window.innerWidth / uiZoom}px`);
    root.style.setProperty("--vh", `${window.innerHeight / uiZoom}px`);
    return uiZoom;
  }
  // A pointer position (clientX / clientY, in window pixels) as a length to
  // place something at, in the zoomed page's own pixels (tooltips)
  window.uiPx = (v) => v / uiZoom;

  function setScale() {
    const root = document.documentElement;
    const fit = fitNarrowWindow();
    const viewportWidth = window.innerWidth / fit;
    const viewportHeight = window.innerHeight / fit;
    const styles = getComputedStyle(root);
    const baseWidth =
      parseFloat(styles.getPropertyValue("--scene-width")) || 1920;
    const baseHeight =
      parseFloat(styles.getPropertyValue("--scene-height")) || 1080;
    const waterBaseline =
      parseFloat(styles.getPropertyValue("--water-bottom")) || 150;
    const manualOffset =
      parseFloat(styles.getPropertyValue("--scene-manual-offset")) || 0;

    const scale = viewportWidth / baseWidth;
    // Camera pull-back: subject shrinks as the view widens past native size
    const camZoom = Math.min(1, Math.max(0.5, baseWidth / viewportWidth));
    root.style.setProperty("--cam-zoom", camZoom.toFixed(4));

    const sceneHeight = baseHeight * scale;
    const desiredOffset = viewportHeight - sceneHeight;
    const waterCorrection = -waterBaseline * scale;
    let bottomOffset = Math.max(desiredOffset, waterCorrection);
    bottomOffset += manualOffset;

    root.style.setProperty("--scale", scale.toString());
    root.style.setProperty("--scene-bottom-offset", `${bottomOffset}px`);

    const sceneTop = viewportHeight - bottomOffset - sceneHeight;
    const sceneLeft = (viewportWidth - baseWidth * scale) / 2;
    const waterEdge = viewportHeight - bottomOffset - waterBaseline * scale;
    const waterH = baseHeight * WATER_H_FRAC * scale;

    // Published for the water scroll loop (game.js keeps the wing water
    // phase-locked to the scene water) and anyone else who needs vista state
    window.__vista = {
      scale,
      sceneLeft,
      tileW: baseWidth * scale,
      camZoom,
      active: viewportWidth > baseWidth * scale + 1,
    };

    const layers = ensureBackdrop();
    if (layers) {
      if (waterEdge < viewportHeight - 1) {
        layers.ocean.style.top = `${Math.max(0, Math.floor(waterEdge) - 1)}px`;
        layers.ocean.style.display = "";
      } else {
        layers.ocean.style.display = "none";
      }
      if (window.__vista.active) {
        layers.sky.style.top = `${sceneTop}px`;
        layers.sky.style.height = `${sceneHeight}px`;
        layers.sky.style.display = "";
        layers.water.style.top = `${waterEdge - waterH}px`;
        layers.water.style.height = `${waterH}px`;
        layers.water.style.backgroundSize = `${baseWidth * scale}px 100%`;
        layers.water.style.display = "";
      } else {
        layers.sky.style.display = "none";
        layers.water.style.display = "none";
      }
    }
  }

  RBV.layout = { setScale };
  window.setScale = setScale;

  window.addEventListener("resize", setScale);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setScale);
  }
  setScale();
})(window.RBV);
