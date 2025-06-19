import * as t from "@babel/types";
import generate from "@babel/generator";
import { debug } from "./centralDebug.js";

const gen = (node) => {
  return generate.default(node, { compact: true }).code;
};

function safeValueToNode(value) {
  if (value === undefined) return t.identifier("undefined");
  try {
    return t.valueToNode(value);
  } catch (e) {
    return null;
  }
}

export const inlineStringArray = {
  visitor: {
    Program: {
      enter(path, state) {
        state.arrayInfo = null;
        state.pathsToRemove = new Set();
        debug.log("[INLINE-STR] Starting final inlining pass...");
      },
      exit(path, state) {
        if (state.pathsToRemove.size > 0) {
          debug.log(
            `[INLINE-STR] Cleanup: Removing ${state.pathsToRemove.size} original array definitions.`
          );
          Array.from(state.pathsToRemove)
            .reverse()
            .forEach((p) => {
              if (p && !p.removed) {
                try {
                  p.remove();
                } catch (e) {}
              }
            });
        }
      },
    },

    AssignmentExpression(path, state) {
      if (state.arrayInfo) return;

      const right = path.get("right");
      if (
        !right.isCallExpression() ||
        !right.get("callee").isFunctionExpression()
      ) {
        return;
      }

      const iifePath = right.get("callee");
      iifePath.traverse({
        ArrayExpression(arrayPath) {
          const parentMemberExpr = arrayPath.parentPath;
          if (!parentMemberExpr.isMemberExpression({ object: arrayPath.node }))
            return;

          const grandParentReturn = parentMemberExpr.parentPath;
          if (
            !grandParentReturn.isReturnStatement({
              argument: parentMemberExpr.node,
            })
          )
            return;

          const accessorFunc = grandParentReturn.findParent((p) =>
            p.isFunctionExpression()
          );
          if (!accessorFunc) return;

          const objectProp = accessorFunc.findParent((p) =>
            p.isObjectProperty({ value: accessorFunc.node })
          );
          if (!objectProp) return;

          const evalResults = arrayPath
            .get("elements")
            .map((el) => el.evaluate());
          if (!evalResults.every((r) => r.confident)) {
            return;
          }
          const theArray = evalResults.map((r) => r.value);

          const objectName = gen(path.node.left);
          const accessorName = objectProp.get("key").isIdentifier()
            ? objectProp.get("key").node.name
            : objectProp.get("key").node.value;

          state.arrayInfo = { objectName, accessorName, theArray };
          state.pathsToRemove.add(path.getStatementParent());

          debug.log(`\n[INLINE-STR] Successfully parsed literal array!`);
          debug.log(`[INLINE-STR] - Object Name:   '${objectName}'`);
          debug.log(`[INLINE-STR] - Accessor Name: '${accessorName}'`);
          debug.log(`[INLINE-STR] - Array Size:    ${theArray.length}\n`);
        },
      });
    },

    CallExpression(path, state) {
      if (!state.arrayInfo) return;

      const callee = path.get("callee");
      if (!callee.isMemberExpression()) return;

      const { objectName, accessorName, theArray } = state.arrayInfo;

      if (
        gen(callee.node.object) === objectName &&
        callee.get("property").isIdentifier({ name: accessorName })
      ) {
        const evaluation = path.get("arguments.0").evaluate();

        if (evaluation.confident && typeof evaluation.value === "number") {
          const index = evaluation.value;

          if (index >= 0 && index < theArray.length) {
            const resolvedValue = theArray[index];
            const replacementNode = safeValueToNode(resolvedValue);

            if (replacementNode) {
              debug.log(
                `[INLINE-STR] Inlining ${gen(path.node)} -> ${gen(
                  replacementNode
                )}`
              );
              path.replaceWith(replacementNode);
            } else {
              debug.warn(
                `[INLINE-STR] Could not create a literal node for value at index ${index}.`
              );
            }
          } else {
            debug.warn(`[INLINE-STR] Index ${index} is out of bounds.`);
          }
        } else {
          debug.warn(
            `[INLINE-STR] Could not statically resolve index for call: ${gen(
              path.node
            )}`
          );
        }
      }
    },
  },
};
