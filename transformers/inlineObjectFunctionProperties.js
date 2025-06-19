/**
 * Inline Object Function Properties Transformer
 *
 * Replaces calls to object function properties that return a string literal
 * with the literal value. Example: obj["b"] = () => "foo"; obj["b"]() => "foo"
 */

export function inlineObjectFunctionProperties({ types: t }) {
  return {
    visitor: {
      Program(programPath) {
        // Map: objName -> { propName: returnValue }
        const functionProps = {};

        // First pass: collect eligible function properties
        programPath.traverse({
          VariableDeclarator(path) {
            if (
              t.isIdentifier(path.node.id) &&
              t.isObjectExpression(path.node.init)
            ) {
              const objName = path.node.id.name;
              functionProps[objName] = functionProps[objName] || {};
              for (const prop of path.node.init.properties) {
                if (
                  t.isObjectProperty(prop) &&
                  (t.isStringLiteral(prop.key) || t.isIdentifier(prop.key)) &&
                  (t.isFunctionExpression(prop.value) ||
                    t.isArrowFunctionExpression(prop.value))
                ) {
                  // Aggressive: Inline if at least one return is a string literal
                  let foundLiterals = new Set();
                  let allReturnsAreString = true;
                  if (t.isBlockStatement(prop.value.body)) {
                    prop.value.body.body.forEach((stmt) => {
                      if (t.isReturnStatement(stmt)) {
                        if (t.isStringLiteral(stmt.argument)) {
                          foundLiterals.add(stmt.argument.value);
                        } else {
                          allReturnsAreString = false;
                        }
                      }
                    });
                  } else if (t.isStringLiteral(prop.value.body)) {
                    foundLiterals.add(prop.value.body.value);
                  }
                  // Inline if at least one string literal return (ignore others)
                  if (foundLiterals.size >= 1) {
                    const returnValue = [...foundLiterals][0];
                    const propName = t.isStringLiteral(prop.key)
                      ? prop.key.value
                      : prop.key.name;
                    functionProps[objName][propName] = returnValue;
                  }
                }
              }
            }
          },
        });

        // Pass: simplify always-true/false guards (e.g., if (0 < 500) => if (true))
        programPath.traverse({
          IfStatement(path) {
            if (path.node.test.type === "BinaryExpression") {
              try {
                // Try to statically evaluate the test
                const { left, right, operator } = path.node.test;
                if (t.isNumericLiteral(left) && t.isNumericLiteral(right)) {
                  let result;
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
                  path.get("test").replaceWith(t.booleanLiteral(result));
                }
              } catch (e) {}
            }
          },
        });

        // Second pass: replace eligible calls
        programPath.traverse({
          CallExpression(path) {
            const callee = path.node.callee;
            if (
              t.isMemberExpression(callee) &&
              t.isIdentifier(callee.object) &&
              (t.isStringLiteral(callee.property) ||
                t.isIdentifier(callee.property))
            ) {
              const objName = callee.object.name;
              const propName = t.isStringLiteral(callee.property)
                ? callee.property.value
                : callee.property.name;
              if (
                functionProps[objName] &&
                functionProps[objName][propName] !== undefined
              ) {
                path.replaceWith(
                  t.stringLiteral(functionProps[objName][propName])
                );
              }
            }
          },
        });
      },
    },
  };
}
