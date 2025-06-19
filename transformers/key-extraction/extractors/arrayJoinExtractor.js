import { debugLoggers } from "../config/debug.js";
import { validateKey } from "../validators/keyValidator.js";

/**
 * Extracts keys from Array.join() patterns
 */
export class ArrayJoinExtractor {
  constructor(potentialKeyArrays) {
    this.potentialKeyArrays = potentialKeyArrays;
    this.debug = debugLoggers.arrayJoin;
  }

  setTypes(t) {
    this.t = t;
  }

  /**
   * Creates a visitor for detecting array join patterns
   * @param {Array} foundKeys - Array to store found keys
   * @param {Array} nonHexCandidates - Array to store non-hex candidates
   * @param {Array} wrongLengthCandidates - Array to store wrong length candidates
   * @param {boolean} findAllCandidates - Whether to find all candidates
   * @returns {Function} Visitor function for CallExpression
   */
  createCallExpressionHandler(
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates,
    findAllCandidates
  ) {
    return (path) => {
      const t = this.t;
      const callee = path.node.callee;
      const args = path.node.arguments;

      // Handle String.fromCharCode patterns
      this.handleFromCharCode(
        callee,
        args,
        foundKeys,
        nonHexCandidates,
        wrongLengthCandidates,
        t
      );

      // Handle indexed array mapping patterns
      this.handleIndexedArrayMapping(
        callee,
        args,
        path,
        foundKeys,
        nonHexCandidates,
        wrongLengthCandidates,
        t
      );

      // Handle direct array joins
      this.handleDirectArrayJoins(
        callee,
        args,
        path,
        foundKeys,
        nonHexCandidates,
        wrongLengthCandidates,
        findAllCandidates,
        t
      );
    };
  }

  /**
   * Handles String.fromCharCode(...array) patterns
   */
  handleFromCharCode(
    callee,
    args,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates,
    t
  ) {
    let isFromCharCode = false;
    let calleeName = null;

    // Detect various fromCharCode patterns
    if (t.isMemberExpression(callee)) {
      if (
        t.isIdentifier(callee.object, { name: "String" }) &&
        (t.isIdentifier(callee.property, { name: "fromCharCode" }) ||
          t.isStringLiteral(callee.property, { value: "fromCharCode" }) ||
          t.isStringLiteral(callee.property, { value: "" }))
      ) {
        isFromCharCode = true;
        calleeName = "String.fromCharCode";
      } else if (
        t.isIdentifier(callee.property, { name: "fromCharCode" }) ||
        t.isStringLiteral(callee.property, { value: "fromCharCode" }) ||
        t.isStringLiteral(callee.property, { value: "" })
      ) {
        isFromCharCode = true;
        calleeName = "obj.fromCharCode";
      }
    } else if (t.isIdentifier(callee, { name: "fromCharCode" })) {
      isFromCharCode = true;
      calleeName = "fromCharCode";
    }

    if (!isFromCharCode) return;

    // Handle spread argument: ...L
    if (args.length === 1 && t.isSpreadElement(args[0])) {
      this.handleFromCharCodeSpread(
        args[0],
        foundKeys,
        nonHexCandidates,
        wrongLengthCandidates,
        t
      );
    }
    // Handle direct numeric arguments
    else if (args.length > 0 && args.every((arg) => t.isNumericLiteral(arg))) {
      this.handleFromCharCodeDirect(
        args,
        calleeName,
        foundKeys,
        nonHexCandidates,
        wrongLengthCandidates
      );
    }
  }

  handleFromCharCodeSpread(
    spreadArg,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates,
    t
  ) {
    const spreadArgument = spreadArg.argument;
    if (
      t.isIdentifier(spreadArgument) &&
      this.potentialKeyArrays[spreadArgument.name]
    ) {
      const arr = this.potentialKeyArrays[spreadArgument.name];
      if (
        t.isArrayExpression(arr) &&
        arr.elements.every((el) => t.isNumericLiteral(el))
      ) {
        const key = arr.elements
          .map((el) => String.fromCharCode(el.value))
          .join("");
        this.categorizeFromCharCodeResult(
          key,
          spreadArgument.name,
          "fromCharCode_array",
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates
        );
      }
    }
  }

  handleFromCharCodeDirect(
    args,
    calleeName,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates
  ) {
    const key = args.map((el) => String.fromCharCode(el.value)).join("");
    this.categorizeFromCharCodeResult(
      key,
      calleeName,
      "fromCharCode_args",
      foundKeys,
      nonHexCandidates,
      wrongLengthCandidates
    );
  }

  categorizeFromCharCodeResult(
    key,
    source,
    type,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates
  ) {
    if (key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
      if (!foundKeys.some((fk) => fk.key === key && fk.type === type)) {
        foundKeys.push({ key, type, source });
      }
    } else if (key.length === 64) {
      nonHexCandidates.push({ result: key, type, source });
    } else {
      wrongLengthCandidates.push({
        result: key,
        type,
        source,
        length: key.length,
      });
    }
  }

  /**
   * Handles indexed array mapping patterns
   */
  handleIndexedArrayMapping(
    callee,
    args,
    path,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates,
    t
  ) {
    // Pattern: indexArray["map"](o => sourceArray[o])["join"]("")
    if (
      t.isMemberExpression(callee) &&
      (t.isIdentifier(callee.property, { name: "join" }) ||
        (t.isStringLiteral(callee.property) &&
          callee.property.value === "join")) &&
      args.length === 1 &&
      t.isStringLiteral(args[0]) &&
      args[0].value === ""
    ) {
      const joinObject = callee.object;

      if (
        t.isCallExpression(joinObject) &&
        t.isMemberExpression(joinObject.callee) &&
        (t.isIdentifier(joinObject.callee.property, { name: "map" }) ||
          (t.isStringLiteral(joinObject.callee.property) &&
            joinObject.callee.property.value === "map")) &&
        t.isIdentifier(joinObject.callee.object) &&
        joinObject.arguments.length === 1
      ) {
        this.processIndexedMapping(
          joinObject,
          path,
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates,
          t
        );
      }
    }
  }

  processIndexedMapping(
    joinObject,
    path,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates,
    t
  ) {
    const indexArrayName = joinObject.callee.object.name;
    const mapCallbackPath = path.get("callee.object.arguments.0");
    const mapCallbackNode = mapCallbackPath.node;

    let sourceArrayName = null;

    if (
      mapCallbackNode &&
      (t.isArrowFunctionExpression(mapCallbackNode) ||
        t.isFunctionExpression(mapCallbackNode)) &&
      mapCallbackNode.params &&
      mapCallbackNode.params.length === 1 &&
      t.isIdentifier(mapCallbackNode.params[0])
    ) {
      const paramName = mapCallbackNode.params[0].name;
      sourceArrayName = this.extractSourceArrayName(
        mapCallbackPath,
        paramName,
        t
      );
    }

    if (
      sourceArrayName &&
      this.potentialKeyArrays[indexArrayName] &&
      this.potentialKeyArrays[sourceArrayName]
    ) {
      this.processArrayMapping(
        indexArrayName,
        sourceArrayName,
        foundKeys,
        nonHexCandidates,
        wrongLengthCandidates,
        t
      );
    }
  }

  extractSourceArrayName(mapCallbackPath, paramName, t) {
    const bodyPath = mapCallbackPath.get("body");
    let sourceArrayName = null;

    const visitor = {
      MemberExpression(memberPath) {
        if (
          t.isIdentifier(memberPath.node.object) &&
          t.isIdentifier(memberPath.node.property, { name: paramName })
        ) {
          sourceArrayName = memberPath.node.object.name;
          memberPath.stop();
        }
      },
    };

    if (t.isBlockStatement(bodyPath.node)) {
      bodyPath.traverse({
        ReturnStatement(returnPath) {
          if (returnPath.getFunctionParent() === mapCallbackPath) {
            returnPath.get("argument").traverse(visitor);
            if (sourceArrayName) {
              returnPath.stop();
            }
          }
        },
      });
    } else {
      // Implicit return
      bodyPath.traverse(visitor);
    }

    return sourceArrayName;
  }

  processArrayMapping(
    indexArrayName,
    sourceArrayName,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates,
    t
  ) {
    const indexArrayAstNode = this.potentialKeyArrays[indexArrayName];
    const sourceArrayAstNode = this.potentialKeyArrays[sourceArrayName];

    if (
      !t.isArrayExpression(indexArrayAstNode) ||
      !t.isArrayExpression(sourceArrayAstNode)
    ) {
      this.debug.log(
        `Skipped indexed_array_map_join for '${indexArrayName}' -> '${sourceArrayName}': One or both are not ArrayExpressions.`
      );
      return;
    }

    const areIndicesValidType = indexArrayAstNode.elements.every(
      (el) => t.isNumericLiteral(el) || t.isStringLiteral(el)
    );
    const areSourceElementsStrings = sourceArrayAstNode.elements.every((el) =>
      t.isStringLiteral(el)
    );

    if (!areIndicesValidType || !areSourceElementsStrings) {
      let reason = "";
      if (!areIndicesValidType)
        reason += "Index array elements are not all numeric/string literals. ";
      if (!areSourceElementsStrings)
        reason += "Source array elements are not all string literals. ";

      this.debug.log(
        `Skipped indexed_array_map_join for '${indexArrayName}' -> '${sourceArrayName}': ${reason.trim()}`
      );
      return;
    }

    try {
      const indices = indexArrayAstNode.elements.map((el) =>
        t.isNumericLiteral(el) ? el.value : parseInt(el.value, 10)
      );

      const validIndices = indices.filter((idx) => !isNaN(idx));
      if (validIndices.length !== indices.length) {
        this.debug.log(
          `Some indices in '${indexArrayName}' could not be converted to numbers. Valid: ${validIndices.length}, Total: ${indices.length}`
        );
      }

      const sourceStrings = sourceArrayAstNode.elements.map((el) => el.value);
      const allIndicesInBounds = validIndices.every(
        (index) => index >= 0 && index < sourceStrings.length
      );

      if (allIndicesInBounds) {
        const derivedKey = validIndices
          .map((index) => sourceStrings[index])
          .join("");
        const validationResult = validateKey(
          derivedKey,
          `${indexArrayName}->${sourceArrayName}`,
          "indexed_array_map_join"
        );

        this.categorizeValidationResult(
          validationResult,
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates
        );
      } else {
        this.debug.log(
          `Skipped indexed_array_map_join for '${indexArrayName}' -> '${sourceArrayName}': Some indices are out of bounds.`
        );
      }
    } catch (e) {
      this.debug.log(
        `Error processing indexed_array_map_join for '${indexArrayName}' -> '${sourceArrayName}': ${e.message}`
      );
    }
  }

  /**
   * Handles direct array joins
   */
  handleDirectArrayJoins(
    callee,
    args,
    path,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates,
    findAllCandidates,
    t
  ) {
    if (
      t.isMemberExpression(callee) &&
      (t.isIdentifier(callee.property, { name: "join" }) ||
        (t.isStringLiteral(callee.property) &&
          callee.property.value === "join")) &&
      (args.length === 0 ||
        (args.length === 1 &&
          t.isStringLiteral(args[0]) &&
          args[0].value === ""))
    ) {
      const joinObject = callee.object;

      // Case 1: arrayIdentifier.map(...).join('')
      if (
        t.isCallExpression(joinObject) &&
        t.isMemberExpression(joinObject.callee) &&
        (t.isIdentifier(joinObject.callee.property, { name: "map" }) ||
          (t.isStringLiteral(joinObject.callee.property) &&
            joinObject.callee.property.value === "map")) &&
        t.isIdentifier(joinObject.callee.object)
      ) {
        this.handleArrayMapJoin(
          joinObject,
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates,
          findAllCandidates,
          path,
          t
        );
      }
      // Case 2: arrayIdentifier.join('')
      else if (t.isIdentifier(joinObject)) {
        this.handleDirectArrayJoin(
          joinObject,
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates,
          t
        );
      }
    }
  }

  handleArrayMapJoin(
    joinObject,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates,
    findAllCandidates,
    path,
    t
  ) {
    const sourceName = joinObject.callee.object.name;
    const arrayNodeToProcess = this.potentialKeyArrays[sourceName];

    if (!arrayNodeToProcess || !t.isArrayExpression(arrayNodeToProcess)) {
      return;
    }

    const mapCallbackPath = path.get("callee.object.arguments.0");
    if (mapCallbackPath) {
      const mapCallbackNode = mapCallbackPath.node;

      // Check for the new pattern: .map(t => String.fromCharCode(parseInt(t, 16)))
      if (
        (t.isArrowFunctionExpression(mapCallbackNode) ||
          t.isFunctionExpression(mapCallbackNode)) &&
        mapCallbackNode.params.length === 1
      ) {
        let returnedValueNode = null;
        if (t.isBlockStatement(mapCallbackNode.body)) {
          // Find return statement
          mapCallbackPath.get("body").traverse({
            ReturnStatement(returnPath) {
              if (returnPath.getFunctionParent() === mapCallbackPath) {
                returnedValueNode = returnPath.get("argument").node;
              }
            },
          });
        } else {
          // Implicit return
          returnedValueNode = mapCallbackNode.body;
        }

        if (returnedValueNode && t.isCallExpression(returnedValueNode)) {
          const fromCharCodeCall = returnedValueNode;
          const fromCharCodeCallee = fromCharCodeCall.callee;

          // Check for .fromCharCode call
          if (
            t.isMemberExpression(fromCharCodeCallee) &&
            (t.isIdentifier(fromCharCodeCallee.property, {
              name: "fromCharCode",
            }) ||
              t.isStringLiteral(fromCharCodeCallee.property, {
                value: "fromCharCode",
              })) &&
            fromCharCodeCall.arguments.length === 1 &&
            t.isCallExpression(fromCharCodeCall.arguments[0])
          ) {
            const parseIntCall = fromCharCodeCall.arguments[0];
            const parseIntArgs = parseIntCall.arguments;
            const mapParam = mapCallbackNode.params[0];

            // Check for parseInt(param, 16) call
            if (
              parseIntArgs.length === 2 &&
              t.isIdentifier(parseIntArgs[0], { name: mapParam.name }) &&
              t.isNumericLiteral(parseIntArgs[1], { value: 16 })
            ) {
              this.debug.log(
                `Found fromCharCode(parseInt(..., 16)) pattern in map for array '${sourceName}'`
              );

              if (
                arrayNodeToProcess.elements.every((el) =>
                  t.isStringLiteral(el)
                )
              ) {
                try {
                  const derivedKey = arrayNodeToProcess.elements
                    .map((el) => String.fromCharCode(parseInt(el.value, 16)))
                    .join("");

                  const validationResult = validateKey(
                    derivedKey,
                    sourceName,
                    "array_map_charcode_parseint"
                  );

                  if (
                    this.categorizeValidationResult(
                      validationResult,
                      foundKeys,
                      nonHexCandidates,
                      wrongLengthCandidates
                    )
                  ) {
                    if (!findAllCandidates) path.stop();
                  }
                  return; // Pattern handled
                } catch (e) {
                  this.debug.log(
                    `Error processing fromCharCode(parseInt) pattern for '${sourceName}': ${e.message}`
                  );
                }
              }
            }
          }
        }
      }
    }

    // Fallback to original logic
    const processingType = "array_map_join";

    this.debug.log(
      `Encountered ${sourceName}.map(...).join(''). Handling assumes map is identity-like or elements are pre-set.`
    );

    if (arrayNodeToProcess.elements.every((el) => t.isStringLiteral(el))) {
      const derivedKey = arrayNodeToProcess.elements
        .map((el) => el.value)
        .join("");
      const validationResult = validateKey(
        derivedKey,
        sourceName,
        processingType
      );

      if (
        this.categorizeValidationResult(
          validationResult,
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates
        )
      ) {
        if (!findAllCandidates) path.stop();
      }
    } else {
      this.debug.log(
        `Array '${sourceName}' for .map.join does not consist entirely of string literals.`
      );
    }
  }

  handleDirectArrayJoin(
    joinObject,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates,
    t
  ) {
    const sourceName = joinObject.name;
    const arrayNodeToProcess = this.potentialKeyArrays[sourceName];
    const processingType = "direct_array_join";

    if (arrayNodeToProcess && t.isArrayExpression(arrayNodeToProcess)) {
      this.debug.log(
        `Processing direct join on array '${sourceName}'. Element count: ${arrayNodeToProcess.elements.length}`
      );

      if (arrayNodeToProcess.elements.every((el) => t.isStringLiteral(el))) {
        const derivedKey = arrayNodeToProcess.elements
          .map((el) => el.value)
          .join("");
        const validationResult = validateKey(
          derivedKey,
          sourceName,
          processingType
        );
        this.categorizeValidationResult(
          validationResult,
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates
        );
      } else {
        this.debug.log(
          `Array '${sourceName}' for direct join does not consist entirely of string literals.`
        );
      }
    } else {
      this.debug.log(
        `Array '${sourceName}' for direct join not found in potentialKeyArrays or not an ArrayExpression.`
      );
    }
  }

  /**
   * Helper to categorize validation results
   */
  categorizeValidationResult(
    validationResult,
    foundKeys,
    nonHexCandidates,
    wrongLengthCandidates
  ) {
    if (!validationResult) return false;

    if (validationResult.isValidKey) {
      if (
        !foundKeys.some(
          (fk) =>
            fk.key === validationResult.key && fk.type === validationResult.type
        )
      ) {
        foundKeys.push({ ...validationResult });
      }
      return true;
    } else if (validationResult.isNonHex) {
      nonHexCandidates.push({
        result: validationResult.key,
        type: validationResult.type,
        source: validationResult.source,
      });
    } else if (validationResult.isWrongLength) {
      wrongLengthCandidates.push({
        result: validationResult.key,
        type: validationResult.type,
        source: validationResult.source,
        length: validationResult.actualLength,
        expectedLength: validationResult.expectedLength,
      });
    }
    return false;
  }
}
