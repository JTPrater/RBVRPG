const fs = require("fs");
const path = require("path");

let menuByKey = null;

function menuItemKey(item) {
  return `${item.topCategory}|${item.subCategory}|${item.name}`;
}

function loadMenuCatalog() {
  if (menuByKey) {
    return menuByKey;
  }

  const filePath = path.join(__dirname, "../public/game/menuData.js");
  const source = fs.readFileSync(filePath, "utf8");
  const MENU_DATA = new Function(`${source}\nreturn MENU_DATA;`)();

  menuByKey = new Map();
  for (const item of MENU_DATA) {
    menuByKey.set(menuItemKey(item), item);
  }

  return menuByKey;
}

function lookupMenuItem({ itemKey, topCategory, subCategory, name }) {
  const catalog = loadMenuCatalog();
  if (itemKey) {
    return catalog.get(itemKey) || null;
  }
  if (topCategory && subCategory && name) {
    return catalog.get(`${topCategory}|${subCategory}|${name}`) || null;
  }
  return null;
}

module.exports = {
  menuItemKey,
  loadMenuCatalog,
  lookupMenuItem,
};
