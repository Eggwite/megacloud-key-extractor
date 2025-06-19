import * as t from "@babel/types";
import generate from "@babel/generator";
import { debug } from "./centralDebug.js";

let largeStringInfo = null;
let decoderInfo = null;

function getNumericValue(node) {
  if (t.isNumericLiteral(node)) {
    return node.value;
  }
  if (
    t.isUnaryExpression(node) &&
    node.operator === "-" &&
    t.isNumericLiteral(node.argument)
  ) {
    return -node.argument.value;
  }
  return NaN;
}
function correctlyShuffle(arr, ops) {
  const newArr = [...arr];
  for (const op of ops) {
    const p1 = newArr.splice(op.s1_offset, op.s1_length);
    const p2 = p1.splice(op.s2_offset, op.s2_length);
    newArr.unshift(...p2);
  }
  return newArr;
}

export const solveStringArray = {
  visitor: {
    Program: {
      enter() {
        largeStringInfo = null;
        decoderInfo = null;
      },
      exit(programPath) {
        if (!largeStringInfo || !decoderInfo) {
          debug.error(
            "[SOLVE-STR] Could not find both the large string and the decoder. Aborting."
          );
          programPath.stop();
          return;
        }

        debug.log("[SOLVE-STR] Both targets found. Starting deobfuscation...");

        const { value: uriString } = largeStringInfo;
        const {
          xorKey,
          separator,
          statefulShuffleOps,
          path: decoderPath,
        } = decoderInfo;

        if (statefulShuffleOps.length === 0) {
          debug.error(
            "[SOLVE-STR] Failed to extract any shuffle operations. Aborting."
          );
          programPath.stop();
          return;
        }

        debug.log(
          `[SOLVE-STR] Successfully extracted ${statefulShuffleOps.length} shuffle operations.`
        );

        const decodedString = decodeURIComponent(uriString);

        let xorResult = "";
        for (let i = 0; i < decodedString.length; i++) {
          xorResult += String.fromCharCode(
            decodedString.charCodeAt(i) ^ xorKey.charCodeAt(i % xorKey.length)
          );
        }

        let processedArray = xorResult.split(separator);

        processedArray = correctlyShuffle(processedArray, statefulShuffleOps);

        debug.log(
          `[SOLVE-STR] Decrypted array with ${processedArray.length} elements.`
        );

        const innerArrayNode = t.arrayExpression(
          processedArray.map((s) => t.stringLiteral(s))
        );

        const functionParam = t.identifier("index");
        const returnStatement = t.returnStatement(
          t.memberExpression(innerArrayNode, functionParam, true)
        );

        const functionBody = t.blockStatement([returnStatement]);
        const newFunctionNode = t.functionExpression(
          null,
          [functionParam],
          functionBody
        );

        decoderPath.get("value").replaceWith(newFunctionNode);
        debug.log(
          `[SOLVE-STR] Replaced decoder IIFE with a new accessor function.`
        );

        largeStringInfo.path.remove();
        debug.log(`[SOLVE-STR] Removed large string function.`);
      },
    },

    FunctionDeclaration(path) {
      if (largeStringInfo) return;

      const body = path.get("body.body");
      if (body.length !== 1 || !body[0].isReturnStatement()) return;

      const returnArg = body[0].get("argument");
      if (!returnArg.isStringLiteral() || returnArg.node.value.length < 500)
        return;

      debug.log(
        `[SOLVE-STR] Found large string function: "${path.node.id.name}"`
      );
      largeStringInfo = {
        value: returnArg.node.value,
        path: path,
      };
    },

    ObjectProperty(path) {
      if (decoderInfo) return;
      const propValue = path.get("value");
      if (!propValue.isCallExpression()) return;

      const callee = propValue.get("callee");
      const args = propValue.get("arguments");
      if (
        !callee.isFunctionExpression() ||
        args.length !== 1 ||
        !args[0].isStringLiteral()
      )
        return;

      const xorKey = args[0].node.value;
      let separator = "";
      let isLikelyDecoder = false;

      callee.traverse({
        BinaryExpression(p) {
          if (p.node.operator === "^") isLikelyDecoder = true;
        },
        CallExpression(p) {
          const callArgs = p.get("arguments");
          if (
            callArgs.length === 2 &&
            callArgs[1].isStringLiteral() &&
            callArgs[1].node.value.length === 1
          ) {
            const parent = p.findParent((p) => p.isAssignmentExpression());
            if (parent) separator = callArgs[1].node.value;
          }
        },
      });

      if (!isLikelyDecoder || !separator) return;
      const functionSource = generate.default(callee.node).code;
      const regex =
        /(\-?\d+)\s*?,\s*?(\-?\d+)\)\s*?,\s*?(\-?\d+)\s*?,\s*?(\d+)/g; // hacked together hotfix, actually get this data properly later
      const allMatches = [...functionSource.matchAll(regex)];

      const foundOps = [];
      for (const match of allMatches) {
        const op = {
          s1_offset: parseInt(match[1], 10),
          s1_length: parseInt(match[2], 10),
          s2_offset: parseInt(match[3], 10),
          s2_length: parseInt(match[4], 10),
        };
        foundOps.push(op);
      }

      if (foundOps.length > 0) {
        const propKey = path.get("key");
        const propName = propKey.isIdentifier()
          ? propKey.node.name
          : propKey.isStringLiteral()
          ? propKey.node.value
          : "[computed]";
        debug.log(
          `[SOLVE-STR] Found decoder IIFE assigned to property: "${propName}"`
        );

        decoderInfo = {
          xorKey,
          separator,
          statefulShuffleOps: foundOps,
          path: path,
        };
      }
    },
  },
};
