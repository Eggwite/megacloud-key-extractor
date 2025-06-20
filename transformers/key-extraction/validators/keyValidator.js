/**
 * Key validation utilities
 */

const VALID_KEY_LENGTHS = [16, 24, 32, 48, 51, 64];
//I saw that some services used different key lengths, but not certain if anything other than 64 is valid.

/**
 * Validates a potential AES key
 * @param {string} keyString - The key string to validate
 * @param {string} sourceName - Name of the source for debugging
 * @param {string} type - Type of key extraction method
 * @returns {Object|null} Validation result
 */
export function validateKey(keyString, sourceName, type = 'unknown') {
  const isHex = /^[0-9a-fA-F]*$/.test(keyString);
  const isValidLength = VALID_KEY_LENGTHS.includes(keyString.length);

  if (isValidLength) {
    if (isHex) {
      return {
        isValidKey: true,
        key: keyString,
        source: sourceName,
        type: type
      };
    } else {
      return {
        isNonHex: true,
        key: keyString,
        source: sourceName,
        type: type
      };
    }
  } else {
    return {
      isWrongLength: true,
      key: keyString,
      source: sourceName,
      type: type,
      actualLength: keyString.length,
      expectedLength: VALID_KEY_LENGTHS
    };
  }
}

/**
 * Validates a concatenated key from function segments
 * @param {string} concatenatedString - The concatenated string
 * @param {string} assemblerFuncName - Name of the assembler function
 * @param {Array} involvedSegmentFuncs - Array of involved segment function names
 * @returns {Object|null} Validation result
 */
export function validateConcatenatedKey(concatenatedString, assemblerFuncName, involvedSegmentFuncs) {
  if (!concatenatedString) return null;

  const isHex = /^[0-9a-fA-F]*$/.test(concatenatedString);
  const isValidLength = VALID_KEY_LENGTHS.includes(concatenatedString.length);

  if (isValidLength) {
    if (isHex) {
      return {
        isValidKey: true,
        key: concatenatedString,
        segments: involvedSegmentFuncs,
        type: 'concatenated_functions',
        source: assemblerFuncName
      };
    } else {
      return {
        isNonHex: true,
        key: concatenatedString,
        segments: involvedSegmentFuncs,
        type: 'concatenated_functions',
        source: assemblerFuncName
      };
    }
  } else {
    return {
      isWrongLength: true,
      key: concatenatedString,
      segments: involvedSegmentFuncs,
      type: 'concatenated_functions',
      source: assemblerFuncName,
      actualLength: concatenatedString.length,
      expectedLength: VALID_KEY_LENGTHS
    };
  }
}
