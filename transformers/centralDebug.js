// Centralized DEBUG utility for logging
// Replace all direct console.log/warn/error calls with these for easy control

let DEBUG = false; // Toggle this variable to enable/disable logs

export const setDebug = (value) => {
  DEBUG = value;
};

export const log = (...args) => {
  if (DEBUG) console.log(...args);
};

export const warn = (...args) => {
  if (DEBUG) console.warn(...args);
};

export const error = (...args) => {
  if (DEBUG) console.error(...args);
};

export const debug = {
  log,
  warn,
  error,
};
