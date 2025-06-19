import * as t from "@babel/types";
import { debug } from "./centralDebug.js";

export const normalizeLiterals = {
  visitor: {
    "UnaryExpression|BinaryExpression|MemberExpression": {
      exit(path) {
        const evaluation = path.evaluate();

        if (evaluation.confident) {
          const newNode = t.valueToNode(evaluation.value);
          if (t.isLiteral(newNode) || t.isIdentifier({ name: "undefined" })) {
            debug.log(
              `[NORM-LIT] Simplifying ${path.type}: ${path.toString()} -> ${
                evaluation.value
              }`
            );
            path.replaceWith(newNode);
          }
        }
      },
    },

    StringLiteral(path) {
      const { extra } = path.node;

      if (extra && extra.raw) {
        const standardRepresentation = `'${path.node.value}'`;
        if (extra.raw !== standardRepresentation) {
          debug.log(
            `[NORM-LIT] Un-escaping String: ${extra.raw} -> '${path.node.value}'`
          );
          path.replaceWith(t.stringLiteral(path.node.value));
        }
      }
    },
  },
};
