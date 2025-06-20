/**
 * Debug configuration for key extraction
 */

export const DEBUG_CONFIG = {
  // Enable/disable all debug logs
  ENABLED: false,

  // Specific debug categories
  SEGMENT_FUNCTIONS: true,
  ASSEMBLER_LOGIC: true,
  ARRAY_JOIN: true,
  CHAR_CODE: true,
  VALIDATION: true,
  PERFORMANCE: true
};

/**
 * Debug logger utility
 */
export class DebugLogger {
  constructor(category) {
    this.category = category;
  }

  log(...args) {
    if (DEBUG_CONFIG.ENABLED && DEBUG_CONFIG[this.category]) {
      console.log(`[Debug ${this.category}]`, ...args);
    }
  }

  time(label) {
    if (DEBUG_CONFIG.ENABLED && DEBUG_CONFIG.PERFORMANCE) {
      console.time(label);
    }
  }

  timeEnd(label) {
    if (DEBUG_CONFIG.ENABLED && DEBUG_CONFIG.PERFORMANCE) {
      console.timeEnd(label);
    }
  }
}

// Pre-configured loggers for different categories
export const debugLoggers = {
  segmentFunctions: new DebugLogger('SEGMENT_FUNCTIONS'),
  assemblerLogic: new DebugLogger('ASSEMBLER_LOGIC'),
  arrayJoin: new DebugLogger('ARRAY_JOIN'),
  charCode: new DebugLogger('CHAR_CODE'),
  validation: new DebugLogger('VALIDATION'),
  performance: new DebugLogger('PERFORMANCE')
};
