const assert = require("assert");
const { lookupMenuItem, menuItemKey } = require("../lib/menuCatalog");

const beer = lookupMenuItem({
  topCategory: "alcoholic_beverages",
  subCategory: "beer",
  name: "Beer",
});

assert.ok(beer, "Beer should exist in menu catalog");
assert.strictEqual(beer.price, 0.35);

const key = menuItemKey(beer);
const byKey = lookupMenuItem({ itemKey: key });
assert.strictEqual(byKey.name, "Beer");

const missing = lookupMenuItem({
  topCategory: "food",
  subCategory: "fruit",
  name: "Not A Real Item",
});
assert.strictEqual(missing, null);

console.log("menuCatalog.test.js: all assertions passed");
