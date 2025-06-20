import { debugLoggers } from '../config/debug.js';
import { ConcatenatedKeyExtractor } from './concatenatedKeyExtractor.js';

/**
 * Extracts keys from function-based patterns (declarations, expressions, assignments)
 */
export class FunctionKeyExtractor {
  constructor(segmentFunctionsMap) {
    this.segmentFunctionsMap = segmentFunctionsMap;
    this.debug = debugLoggers.assemblerLogic;
    this.concatenatedExtractor = new ConcatenatedKeyExtractor(segmentFunctionsMap);
  }

  setTypes(t) {
    this.t = t;
    if (this.concatenatedExtractor && this.concatenatedExtractor.setTypes) {
      this.concatenatedExtractor.setTypes(t);
    }
  }

  setObjectPropertiesMap(objectPropertiesMap) {
    if (this.concatenatedExtractor) {
      this.concatenatedExtractor.setObjectPropertiesMap(objectPropertiesMap);
    }
  }

  setAliasMap(aliasMap) {
    if (this.concatenatedExtractor) {
      this.concatenatedExtractor.setAliasMap(aliasMap);
    }
  }

  /**
   * Creates visitors for function-based key extraction
   * @param {Array} foundKeys - Array to store found keys
   * @param {Array} nonHexCandidates - Array to store non-hex candidates
   * @param {Array} wrongLengthCandidates - Array to store wrong length candidates
   * @param {boolean} findAllCandidates - Whether to find all candidates
   * @returns {Object} Babel visitor object
   */
  createVisitors(foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates) {
    // Use enter visitors to catch nested functions/variables
    return {
      FunctionDeclaration: path => {
        this.handleFunctionDeclaration(path, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates);
      },
      VariableDeclarator: path => {
        this.handleVariableDeclarator(path, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates);
      },
      AssignmentExpression: path => {
        this.handleAssignmentExpression(path, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates);
      },
      // Traverse into all BlockStatements to catch nested declarations
      BlockStatement: {
        enter: blockPath => {
          blockPath.traverse({
            FunctionDeclaration: path => {
              this.handleFunctionDeclaration(
                path,
                foundKeys,
                nonHexCandidates,
                wrongLengthCandidates,
                findAllCandidates
              );
            },
            VariableDeclarator: path => {
              this.handleVariableDeclarator(
                path,
                foundKeys,
                nonHexCandidates,
                wrongLengthCandidates,
                findAllCandidates
              );
            },
            AssignmentExpression: path => {
              this.handleAssignmentExpression(
                path,
                foundKeys,
                nonHexCandidates,
                wrongLengthCandidates,
                findAllCandidates
              );
            }
          });
        }
      }
    };
  }

  /**
   * Handles function declarations
   */
  handleFunctionDeclaration(path, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates) {
    const t = this.t;

    const funcNode = path.node;
    const funcName = funcNode.id ? funcNode.id.name : 'anonymousFunction_decl';

    this.debug.log(`Visiting FunctionDeclaration for potential assembler function: ${funcName}`);

    if (funcNode.body && t.isBlockStatement(funcNode.body)) {
      this.debug.log(`Function ${funcName} (decl) has BlockStatement body. Traversing for ReturnStatements...`);

      path.get('body').traverse({
        ReturnStatement: returnPath => {
          this.processReturnStatement(
            returnPath,
            funcName,
            foundKeys,
            nonHexCandidates,
            wrongLengthCandidates,
            findAllCandidates
          );
        }
      });
    } else {
      this.debug.log(
        `Function ${funcName} (decl) does not have a BlockStatement body. Type: ${
          funcNode.body ? funcNode.body.type : 'N/A'
        }. Skipping ReturnStatement traversal.`
      );
    }
  }

  /**
   * Handles variable declarators (arrow functions and function expressions)
   */
  handleVariableDeclarator(path, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates) {
    const t = this.t;

    const funcInitNode = path.node.init;
    const varName = path.node.id && t.isIdentifier(path.node.id) ? path.node.id.name : 'anonymousVariableFunction';

    this.debug.log(`Visiting VariableDeclarator for potential assembler function: ${varName}`);

    if (funcInitNode && (t.isArrowFunctionExpression(funcInitNode) || t.isFunctionExpression(funcInitNode))) {
      this.debug.log(
        `Function ${varName} (var decl) has body type: ${funcInitNode.body ? funcInitNode.body.type : 'N/A'}`
      );

      if (t.isBlockStatement(funcInitNode.body)) {
        this.debug.log(`Function ${varName} (var decl) has BlockStatement body. Traversing for ReturnStatements...`);

        path.get('init.body').traverse({
          ReturnStatement: returnPath => {
            this.processReturnStatement(
              returnPath,
              varName,
              foundKeys,
              nonHexCandidates,
              wrongLengthCandidates,
              findAllCandidates
            );
          }
        });
      } else if (funcInitNode.body) {
        // Implicit return for arrow functions
        this.debug.log(
          `Function ${varName} (var decl) has implicit return (body type: ${funcInitNode.body.type}). Processing body directly.`
        );

        if (funcInitNode.body.type === 'BinaryExpression') {
          this.debug.log(
            `${varName} (var decl implicit) Return Arg Operator (Binary): '${funcInitNode.body.operator}'`
          );
        }

        this.processImplicitReturn(
          funcInitNode.body,
          varName,
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates,
          findAllCandidates
        );
      }
    }
  }

  /**
   * Handles assignment expressions
   */
  handleAssignmentExpression(path, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates) {
    const t = this.t;

    const assignLeft = path.node.left;
    const assignRight = path.node.right;

    if (
      t.isIdentifier(assignLeft) &&
      (t.isArrowFunctionExpression(assignRight) || t.isFunctionExpression(assignRight))
    ) {
      const funcName = assignLeft.name;
      const funcNode = assignRight;

      this.debug.log(`Visiting AssignmentExpression for potential assembler function: ${funcName}`);
      this.debug.log(`Function ${funcName} (assign) has body type: ${funcNode.body ? funcNode.body.type : 'N/A'}`);

      if (t.isBlockStatement(funcNode.body)) {
        this.debug.log(`Function ${funcName} (assign) has BlockStatement body. Traversing for ReturnStatements...`);

        path.get('right.body').traverse({
          ReturnStatement: returnPath => {
            this.processReturnStatement(
              returnPath,
              funcName,
              foundKeys,
              nonHexCandidates,
              wrongLengthCandidates,
              findAllCandidates
            );
          }
        });
      } else if (funcNode.body) {
        // Implicit return for arrow functions
        this.debug.log(
          `Function ${funcName} (assign) has implicit return (body type: ${funcNode.body.type}). Processing body directly.`
        );

        if (funcNode.body.type === 'BinaryExpression') {
          this.debug.log(`${funcName} (assign implicit) Return Arg Operator (Binary): '${funcNode.body.operator}'`);
        }

        this.processImplicitReturn(
          funcNode.body,
          funcName,
          foundKeys,
          nonHexCandidates,
          wrongLengthCandidates,
          findAllCandidates
        );
      }
    }
  }

  /**
   * Processes return statements
   */
  processReturnStatement(returnPath, funcName, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates) {
    this.debug.log(
      `Potential assembler: ${funcName}. Found ReturnStatement. Arg type: ${
        returnPath.node.argument ? returnPath.node.argument.type : 'N/A'
      }`
    );

    if (returnPath.node.argument && returnPath.node.argument.type === 'BinaryExpression') {
      this.debug.log(`${funcName} Return Arg Operator (Binary): '${returnPath.node.argument.operator}'`);
    }

    const result = this.concatenatedExtractor.deriveAndValidate(returnPath.node.argument, funcName);

    this.handleExtractionResult(result, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates);
  }

  /**
   * Processes implicit returns (arrow functions)
   */
  processImplicitReturn(bodyNode, funcName, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates) {
    const result = this.concatenatedExtractor.deriveAndValidate(bodyNode, funcName);
    this.handleExtractionResult(result, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates);
  }

  /**
   * Handles the result of key extraction
   */
  handleExtractionResult(result, foundKeys, nonHexCandidates, wrongLengthCandidates, findAllCandidates) {
    if (result) {
      if (result.isValidKey) {
        if (!foundKeys.some(fk => fk.key === result.key && fk.type === result.type)) {
          foundKeys.push({ ...result });
        }
        if (!findAllCandidates) {
          // Stop traversal - this would need to be handled at the program level
          return true;
        }
      } else if (result.isNonHex) {
        nonHexCandidates.push({
          result: result.key,
          type: result.type,
          source: result.source,
          segments: result.segments
        });
      } else if (result.isWrongLength) {
        wrongLengthCandidates.push({
          result: result.key,
          type: result.type,
          source: result.source,
          segments: result.segments,
          length: result.actualLength,
          expectedLength: result.expectedLength
        });
      }
    }
    return false;
  }
}
