import { debugLoggers } from "../config/debug.js";

/**
 * Utility functions for key extraction
 */

/**
 * Checks if a key already exists in the found keys array
 * @param {Array} foundKeys - Array of found keys
 * @param {string} key - Key to check
 * @param {string} type - Type of key
 * @returns {boolean} True if key exists
 */
export function keyExists(foundKeys, key, type) {
  return foundKeys.some((fk) => fk.key === key && fk.type === type);
}

/**
 * Prints the results of key extraction
 * @param {Array} foundKeys - Array of found keys
 * @param {Array} nonHexCandidates - Array of non-hex candidates
 * @param {Array} wrongLengthCandidates - Array of wrong length candidates
 * @param {boolean} findAllCandidates - Whether all candidates were searched
 */
export function printResults(
  foundKeys,
  nonHexCandidates,
  wrongLengthCandidates,
  findAllCandidates
) {
  const debug = debugLoggers.performance;

  if (foundKeys.length > 0) {
    if (findAllCandidates || foundKeys.length === 1) {
      debug.log(`--- Found ${foundKeys.length} Potential AES Key(s) ---`);
      foundKeys.forEach((item, idx) => {
        debug.log(`\n--- Candidate Key ${idx + 1} ---`);
        debug.log("Derived Key:", item.key);
        console.log(item.key);
        if (item.segments) {
          debug.log("Involved Segments:", item.segments.join(", "));
        }
        if (item.source) {
          debug.log("Source:", item.source);
        }
        debug.log("Key Type:", item.type);
      });
    } else {
      debug.log(
        `--- Found ${foundKeys.length} Potential AES Keys (not all candidates shown) ---`
      );
    }
  } else {
    debug.log("--- AES Key Not Found ---");
  }

  // Print debug information about failed candidates if debug is enabled
  if (nonHexCandidates.length > 0) {
    debug.log(`Found ${nonHexCandidates.length} non-hex candidates`);
  }

  if (wrongLengthCandidates.length > 0) {
    debug.log(`Found ${wrongLengthCandidates.length} wrong-length candidates`);
  }
}

/**
 * Validates function parameters for segment function extraction
 * @param {Object} funcNode - Function AST node
 * @param {Array} params - Function parameters
 * @returns {boolean} True if parameters are valid for processing
 */
export function isValidFunctionForProcessing(funcNode, params) {
  // Skip functions with complex parameter patterns that might not be segment functions
  if (!params || params.length > 1) return false;

  // Skip if function has complex structure that's unlikely to be a simple segment function
  if (funcNode.async || funcNode.generator) return false;

  return true;
}

/**
 * Sanitizes debug output to prevent extremely long logs
 * @param {string} str - String to sanitize
 * @param {number} maxLength - Maximum length (default 200)
 * @returns {string} Sanitized string
 */
export function sanitizeDebugString(str, maxLength = 200) {
  if (typeof str !== "string") return String(str);

  if (str.length <= maxLength) return str;

  return str.substring(0, maxLength) + "... (truncated)";
}

/**
 * Creates a summary of extraction statistics
 * @param {Array} foundKeys - Array of found keys
 * @param {Array} nonHexCandidates - Array of non-hex candidates
 * @param {Array} wrongLengthCandidates - Array of wrong length candidates
 * @param {Object} segmentFunctionsMap - Map of segment functions
 * @param {Object} potentialKeyArrays - Map of potential key arrays
 * @returns {Object} Statistics summary
 */
export function createExtractionSummary(
  foundKeys,
  nonHexCandidates,
  wrongLengthCandidates,
  segmentFunctionsMap,
  potentialKeyArrays
) {
  return {
    foundKeys: foundKeys.length,
    nonHexCandidates: nonHexCandidates.length,
    wrongLengthCandidates: wrongLengthCandidates.length,
    segmentFunctions: Object.keys(segmentFunctionsMap).length,
    potentialArrays: Object.keys(potentialKeyArrays).length,
    keyTypes: [...new Set(foundKeys.map((k) => k.type))],
  };
}
