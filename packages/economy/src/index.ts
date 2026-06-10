/**
 * @trash-wars/economy — pure, isomorphic economy math for Trash Wars.
 * Everything exported here (except the sim runner, which is also pure) is safe
 * to import from both the backend and the in-browser demo client.
 */
export * from "./rng.js";
export * from "./resolve.js";
export * from "./config/season1.js";
export * from "./sim/types.js";
export { PD_ACTIVATION_DAY, runSim } from "./sim/engine.js";
export { renderCsv, renderMarkdown } from "./sim/report.js";
