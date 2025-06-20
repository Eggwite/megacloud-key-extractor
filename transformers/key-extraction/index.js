/**
 * Key Extraction Module
 *
 * This module provides a comprehensive key extraction system for obfuscated JavaScript.
 * It's organized into logical components for better maintainability and debugging.
 *
 * Usage:
 *   import { findAndExtractKeyPlugin } from './key-extraction/index.js';
 *
 * Configuration:
 *   To enable debug logging, modify ./config/debug.js
 */

// Main plugin export
export { findAndExtractKeyPlugin } from './core/keyExtractionPlugin.js';

// Debug configuration (for external configuration)
export { DEBUG_CONFIG, debugLoggers } from './config/debug.js';

// Utility exports (for external use or testing)
export { validateKey, validateConcatenatedKey } from './validators/keyValidator.js';
export { printResults, createExtractionSummary } from './utils/extractionUtils.js';

// Collector exports (for external use or testing)
export { ArrayCollector } from './collectors/arrayCollector.js';
export { SegmentFunctionCollector } from './collectors/segmentFunctionCollector.js';

// Extractor exports (for external use or testing)
export { ArrayJoinExtractor } from './extractors/arrayJoinExtractor.js';
export { FunctionKeyExtractor } from './extractors/functionKeyExtractor.js';
export { ConcatenatedKeyExtractor } from './extractors/concatenatedKeyExtractor.js';
export { default as FromCharCodeExtractor } from './extractors/fromCharCodeExtractor.js';
