/**
 * Refactored Key Extraction Plugin
 *
 * This plugin extracts AES keys from obfuscated JavaScript code using multiple patterns:
 * - Array.join() patterns
 * - String.fromCharCode() patterns
 * - Concatenated function calls
 * - Indexed array mapping
 *
 * The plugin is organized into modular components for better maintainability.
 */

import { debugLoggers } from '../config/debug.js';
import { ArrayCollector } from '../collectors/arrayCollector.js';
import { SegmentFunctionCollector } from '../collectors/segmentFunctionCollector.js';
import { ArrayJoinExtractor } from '../extractors/arrayJoinExtractor.js';
import { FunctionKeyExtractor } from '../extractors/functionKeyExtractor.js';
import createFromCharCodeExtractor from '../extractors/fromCharCodeExtractor.js';
import createSliceExtractor from '../extractors/sliceExtractor.js';
import { printResults, createExtractionSummary } from '../utils/extractionUtils.js';
import { debug } from '../../centralDebug.js';

/**
 * Logs the results of the collection phases
 */
function logCollectionResults(segmentFunctionsMap, potentialKeyArrays) {
  const assemblerDebug = debugLoggers.assemblerLogic;
  const arrayDebug = debugLoggers.arrayJoin;

  debug.log('\n--- Collection Phase Results ---');

  const mapKeys = Object.keys(segmentFunctionsMap);
  debug.log(`Segment functions collected: ${mapKeys.length}`);

  if (mapKeys.length > 0) {
    assemblerDebug.log('Available segment keys:', mapKeys.join(', '));
  } else {
    debug.log('No segment functions available for key extraction.');
  }

  const arrayKeys = Object.keys(potentialKeyArrays);
  debug.log(`Potential key arrays collected: ${arrayKeys.length}`);

  if (arrayKeys.length > 0) {
    arrayDebug.log('Available array keys:', arrayKeys.join(', '));
  }
}

// Helper to find a string literal initializer for a variable in the current or parent scope
function findStringDeclarationValue(path, varName, t) {
  const binding = path.scope.getBinding(varName);
  if (!binding) {
    return null;
  }

  let lastAssignedValue = null;
  let lastAssignmentPath = null;

  // Check the initial declaration
  if (binding.path.isVariableDeclarator() && t.isStringLiteral(binding.path.node.init)) {
    lastAssignedValue = binding.path.node.init.value;
    lastAssignmentPath = binding.path;
  }

  // Check all constant violations (assignments)
  for (const assignmentPath of binding.constantViolations) {
    // We only care about assignments that happen before the current path
    if (assignmentPath.node.start < path.node.start) {
      if (assignmentPath.isAssignmentExpression() && assignmentPath.get('right').isStringLiteral()) {
        // If this is the first assignment we've seen, or it's later than the last one
        if (!lastAssignmentPath || assignmentPath.node.start > lastAssignmentPath.node.start) {
          lastAssignedValue = assignmentPath.get('right').node.value;
          lastAssignmentPath = assignmentPath;
        }
      }
    }
  }

  return lastAssignedValue;
}

// Helper to handle reversed string calls like: j.split('').reverse().join('')
function resolveReversedStringCall(callNode, path, t) {
  const isMemberProperty = (node, name) => {
    if (!t.isMemberExpression(node)) return false;
    const prop = node.property;
    if (node.computed && t.isStringLiteral(prop)) {
      return prop.value === name;
    }
    if (!node.computed && t.isIdentifier(prop)) {
      return prop.name === name;
    }
    return false;
  };

  // Must match callNode of form .join('') on .reverse() on .split('')
  if (!t.isCallExpression(callNode) || !t.isStringLiteral(callNode.arguments[0], { value: '' })) return null;

  const joinCallee = callNode.callee;
  if (!isMemberProperty(joinCallee, 'join')) return null;

  const reverseCall = joinCallee.object;
  if (!t.isCallExpression(reverseCall) || reverseCall.arguments.length > 0) return null;
  const reverseCallee = reverseCall.callee;
  if (!isMemberProperty(reverseCallee, 'reverse')) return null;

  const splitCall = reverseCallee.object;
  if (!t.isCallExpression(splitCall)) return null;
  const splitCallee = splitCall.callee;
  if (!isMemberProperty(splitCallee, 'split') || !t.isStringLiteral(splitCall.arguments[0], { value: '' })) return null;

  // The source is e.g. j in j.split('').reverse().join('')
  if (!t.isIdentifier(splitCallee.object)) return null;
  const baseId = splitCallee.object.name;
  // Attempt to find the string literal for that variable
  const strVal = findStringDeclarationValue(path, baseId, t);
  if (!strVal) return null;
  return strVal.split('').reverse().join('');
}

// Helper to resolve function calls with conditional logic
function resolveConditionalFunctionCall(funcNode, path, t) {
  if (!funcNode || !t.isFunction(funcNode) || !funcNode.body) return null;

  let resolvedValue = null;
  const funcPath = path.get('init'); // path is the VariableDeclarator path

  // If the function body exists, traverse it to find the return statement
  if (funcPath.has('body')) {
    funcPath.get('body').traverse({
      ReturnStatement(returnPath) {
        // If we've already found the key, stop searching
        if (resolvedValue) {
          returnPath.stop();
          return;
        }

        const arg = returnPath.node.argument;
        if (t.isCallExpression(arg)) {
          const reversedVal = resolveReversedStringCall(arg, returnPath, t);
          if (reversedVal) {
            resolvedValue = reversedVal;
            returnPath.stop(); // Stop traversal once the key is found
          }
        }
      }
    });
  }

  return resolvedValue;
}

/**
 * Main Key Extraction Plugin
 * @param {Object} api - Babel API object
 * @returns {Object} Babel plugin configuration
 */
export const findAndExtractKeyPlugin = api => {
  const { types: t } = api;
  const FIND_ALL_CANDIDATES = true;

  const isMemberProperty = (node, name) => {
    if (!t.isMemberExpression(node)) return false;
    const prop = node.property;
    if (node.computed && t.isStringLiteral(prop)) {
      return prop.value === name;
    }
    if (!node.computed && t.isIdentifier(prop)) {
      return prop.name === name;
    }
    return false;
  };

  const resolveFunctionNodeToStringLiteral = funcNode => {
    if (!funcNode || !t.isFunction(funcNode) || !funcNode.body) {
      return null;
    }
    const body = funcNode.body;
    if (t.isStringLiteral(body)) {
      return body;
    }
    if (!t.isBlockStatement(body)) {
      return null;
    }
    let resolvedValue = null;
    const findReturn = node => {
      if (t.isReturnStatement(node)) {
        const arg = node.argument;
        if (t.isStringLiteral(arg)) {
          resolvedValue = arg;
          return true;
        }
        // Check for reversed string calls
        if (t.isCallExpression(arg)) {
          const reversedVal = resolveReversedStringCall(arg, thisPath, t);
          if (reversedVal) {
            resolvedValue = t.stringLiteral(reversedVal);
            return true;
          }
        }
        if (t.isBinaryExpression(arg)) {
          const combined = resolveBinaryExpression(arg, t);
          if (combined !== null) {
            resolvedValue = t.stringLiteral(combined);
            return true;
          }
        }
      } else if (t.isBlockStatement(node)) {
        for (const stmt of node.body) {
          if (findReturn(stmt)) return true;
        }
      } else if (t.isIfStatement(node)) {
        if (findReturn(node.consequent)) return true;
        if (node.alternate && findReturn(node.alternate)) return true;
      }
      return false;
    };
    findReturn(body);
    return resolvedValue;
  };

  // Add helper to resolve string concatenations in return statements
  const resolveBinaryExpression = (expr, t) => {
    if (!t.isBinaryExpression(expr) || expr.operator !== '+') return null;
    const resolveSide = side => {
      if (t.isBinaryExpression(side)) return resolveBinaryExpression(side, t);
      if (t.isStringLiteral(side)) return side.value;
      return null;
    };
    const left = resolveSide(expr.left);
    const right = resolveSide(expr.right);
    return left != null && right != null ? left + right : null;
  };

  /**
   * Traverses a function path to find a returned string literal.
   * This is a simplification and may not handle all cases.
   * @param {import('@babel/core').NodePath} funcPath - The path to the function node.
   * @returns {t.StringLiteral|null} The string literal node if found, otherwise null.
   */
  const resolveFunctionToStringLiteral = (funcPath, t) => {
    if (!funcPath || !funcPath.isFunction() || !funcPath.node.body) {
      return null;
    }

    const body = funcPath.get('body');

    // Handle implicit return for arrow functions
    if (body.isStringLiteral()) {
      return body.node;
    }

    if (!body.isBlockStatement()) {
      return null;
    }

    let resolvedValue = null;

    const findReturnRecursive = blockPath => {
      if (!blockPath.isBlockStatement()) return false;

      for (const stmtPath of blockPath.get('body')) {
        if (stmtPath.isReturnStatement()) {
          const argPath = stmtPath.get('argument');
          if (argPath.isStringLiteral()) {
            resolvedValue = argPath.node;
            return true;
          }
          if (argPath.isCallExpression()) {
            const reversedVal = resolveReversedStringCall(argPath.node, stmtPath, t);
            if (reversedVal) {
              resolvedValue = t.stringLiteral(reversedVal);
              return true;
            }
          }
          if (argPath.isBinaryExpression()) {
            const combined = resolveBinaryExpression(argPath.node, t);
            if (combined !== null) {
              resolvedValue = t.stringLiteral(combined);
              return true;
            }
          }
        }
        if (stmtPath.isIfStatement()) {
          if (findReturnRecursive(stmtPath.get('consequent'))) return true;
          const alternate = stmtPath.get('alternate');
          if (alternate.node && findReturnRecursive(alternate)) return true;
        }
      }
      return false; // Not found in this block
    };

    findReturnRecursive(body);
    return resolvedValue;
  };

  // Helper to analyze the callback function of an Array.prototype.map() call
  const analyzeMapCallback = (funcPath, t) => {
    if (!funcPath.isFunction()) {
      // Not a function, can't analyze
      return { usesParameter: true };
    }

    const param = funcPath.node.params[0];
    // If there's no parameter, it's definitely not using it.
    if (!param) {
      return { usesParameter: false };
    }

    // Check if the parameter is referenced in the function body.
    const binding = funcPath.scope.getBinding(param.name);
    return { usesParameter: binding.referenced };
  };

  return {
    visitor: {
      Program(programPath, state) {
        const performanceLogger = debugLoggers.performance;
        performanceLogger.time('Key Extraction Time');

        // Pass resolver to other visitors via state
        state.resolveFunctionNodeToStringLiteral = resolveFunctionNodeToStringLiteral;

        // Initialize result containers
        let foundKeys = [];
        let nonHexCandidates = [];
        let wrongLengthCandidates = [];

        // Initialize collection containers (used for summary)
        let segmentFunctionsMap = {};
        let potentialKeyArrays = {};

        // --- DIRECT SCAN: Find the specific reversed string AES key pattern ---
        debug.log('--- Starting Direct Scan: Looking for Common Key Patterns ---');

        // Cache for found string literals to avoid duplicate processing
        const stringLiterals = new Map();

        // First pass: collect all string literals that look like potential keys
        programPath.traverse({
          VariableDeclarator(path) {
            if (t.isStringLiteral(path.node.init)) {
              const value = path.node.init.value;
              if (/^[0-9a-f]+$/i.test(value) && (value.length === 32 || value.length === 64)) {
                debug.log(`Found potential key string in variable ${path.node.id.name}:`, value);
                stringLiterals.set(path.node.id.name, value);
              }
            }
          },
          AssignmentExpression(path) {
            if (t.isIdentifier(path.node.left) && t.isStringLiteral(path.node.right)) {
              const value = path.node.right.value;
              if (/^[0-9a-f]+$/i.test(value) && (value.length === 32 || value.length === 64)) {
                debug.log(`Found potential key string in assignment to ${path.node.left.name}:`, value);
                stringLiterals.set(path.node.left.name, value);
              }
            }
          }
        });

        // Second pass: find reversed string patterns using collected variables
        programPath.traverse({
          ReturnStatement(path) {
            const arg = path.node.argument;
            // Check for the typical reverse pattern: <var>["split"]("")["reverse"]()["join"]("")
            if (!t.isCallExpression(arg)) return;

            const joinCallee = arg.callee;
            if (!isMemberProperty(joinCallee, 'join')) return;

            const reverseCall = joinCallee.object;
            if (!t.isCallExpression(reverseCall) || reverseCall.arguments.length > 0) return;

            const reverseCallee = reverseCall.callee;
            if (!isMemberProperty(reverseCallee, 'reverse')) return;

            const splitCall = reverseCallee.object;
            if (!t.isCallExpression(splitCall)) return;

            const splitCallee = splitCall.callee;
            if (!isMemberProperty(splitCallee, 'split')) return;

            // Get the variable being reversed (e.g., j in j.split().reverse().join())
            const varNode = splitCallee.object;

            if (t.isIdentifier(varNode) && stringLiterals.has(varNode.name)) {
              const originalValue = stringLiterals.get(varNode.name);
              const reversedValue = originalValue.split('').reverse().join('');
              debug.log(`Found reversed key: ${originalValue} -> ${reversedValue}`);

              // Add to found keys if valid hex string and valid key length
              if (/^[0-9a-f]+$/i.test(reversedValue)) {
                if (reversedValue.length === 32 || reversedValue.length === 64) {
                  foundKeys.push(reversedValue);
                } else {
                  wrongLengthCandidates.push(reversedValue);
                }
              } else {
                nonHexCandidates.push(reversedValue);
              }
            }
          }
        });

        // --- Third pass: inspect all function‐valued var declarations for reversed‐key patterns ---
        programPath.traverse({
          VariableDeclarator(path) {
            const init = path.node.init;
            if (t.isFunctionExpression(init) || t.isArrowFunctionExpression(init)) {
              const val = resolveConditionalFunctionCall(init, path, t);
              if (val) {
                debug.log(`Found key via function var ${path.node.id.name}:`, val);
                foundKeys.push(val);
              }
            }
          }
        });

        // --- Continue with regular extraction if direct scan didn't find keys ---
        if (foundKeys.length === 0) {
          debug.log('No keys found with direct scan, continuing with standard extraction...');

          // --- Pass 1: Collect Object Property Assignments & Aliases---
          const objectPropertiesMap = {};
          const aliasMap = {};

          programPath.traverse({
            VariableDeclarator(path) {
              const t = api.types;
              // Collect object literals `a8 = { ... }`
              if (t.isObjectExpression(path.node.init)) {
                const objName = path.node.id.name;
                objectPropertiesMap[objName] = objectPropertiesMap[objName] || {};
                const propertiesPaths = path.get('init.properties');
                for (const propPath of propertiesPaths) {
                  const prop = propPath.node;
                  if (t.isObjectProperty(prop) && (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key))) {
                    const propName = t.isStringLiteral(prop.key) ? prop.key.value : prop.key.name;
                    const valuePath = propPath.get('value');
                    if (valuePath.isFunction()) {
                      objectPropertiesMap[objName][propName] = valuePath.node;
                    } else {
                      const resolved = resolveFunctionToStringLiteral(valuePath, t);
                      objectPropertiesMap[objName][propName] = resolved || valuePath.node;
                    }
                  } else if (t.isObjectMethod(prop) && (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key))) {
                    const propName = t.isStringLiteral(prop.key) ? prop.key.value : prop.key.name;
                    objectPropertiesMap[objName][propName] = prop;
                  }
                }
                debugLoggers.assemblerLogic.log(
                  `Collected object properties for: ${objName}`,
                  objectPropertiesMap[objName]
                );
              }
              // Collect aliases `z = a8`
              if (t.isIdentifier(path.node.init)) {
                const aliasName = path.node.id.name;
                const originalName = path.node.init.name;
                aliasMap[aliasName] = originalName;
              }
            },
            ExpressionStatement(path) {
              const t = api.types;
              const expr = path.node.expression;
              if (!t.isAssignmentExpression(expr)) return;

              // Handles assignments like b3["b"] = function() {...} or b3.b = function() {...}
              if (
                t.isMemberExpression(expr.left) &&
                t.isIdentifier(expr.left.object) &&
                (t.isStringLiteral(expr.left.property) || t.isIdentifier(expr.left.property))
              ) {
                const objName = expr.left.object.name;
                const propName = t.isStringLiteral(expr.left.property)
                  ? expr.left.property.value
                  : expr.left.property.name;
                objectPropertiesMap[objName] = objectPropertiesMap[objName] || {};
                const valuePath = path.get('expression.right');
                if (valuePath.isFunction()) {
                  objectPropertiesMap[objName][propName] = valuePath.node;
                } else {
                  const resolved = resolveFunctionToStringLiteral(valuePath, t);
                  objectPropertiesMap[objName][propName] = resolved || valuePath.node;
                }
                debugLoggers.assemblerLogic.log(`Collected assigned property: ${objName}.${propName}`);
              }
              // Handle S = b3 (alias assignment)
              else if (t.isIdentifier(expr.left) && t.isIdentifier(expr.right)) {
                aliasMap[expr.left.name] = expr.right.name;
                debugLoggers.assemblerLogic.log(`Collected alias (assignment): ${expr.left.name} = ${expr.right.name}`);
              }
              // Handle b3 = {} (object assignment)
              else if (t.isIdentifier(expr.left) && t.isObjectExpression(expr.right)) {
                const objName = expr.left.name;
                objectPropertiesMap[objName] = objectPropertiesMap[objName] || {};
                const propertiesPaths = path.get('expression.right.properties');
                for (const propPath of propertiesPaths) {
                  const prop = propPath.node;
                  if (t.isObjectProperty(prop) && (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key))) {
                    const propName = t.isStringLiteral(prop.key) ? prop.key.value : prop.key.name;
                    const valuePath = propPath.get('value');
                    if (valuePath.isFunction()) {
                      objectPropertiesMap[objName][propName] = valuePath.node;
                    } else {
                      const resolved = resolveFunctionToStringLiteral(valuePath, t);
                      objectPropertiesMap[objName][propName] = resolved || valuePath.node;
                    }
                  } else if (t.isObjectMethod(prop) && (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key))) {
                    const propName = t.isStringLiteral(prop.key) ? prop.key.value : prop.key.name;
                    objectPropertiesMap[objName][propName] = prop;
                  }
                }
              }
            }
          });

          // Post-process to merge properties from aliased objects
          const resolveAlias = name => {
            let currentName = name;
            const seen = new Set();
            while (aliasMap[currentName]) {
              if (seen.has(currentName)) break; // circular
              seen.add(currentName);
              currentName = aliasMap[currentName];
            }
            return currentName;
          };

          for (const aliasName in aliasMap) {
            const originalName = resolveAlias(aliasName);
            if (objectPropertiesMap[aliasName]) {
              if (!objectPropertiesMap[originalName]) {
                objectPropertiesMap[originalName] = {};
              }
              debugLoggers.assemblerLogic.log(`Merging properties from alias '${aliasName}' into '${originalName}'`);
              Object.assign(objectPropertiesMap[originalName], objectPropertiesMap[aliasName]);
              delete objectPropertiesMap[aliasName];
            }
          }

          // --- Pass 2: Collect Segment Functions & Key Arrays ---
          debug.log('--- Starting Pass 2: Collecting Functions and Arrays ---');

          // Collect all potential key arrays
          const arrayCollector = new ArrayCollector();
          arrayCollector.setTypes(t);
          programPath.traverse(arrayCollector.createVisitor());
          potentialKeyArrays = arrayCollector.getArrays();

          // Collect all segment functions
          const segmentFunctionCollector = new SegmentFunctionCollector();
          segmentFunctionCollector.setTypes(t);
          programPath.traverse(segmentFunctionCollector.createVisitor());
          segmentFunctionsMap = segmentFunctionCollector.getFunctions();

          logCollectionResults(segmentFunctionsMap, potentialKeyArrays);

          // PASS 3: Extract keys using various patterns
          debug.log('--- Starting Pass 3: Key Extraction ---');
          const functionKeyExtractor = new FunctionKeyExtractor(segmentFunctionsMap);
          const arrayJoinExtractor = new ArrayJoinExtractor(potentialKeyArrays);
          const fromCharCodeExtractor = createFromCharCodeExtractor(foundKeys, nonHexCandidates, wrongLengthCandidates);
          const sliceExtractor = createSliceExtractor(foundKeys, nonHexCandidates, wrongLengthCandidates);

          // --- Configure Extractors ---
          functionKeyExtractor.setTypes(api.types);
          functionKeyExtractor.setObjectPropertiesMap(objectPropertiesMap);
          functionKeyExtractor.setAliasMap(aliasMap); // Pass the alias map
          arrayJoinExtractor.setTypes(api.types);

          // --- Run Key Extraction Visitors ---
          programPath.traverse({
            // Visitor for array-based keys (e.g., [...].join(''))
            CallExpression: arrayJoinExtractor.createCallExpressionHandler(
              foundKeys,
              nonHexCandidates,
              wrongLengthCandidates,
              FIND_ALL_CANDIDATES
            ),
            // Visitor for function-based keys (e.g., a(1) + a(2)) - includes concatenated keys
            ...functionKeyExtractor.createVisitors(
              foundKeys,
              nonHexCandidates,
              wrongLengthCandidates,
              FIND_ALL_CANDIDATES
            ),
            // Visitor for fromCharCode patterns
            ...fromCharCodeExtractor,
            // Visitor for slice patterns
            ...sliceExtractor
          });
        } else {
          debug.log(`Direct scan found ${foundKeys.length} keys, skipping standard extraction.`);
          // No need to initialize here as we did at the top level
        }

        // Print results
        printResults(foundKeys, nonHexCandidates, wrongLengthCandidates, FIND_ALL_CANDIDATES);

        // Log summary statistics
        const summary = createExtractionSummary(
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates,
          segmentFunctionsMap,
          potentialKeyArrays
        );

        debugLoggers.performance.log('Extraction Summary:', summary);
        performanceLogger.timeEnd('Key Extraction Time');
      }
    }
  };
};
