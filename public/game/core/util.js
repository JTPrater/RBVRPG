(function (RBV) {
  function createSeededRng(seed) {
    let s = seed | 0;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function menuItemKey(item) {
    return `${item.topCategory}|${item.subCategory}|${item.name}`;
  }

  RBV.util = { createSeededRng, menuItemKey };
  window.createSeededRng = createSeededRng;
  window.menuItemKey = menuItemKey;
})(window.RBV);
