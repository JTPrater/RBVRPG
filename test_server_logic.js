/**
 * @deprecated Use `npm test` (test/voyageState.test.js) instead.
 */
const { getCurrentVoyageState } = require("./lib/voyageState");

const voyageStartTime = Date.now();
const state = getCurrentVoyageState(voyageStartTime);
console.log(JSON.stringify(state, null, 2));
