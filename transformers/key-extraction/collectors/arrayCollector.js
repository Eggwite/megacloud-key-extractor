import { debugLoggers } from "../config/debug.js";

/**
 * Collects array literals from the AST for various key extraction patterns
 */
export class ArrayCollector {
  constructor() {
    this.potentialKeyArrays = {};
    this.debug = debugLoggers.arrayJoin;
  }

  setTypes(t) {
    this.t = t;
  }

  /**
   * Creates a visitor for collecting array literals
   * @returns {Object} Babel visitor object
   */
  createVisitor() {
    return {
      VariableDeclarator: (path) => {
        this.handleVariableDeclarator(path);
      },
      AssignmentExpression: (path) => {
        this.handleAssignmentExpression(path);
      },
    };
  }

  handleVariableDeclarator(path) {
    const t = this.t;

    if (t.isIdentifier(path.node.id) && t.isArrayExpression(path.node.init)) {
      // Store the ArrayExpression node itself
      this.potentialKeyArrays[path.node.id.name] = path.node.init;
      this.debug.log(
        `Collected array: ${path.node.id.name} with ${path.node.init.elements.length} elements.`
      );
    }
  }

  handleAssignmentExpression(path) {
    const t = this.t;

    if (
      t.isIdentifier(path.node.left) &&
      t.isArrayExpression(path.node.right)
    ) {
      this.potentialKeyArrays[path.node.left.name] = path.node.right;
      this.debug.log(
        `Collected array (via assignment): ${path.node.left.name} with ${path.node.right.elements.length} elements.`
      );
    }
  }

  /**
   * Get collected arrays
   * @returns {Object} Map of array names to ArrayExpression nodes
   */
  getArrays() {
    return this.potentialKeyArrays;
  }

  /**
   * Reset collected arrays
   */
  reset() {
    this.potentialKeyArrays = {};
  }
}
