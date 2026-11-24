/**
 * Shared namespace for split game client modules (loaded before other game scripts).
 */
window.RBV = window.RBV || {};

// The scene's animation frames. Every moving part of the scene (sea, wake and
// coast, clouds, smoke, propeller wash, birds, sky, rain) asks this on each
// animation frame whether to move, and all of them get the same answer for the
// same frame (every callback of a frame is given the same timestamp), so they
// change the picture together, about 30 times a second. Each moving on frames
// of its own made the browser build the whole scene on every frame, 60 or 120
// times a second, which was most of the game's CPU. The motion is slow (the sea
// crosses the screen at 6-20 px a second), and 30 updates show it as smoothly.
(function (RBV) {
  const SCENE_FRAME_MS = 30;
  let decidedFor = null;
  let open = false;
  let lastOpen = -Infinity;
  RBV.sceneFrame = function (now) {
    if (now !== decidedFor) {
      decidedFor = now;
      open = now - lastOpen >= SCENE_FRAME_MS || now < lastOpen;
      if (open) lastOpen = now;
    }
    return open;
  };
})(window.RBV);
