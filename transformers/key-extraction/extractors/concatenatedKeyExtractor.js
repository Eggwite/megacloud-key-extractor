import { debugLoggers } from '../config/debug.js';
import { validateConcatenatedKey } from '../validators/keyValidator.js';

/**
 * Handles the extraction of concatenated keys from function calls
 */
export class ConcatenatedKeyExtractor {
  constructor(segmentFunctionsMap) {
    this.segmentFunctionsMap = segmentFunctionsMap;
    this.debug = debugLoggers.assemblerLogic;
  }

  setTypes(t) {
    this.t = t;
  }

  setObjectPropertiesMap(objectPropertiesMap) {
    this.objectPropertiesMap = objectPropertiesMap;
  }

  // New method to set the alias map
  setAliasMap(aliasMap) {
    this.aliasMap = aliasMap;
  }

  // New helper to find string literal return, checking inside IfStatements
  _findStringReturnInBlock(blockNode) {
    const t = this.t;
    if (!blockNode || !t.isBlockStatement(blockNode)) {
      return null;
    }
    for (const stmt of blockNode.body) {
      if (t.isReturnStatement(stmt) && t.isStringLiteral(stmt.argument)) {
        this.debug.log(`_findStringReturnInBlock: Found direct return: ${stmt.argument.value}`);
        return stmt.argument.value;
      }
      if (t.isIfStatement(stmt)) {
        this.debug.log('_findStringReturnInBlock: Checking IfStatement consequent.');
        let returned = this._findStringReturnInBlock(stmt.consequent);
        if (returned) return returned;
        if (stmt.alternate) {
          this.debug.log('_findStringReturnInBlock: Checking IfStatement alternate.');
          returned = this._findStringReturnInBlock(stmt.alternate);
          if (returned) return returned;
        }
      }
    }
    return null;
  }

  // New helper to resolve object names using the alias map
  resolveObjectName(name) {
    const seen = new Set();
    let currentName = name;
    while (this.aliasMap && this.aliasMap[currentName]) {
      if (seen.has(currentName)) {
        this.debug.log(`Circular alias reference detected for '${name}'`);
        return name; // Return original name to avoid infinite loop
      }
      seen.add(currentName);
      currentName = this.aliasMap[currentName];
    }

    if (name !== currentName) {
      this.debug.log(`Resolved alias '${name}' to '${currentName}'`);
    }
    return currentName;
  }

  /**
   * Derives and validates keys from concatenated function calls
   * @param {Object} returnArgumentNode - The AST node to analyze
   * @param {string} assemblerFuncName - Name of the assembler function
   * @returns {Object|null} Validation result
   */
  deriveAndValidate(returnArgumentNode, assemblerFuncName) {
    const t = this.t;

    this.debug.log(
      `ENTER deriveAndValidate for ${assemblerFuncName}. Arg type: ${
        returnArgumentNode ? returnArgumentNode.type : 'N/A'
      }${
        returnArgumentNode && returnArgumentNode.type === 'BinaryExpression'
          ? `, Operator: '${returnArgumentNode.operator}'`
          : ''
      }`
    );

    let concatenatedString = '';
    let isProcessed = false;
    let involvedSegmentFuncs = [];

    // Handle binary expressions (+ or | operators)
    if (
      returnArgumentNode &&
      t.isBinaryExpression(returnArgumentNode) &&
      (returnArgumentNode.operator === '+' || returnArgumentNode.operator === '|')
    ) {
      isProcessed = true;
      this.debug.log(
        `${assemblerFuncName}: Arg IS BinaryExpression with '${returnArgumentNode.operator}' operator. Processing...`
      );

      const stringParts = this.flattenConcatenation(returnArgumentNode, assemblerFuncName, t);
      if (stringParts.some(p => p === undefined || p === null)) {
        this.debug.log(
          `${assemblerFuncName} (BinaryExpr '${
            returnArgumentNode.operator
          }'): flattenConcatenation returned parts with undefined/null: ${JSON.stringify(stringParts)}`
        );
        concatenatedString = null;
      } else {
        concatenatedString = stringParts.join('');
        involvedSegmentFuncs = this.getInvolvedSegments(stringParts);
        this.debug.log(
          `${assemblerFuncName} (BinaryExpr '${returnArgumentNode.operator}'): successfully joined parts: '${concatenatedString}'`
        );
      }
    }
    // Handle call expressions
    else if (returnArgumentNode && t.isCallExpression(returnArgumentNode)) {
      isProcessed = true;
      this.debug.log(
        `${assemblerFuncName}: Arg IS CallExpression. Callee type: ${
          returnArgumentNode.callee ? returnArgumentNode.callee.type : 'N/A'
        }. Processing...`
      );

      const result = this.getStringFromNode(returnArgumentNode, assemblerFuncName, t);
      concatenatedString = result.value;
      involvedSegmentFuncs = result.segments;

      if (concatenatedString === null) {
        this.debug.log(`${assemblerFuncName} (CallExpr): getStringFromNode returned null.`);
      }
    } else {
      this.debug.log(
        `${assemblerFuncName}: Arg is NOT BinaryExpr(+|) or CallExpr. Actual type: ${
          returnArgumentNode ? returnArgumentNode.type : 'N/A'
        }${
          returnArgumentNode && returnArgumentNode.type === 'BinaryExpression'
            ? `, Operator: '${returnArgumentNode.operator}'`
            : ''
        }. Skipping processing.`
      );
    }

    this.debug.log(
      `PRE-VALIDATION ${assemblerFuncName}: isProcessed=${isProcessed}, derivedString='${concatenatedString}', involvedSegments: ${involvedSegmentFuncs.join(
        ', '
      )}`
    );

    if (!isProcessed || concatenatedString === null) {
      this.debug.log(
        `EXIT ${assemblerFuncName}: ${
          !isProcessed ? 'Not processed' : 'Processed, but concatenatedString is null'
        }. Returning null.`
      );
      return null;
    }

    const result = validateConcatenatedKey(concatenatedString, assemblerFuncName, involvedSegmentFuncs);

    this.debug.log(
      `EXIT ${assemblerFuncName}: Validating derived key. Key='${concatenatedString}', Length=${
        concatenatedString.length
      } (expected 64), IsHex=${/^[0-9a-fA-F]*$/.test(concatenatedString)}`
    );

    return result;
  }

  /**
   * Call this from the main plugin to register object property assignments.
   */
  setObjectPropertiesMap(objectPropertiesMap) {
    this.objectPropertiesMap = objectPropertiesMap;
  }

  /**
   * Extracts string value from a single node
   * @param {Object} node - AST node
   * @param {string} assemblerFuncName - Name of assembler function for debug
   * @param {Object} t - Babel types
   * @param {Object} [parentNode=null] - The parent AST node, if available
   * @returns {Object} {value: string|null, segments: Array}
   */
  getStringFromNode(node, assemblerFuncName, t, parentNode = null) {
    t = t || this.t;
    this.debug.log(`getStringFromNode for ${assemblerFuncName}: Input node type: ${node ? node.type : 'N/A'}`);

    // New: Handle direct MemberExpression (e.g., S["a"])
    if (
      t.isMemberExpression(node) &&
      !t.isCallExpression(parentNode) /* Check parent to avoid double processing if it's a callee */
    ) {
      if (t.isIdentifier(node.object) && (t.isStringLiteral(node.property) || t.isIdentifier(node.property))) {
        const rawObjName = node.object.name;
        const objName = this.resolveObjectName(rawObjName); // Use alias resolver
        const propName = t.isStringLiteral(node.property) ? node.property.value : node.property.name;

        if (
          this.objectPropertiesMap &&
          this.objectPropertiesMap[objName] &&
          this.objectPropertiesMap[objName][propName]
        ) {
          const propValueNode = this.objectPropertiesMap[objName][propName];
          if (t.isStringLiteral(propValueNode)) {
            this.debug.log(
              `getStringFromNode for ${assemblerFuncName}: Resolved MemberExpression '${rawObjName}["${propName}"]' to string literal '${propValueNode.value}'`
            );
            return {
              value: propValueNode.value,
              segments: [`${objName}.${propName}`]
            };
          }
        }
      }
    }

    // Handle call expressions on object properties: S["b"]()
    if (
      t.isCallExpression(node) &&
      t.isMemberExpression(node.callee) &&
      t.isIdentifier(node.callee.object) &&
      (t.isStringLiteral(node.callee.property) || t.isIdentifier(node.callee.property))
    ) {
      const rawObjName = node.callee.object.name;
      const objName = this.resolveObjectName(rawObjName);
      const propName = t.isStringLiteral(node.callee.property) ? node.callee.property.value : node.callee.property.name;

      if (this.objectPropertiesMap?.[objName]?.[propName]) {
        const propValue = this.objectPropertiesMap[objName][propName];
        // literal case
        if (t.isStringLiteral(propValue)) {
          this.debug.log(`getStringFromNode: Resolved ${objName}.${propName} → '${propValue.value}'`);
          return { value: propValue.value, segments: [propName] };
        }
        // function case: pull its returned string
        if ((t.isFunctionExpression(propValue) || t.isArrowFunctionExpression(propValue)) && propValue.body) {
          // New: Handle implicit return from arrow function
          if (t.isStringLiteral(propValue.body)) {
            const rtn = propValue.body.value;
            this.debug.log(`getStringFromNode: Resolved ${objName}.${propName}() → '${rtn}' (implicit return)`);
            return { value: rtn, segments: [propName] };
          }
          const rtn = this._findStringReturnInBlock(propValue.body);
          if (rtn) {
            this.debug.log(`getStringFromNode: Resolved ${objName}.${propName}() → '${rtn}'`);
            return { value: rtn, segments: [propName] };
          }
        }
      }
    }

    // Original logic for direct segment function calls (e.g., funcName())
    if (t.isCallExpression(node) && t.isIdentifier(node.callee) && this.segmentFunctionsMap[node.callee.name]) {
      const segmentName = node.callee.name;
      const segmentValue = this.segmentFunctionsMap[segmentName];
      this.debug.log(
        `getStringFromNode for ${assemblerFuncName}: Resolved segment '${segmentName}' to '${segmentValue}'`
      );
      return { value: segmentValue, segments: [segmentName] };
    }

    // Debug various failure cases
    if (t.isCallExpression(node) && t.isIdentifier(node.callee)) {
      this.debug.log(
        `getStringFromNode for ${assemblerFuncName}: Segment Call '${
          node.callee.name
        }' NOT FOUND in segmentFunctionsMap. Keys: ${Object.keys(this.segmentFunctionsMap).join(', ')}`
      );
    } else if (t.isCallExpression(node) && !t.isIdentifier(node.callee)) {
      this.debug.log(
        `getStringFromNode for ${assemblerFuncName}: CallExpression callee is not Identifier. Type: ${
          node.callee ? node.callee.type : 'N/A'
        }`
      );
    } else if (node && node.type !== 'CallExpression') {
      this.debug.log(`getStringFromNode for ${assemblerFuncName}: Node is not a CallExpression. Type: ${node.type}`);
    } else {
      this.debug.log(
        `getStringFromNode for ${assemblerFuncName}: Node is not a resolvable CallExpression or other issue.`
      );
    }

    return { value: null, segments: [] };
  }

  /**
   * Flattens a binary expression tree into an array of string parts
   * @param {Object} node - Binary expression node
   * @param {string} assemblerFuncName - Name of assembler function for debug
   * @param {Object} t - Babel types
   * @returns {Array} Array of string parts
   */
  flattenConcatenation(node, assemblerFuncName, t) {
    t = t || this.t;
    let parts = [];
    let allSegments = [];

    const traverse = (currentNode, parentNode, depth = 0) => {
      this.debug.log(
        `${'  '.repeat(depth)}flattenConcatenation.traverse for ${assemblerFuncName}: Node type: ${
          currentNode ? currentNode.type : 'N/A'
        }`
      );

      // Allow both '+' and '|' as operators for recursion
      if (t.isBinaryExpression(currentNode) && (currentNode.operator === '+' || currentNode.operator === '|')) {
        this.debug.log(
          `${'  '.repeat(depth)}flattenConcatenation.traverse for ${assemblerFuncName}: BinaryExpr (${
            currentNode.operator
          }). Traversing left then right.`
        );
        traverse(currentNode.left, currentNode, depth + 1);
        traverse(currentNode.right, currentNode, depth + 1);
      } else {
        this.debug.log(
          `${'  '.repeat(
            depth
          )}flattenConcatenation.traverse for ${assemblerFuncName}: Leaf node. Attempting getStringFromNode.`
        );
        const result = this.getStringFromNode(currentNode, assemblerFuncName, t, parentNode);
        if (result.value === null) {
          this.debug.log(
            `${'  '.repeat(
              depth
            )}flattenConcatenation.traverse for ${assemblerFuncName}: getStringFromNode returned null for a part (type: ${
              currentNode ? currentNode.type : 'N/A'
            }).`
          );
        }
        parts.push(result.value);
        allSegments.push(...result.segments);
      }
    };

    this.debug.log(`flattenConcatenation for ${assemblerFuncName}: Initial node type: ${node ? node.type : 'N/A'}`);
    traverse(node, null);
    this.debug.log(`flattenConcatenation for ${assemblerFuncName}: Resulting parts: ${JSON.stringify(parts)}`);

    // Store segments for later use
    this.lastSegments = allSegments;
    return parts;
  }

  /**
   * Extracts involved segments from the flattened parts
   * @param {Array} parts - Array of string parts
   * @returns {Array} Array of segment function names
   */
  getInvolvedSegments(parts) {
    return this.lastSegments || [];
  }

  /**
   * Extracts the key by resolving and concatenating segments from a BinaryExpression.
   * @param {NodePath} path - The NodePath of the BinaryExpression.
   * @returns {string|null} The extracted key or null if extraction fails.
   */
  extract(path) {
    const segments = this.resolveSegments(path);
    if (segments) {
      const key = segments.join('');
      this.debugLog(`Concatenated key: ${key}`);
      return key;
    }
    return null;
  }

  /**
   * Resolves all segments of a concatenated key from a BinaryExpression.
   * @param {NodePath} path - The NodePath of the BinaryExpression.
   * @returns {string[]|null} An array of key segments or null.
   */
  resolveSegments(path) {
    const segments = [];
    let currentPath = path;

    while (currentPath.isBinaryExpression({ operator: '+' })) {
      const rightSegment = this.resolveSegment(currentPath.get('right'));
      if (rightSegment === null) return null;
      segments.unshift(rightSegment);
      currentPath = currentPath.get('left');
    }

    const leftSegment = this.resolveSegment(currentPath);
    if (leftSegment === null) return null;
    segments.unshift(leftSegment);

    return segments;
  }

  /**
   * Resolves a single segment of the key.
   * @param {NodePath} path - The NodePath of the segment.
   * @returns {string|null} The resolved segment or null.
   */
  resolveSegment(path) {
    if (path.isStringLiteral()) {
      return path.node.value;
    }

    if (path.isCallExpression()) {
      const callee = path.get('callee');
      const resolvedFunc = this.resolveSegment(callee);
      if (resolvedFunc && typeof resolvedFunc === 'function') {
        try {
          // This is a simplified simulation. A more robust solution might
          // require a sandbox environment to safely execute the function.
          return resolvedFunc();
        } catch (e) {
          this.debugLog(`Error executing function segment: ${e.message}`);
          return null;
        }
      }
    }

    if (path.isMemberExpression()) {
      const binding = path.scope.getBinding(path.node.object.name);

      if (binding && binding.path.isVariableDeclarator()) {
        let init = binding.path.get('init');

        // Resolve alias if the init is an Identifier
        if (init.isIdentifier()) {
          const aliasBinding = init.scope.getBinding(init.node.name);
          if (aliasBinding && aliasBinding.path.isVariableDeclarator()) {
            init = aliasBinding.path.get('init');
          }
        }

        if (init.isObjectExpression()) {
          const propertyName = path.node.property.value;
          const property = init.get('properties').find(p => p.node.key.value === propertyName);
          if (property) {
            const valuePath = property.get('value');
            if (valuePath.isStringLiteral()) {
              return valuePath.node.value;
            } else if (valuePath.isFunctionExpression()) {
              // Attempt to resolve the function's return value
              let returnedValue = null;
              valuePath.traverse({
                ReturnStatement: returnPath => {
                  if (returnPath.get('argument').isStringLiteral()) {
                    returnedValue = returnPath.get('argument').node.value;
                  }
                }
              });
              return returnedValue;
            }
          }
        }
      }
    }

    this.debugLog(`Unable to resolve segment: ${path.type}`);
    return null;
  }
}
