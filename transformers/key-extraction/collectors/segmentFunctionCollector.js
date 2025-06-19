import { debugLoggers } from "../config/debug.js";

/**
 * Collects segment functions that return string literals
 * These are used in the concatenated_functions pattern
 */
export class SegmentFunctionCollector {
  constructor() {
    this.segmentFunctionsMap = {};
    this.skippedFunctions = {};
    this.debugInfo = {};
    this.debug = debugLoggers.segmentFunctions;
  }

  setTypes(t) {
    this.t = t;
  }

  /**
   * Creates a visitor for collecting segment functions
   * @returns {Object} Babel visitor object
   */
  createVisitor() {
    return {
      FunctionDeclaration: (path) => {
        this.handleFunctionDeclaration(path);
      },
      VariableDeclarator: (path) => {
        this.handleVariableDeclarator(path);
      },
      VariableDeclaration: (path) => {
        this.handleVariableDeclarationWithAssignment(path);
      },
    };
  }

  handleVariableDeclarationWithAssignment(path) {
    const t = this.t;
    const declarations = path.node.declarations;
    if (
      !(
        declarations &&
        declarations.length === 1 &&
        t.isIdentifier(declarations[0].id) &&
        declarations[0].init === null
      )
    ) {
      return;
    }

    const varName = declarations[0].id.name;
    const parentNode = path.parentPath?.node;

    if (parentNode && parentNode.body && Array.isArray(parentNode.body)) {
      const parentBody = parentNode.body;
      let currentIndex = parentBody.findIndex((stmt) => stmt === path.node);

      if (currentIndex >= 0) {
        // Look for assignment expressions after this variable declaration
        for (let i = currentIndex + 1; i < parentBody.length; i++) {
          const stmt = parentBody[i];
          if (
            t.isExpressionStatement(stmt) &&
            t.isAssignmentExpression(stmt.expression) &&
            t.isIdentifier(stmt.expression.left, { name: varName }) &&
            (t.isArrowFunctionExpression(stmt.expression.right) ||
              t.isFunctionExpression(stmt.expression.right))
          ) {
            const funcNode = stmt.expression.right;

            // Process this assignment like a normal variable declarator
            if (t.isStringLiteral(funcNode.body)) {
              this.segmentFunctionsMap[varName] = funcNode.body.value;
            } else if (t.isBlockStatement(funcNode.body)) {
              for (let bodyStmt of funcNode.body.body) {
                if (
                  t.isReturnStatement(bodyStmt) &&
                  t.isStringLiteral(bodyStmt.argument)
                ) {
                  this.segmentFunctionsMap[varName] = bodyStmt.argument.value;
                  break;
                }
              }
            }
            break; // Found assignment, stop looking.
          }
        }
      }
    }
  }

  handleFunctionDeclaration(path) {
    const t = this.t;

    if (!path.node.id || !path.node.id.name) return;

    const funcName = path.node.id.name;
    const bodyStmts = path.node.body.body;

    if (this.segmentFunctionsMap[funcName] || this.skippedFunctions[funcName])
      return;

    this.initDebugInfo(funcName, "FunctionDeclaration", bodyStmts);

    // Try to find a return statement with a string literal directly in the top level
    let stringReturnFound = this.findDirectStringReturn(bodyStmts, funcName, t);

    // If we didn't find a string return in the first pass, try a more aggressive traversal
    if (!stringReturnFound) {
      stringReturnFound = this.findStringReturnViaTraversal(path, funcName, t);
    }

    if (!stringReturnFound) {
      this.skippedFunctions[funcName] = true;
      if (this.debugInfo[funcName]) {
        this.debugInfo[funcName].skipped = true;
      }
    }
  }

  handleVariableDeclarator(path) {
    const t = this.t;

    if (!t.isIdentifier(path.node.id) || !path.node.init) return;

    const funcName = path.node.id.name;

    // Skip if we already processed this function
    if (this.segmentFunctionsMap[funcName] || this.skippedFunctions[funcName])
      return;

    const funcInit = path.node.init;

    // Initialize debug info
    this.initDebugInfoForVariable(funcName, funcInit);

    // Handle arrow function with implicit return
    if (t.isArrowFunctionExpression(funcInit)) {
      this.handleArrowFunction(funcInit, funcName, path, t);
    } else if (t.isFunctionExpression(funcInit)) {
      this.handleFunctionExpression(funcInit, funcName, path, t);
    }
  }

  initDebugInfo(funcName, type, bodyStmts) {
    this.debugInfo[funcName] = {
      type: type,
      bodyLength: bodyStmts ? bodyStmts.length : 0,
      hasReturn: false,
      hasStringReturn: false,
      nestedIfStatements: 0,
      returnValue: null,
    };
  }

  initDebugInfoForVariable(funcName, funcInit) {
    const t = this.t;
    this.debugInfo[funcName] = {
      type: t.isArrowFunctionExpression(funcInit)
        ? "ArrowFunction"
        : t.isFunctionExpression(funcInit)
        ? "FunctionExpression"
        : "Unknown",
      hasImplicitReturn:
        t.isArrowFunctionExpression(funcInit) &&
        !t.isBlockStatement(funcInit.body),
    };
  }

  findDirectStringReturn(bodyStmts, funcName, t) {
    if (!bodyStmts || bodyStmts.length === 0) return false;

    for (let stmt of bodyStmts) {
      if (t.isReturnStatement(stmt)) {
        this.debugInfo[funcName].hasReturn = true;

        if (t.isStringLiteral(stmt.argument)) {
          this.debugInfo[funcName].hasStringReturn = true;
          this.debugInfo[funcName].returnValue = stmt.argument.value;
          this.segmentFunctionsMap[funcName] = stmt.argument.value;
          return true;
        }
      }

      // Look inside if statements for string returns
      if (t.isIfStatement(stmt)) {
        this.debugInfo[funcName].nestedIfStatements++;
        const returnStr = this.extractReturnStringFromIfStatement(stmt, t);
        if (returnStr) {
          this.debugInfo[funcName].hasStringReturn = true;
          this.debugInfo[funcName].returnValue = returnStr;
          this.debugInfo[funcName].fromIf = true;
          this.segmentFunctionsMap[funcName] = returnStr;
          return true;
        }
      }
    }
    return false;
  }

  findStringReturnViaTraversal(path, funcName, t) {
    let foundReturn = false;
    path.traverse({
      ReturnStatement(returnPath) {
        if (foundReturn) return;
        if (t.isStringLiteral(returnPath.node.argument)) {
          this.segmentFunctionsMap[funcName] = returnPath.node.argument.value;
          this.debugInfo[funcName].hasStringReturn = true;
          this.debugInfo[funcName].returnValue = returnPath.node.argument.value;
          this.debugInfo[funcName].fromTraversal = true;
          foundReturn = true;
          returnPath.stop();
        }
      },
    });
    return foundReturn;
  }

  handleArrowFunction(funcInit, funcName, path, t) {
    // Case 1: Arrow function with implicit string return: () => "string"
    if (t.isStringLiteral(funcInit.body)) {
      this.segmentFunctionsMap[funcName] = funcInit.body.value;
      this.debugInfo[funcName].hasStringReturn = true;
      this.debugInfo[funcName].returnValue = funcInit.body.value;
      return;
    }

    // Case 2: Arrow function with block body: () => { ... }
    if (t.isBlockStatement(funcInit.body)) {
      this.handleBlockBody(
        funcInit.body.body,
        funcName,
        path.get("init.body"),
        t
      );
    }
  }

  handleFunctionExpression(funcInit, funcName, path, t) {
    const bodyStmts = funcInit.body.body;
    this.debugInfo[funcName].bodyLength = bodyStmts ? bodyStmts.length : 0;
    this.handleBlockBody(bodyStmts, funcName, path.get("init.body"), t);
  }

  handleBlockBody(bodyStmts, funcName, bodyPath, t) {
    this.debugInfo[funcName].bodyLength = bodyStmts ? bodyStmts.length : 0;

    // First try to find direct returns or conditionals at the top level
    let stringReturnFound = this.findDirectStringReturn(bodyStmts, funcName, t);

    // If not found at top level, traverse deeper
    if (!stringReturnFound) {
      let foundReturn = false;
      bodyPath.traverse({
        ReturnStatement(returnPath) {
          if (foundReturn) return;
          if (t.isStringLiteral(returnPath.node.argument)) {
            this.segmentFunctionsMap[funcName] = returnPath.node.argument.value;
            this.debugInfo[funcName].hasStringReturn = true;
            this.debugInfo[funcName].returnValue =
              returnPath.node.argument.value;
            this.debugInfo[funcName].fromTraversal = true;
            foundReturn = true;
            returnPath.stop();
          }
        },
      });

      if (!foundReturn) {
        this.skippedFunctions[funcName] = true;
        this.debugInfo[funcName].skipped = true;
      }
    }
  }

  /**
   * Helper to extract return statements from IF conditions
   */
  extractReturnStringFromIfStatement(node, t) {
    if (!t.isIfStatement(node)) return null;

    // Check consequent (the "then" part)
    const consequentReturn = this.extractReturnFromBlock(node.consequent, t);
    if (consequentReturn) return consequentReturn;

    // Check alternate (the "else" part)
    if (node.alternate) {
      const alternateReturn = this.extractReturnFromBlock(node.alternate, t);
      if (alternateReturn) return alternateReturn;

      // Handle nested if statements in else clauses (else if)
      if (t.isIfStatement(node.alternate)) {
        return this.extractReturnStringFromIfStatement(node.alternate, t);
      }
    }

    return null;
  }

  extractReturnFromBlock(block, t) {
    if (t.isBlockStatement(block)) {
      for (let stmt of block.body) {
        if (t.isReturnStatement(stmt) && t.isStringLiteral(stmt.argument)) {
          return stmt.argument.value;
        }
      }
    } else if (
      t.isReturnStatement(block) &&
      t.isStringLiteral(block.argument)
    ) {
      return block.argument.value;
    }
    return null;
  }

  /**
   * Get collected segment functions
   * @returns {Object} Map of function names to their string return values
   */
  getFunctions() {
    return this.segmentFunctionsMap;
  }

  /**
   * Get debug information
   * @returns {Object} Debug information about processed functions
   */
  getDebugInfo() {
    return this.debugInfo;
  }

  /**
   * Reset collected data
   */
  reset() {
    this.segmentFunctionsMap = {};
    this.skippedFunctions = {};
    this.debugInfo = {};
  }
}
