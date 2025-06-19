export function removeDeadBranches({ types: t }) {
  return {
    visitor: {
      Program(programPath) {
        // Single-pass dead-branch removal to avoid repeated full-tree traversals
        programPath.traverse({
          IfStatement(path) {
            let result;
            if (t.isBooleanLiteral(path.node.test)) {
              result = path.node.test.value;
            } else if (t.isNumericLiteral(path.node.test)) {
              result = !!path.node.test.value;
            } else if (t.isBinaryExpression(path.node.test)) {
              const { left, right, operator } = path.node.test;
              if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
                switch (operator) {
                  case "<":
                    result = left.value < right.value;
                    break;
                  case ">":
                    result = left.value > right.value;
                    break;
                  case "<=":
                    result = left.value <= right.value;
                    break;
                  case ">=":
                    result = left.value >= right.value;
                    break;
                  case "==":
                    result = left.value == right.value;
                    break;
                  case "===":
                    result = left.value === right.value;
                    break;
                  case "!=":
                    result = left.value != right.value;
                    break;
                  case "!==":
                    result = left.value !== right.value;
                    break;
                  default:
                    return;
                }
              }
            }
            if (typeof result === "boolean") {
              if (result) {
                path.replaceWithMultiple(
                  path.node.consequent.body || [path.node.consequent]
                );
              } else if (path.node.alternate) {
                path.replaceWithMultiple(
                  path.node.alternate.body || [path.node.alternate]
                );
              } else {
                path.remove();
              }
            }
          },
        });
      },
    },
  };
}
