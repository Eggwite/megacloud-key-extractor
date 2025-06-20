import * as t from '@babel/types';
import generate from '@babel/generator';
import { debug } from './centralDebug.js';

const gen = node => {
  return generate.default(node, { compact: true }).code;
};

function evaluateAstNode(node, args) {
  if (!node) throw new Error('evaluateAstNode received a null or undefined node.');
  if (t.isBinaryExpression(node)) {
    const left = evaluateAstNode(node.left, args);
    const right = evaluateAstNode(node.right, args);
    if (node.operator === '+') return left + right;
    const numLeft = Number(left);
    const numRight = Number(right);
    switch (node.operator) {
      case '-':
        return numLeft - numRight;
      case '*':
        return numLeft * numRight;
      case '/':
        return numLeft / numRight;
      case '%':
        return numLeft % numRight;
      case '>>':
        return numLeft >> numRight;
      case '<<':
        return numLeft << numRight;
      case '|':
        return numLeft | numRight;
      case '&':
        return numLeft & numRight;
      case '^':
        return numLeft ^ numRight;
      default:
        throw new Error(`Unsupported binary operator: ${node.operator}`);
    }
  }
  if (t.isUnaryExpression(node)) {
    const arg = evaluateAstNode(node.argument, args);
    switch (node.operator) {
      case '-':
        return -arg;
      case '+':
        return +arg;
      default:
        throw new Error(`Unsupported unary operator: ${node.operator}`);
    }
  }
  if (t.isMemberExpression(node)) {
    const index = evaluateAstNode(node.property, args);
    if (typeof index === 'number' && index < args.length) {
      return args[index];
    }
    throw new Error(`Invalid member expression access with index ${index}`);
  }
  if (t.isNumericLiteral(node) || t.isStringLiteral(node)) {
    return node.value;
  }
  if (t.isIdentifier(node) && node.name === 'undefined') {
    return undefined;
  }
  throw new Error(`Unsupported node type in evaluation: ${node.type} (${gen(node)})`);
}

export const solveStateMachine = {
  visitor: {
    Program: {
      enter(path, state) {
        state.stateMachineInfo = null;
        state.currentMachineState = null;
      }
    },

    AssignmentExpression(path, state) {
      if (state.stateMachineInfo) return;
      debug.log(`[STATE-MACHINE] Checking AssignmentExpression: ${gen(path.node.left)} = ...`);

      const right = path.get('right');
      if (!right.isCallExpression() || !right.get('callee').isFunctionExpression()) {
        return;
      }

      const callee = right.get('callee');
      const body = callee.get('body.body');
      const returnArg = body.length === 1 && body[0].isReturnStatement() ? body[0].get('argument') : null;

      if (!returnArg || !returnArg.isObjectExpression() || returnArg.get('properties').length !== 2) {
        return;
      }

      const stateVarName = callee.node.params.length === 1 ? callee.node.params[0].name : null;
      if (!stateVarName) {
        return;
      }

      debug.log(`  -> [PASS] Found potential SM pattern with state var '${stateVarName}'`);

      let setterName,
        calculatorName,
        logicMap = new Map();

      for (const prop of returnArg.get('properties')) {
        if (!prop.isObjectProperty()) continue;
        const propValue = prop.get('value');
        if (!propValue.isFunctionExpression()) continue;

        const key = prop.get('key');
        const propName = key.isIdentifier() ? key.node.name : key.isStringLiteral() ? key.node.value : null;
        if (!propName) continue;

        debug.log(`    -> Analyzing property: '${propName}'`);
        const propBody = propValue.get('body.body');

        const assignmentStmt = propBody.find(
          stmt =>
            stmt.isExpressionStatement() &&
            stmt.get('expression').isAssignmentExpression() &&
            stmt.get('expression.left').isIdentifier({ name: stateVarName })
        );
        if (propValue.get('params').length === 1 && assignmentStmt) {
          setterName = propName;
          debug.log(`      -> Identified as SETTER.`);
        }

        const switchStmt = propBody.find(n => n.isSwitchStatement());
        if (switchStmt && switchStmt.get('discriminant').isIdentifier({ name: stateVarName })) {
          calculatorName = propName;
          debug.log(`      -> Identified as CALCULATOR. Parsing cases...`);
          for (const switchCase of switchStmt.get('cases')) {
            const assignment = switchCase
              .get('consequent')
              .find(p => p.isExpressionStatement() && p.get('expression').isAssignmentExpression());
            if (assignment && switchCase.get('test').isNumericLiteral()) {
              const caseValue = switchCase.node.test.value;
              logicMap.set(caseValue, assignment.get('expression.right').node);
              debug.log(`        -> Stored logic for case ${caseValue}.`);
            }
          }
        }
      }

      if (setterName && calculatorName && logicMap.size > 0) {
        state.stateMachineInfo = {
          objectName: gen(path.node.left),
          setterName,
          calculatorName,
          logicMap
        };
        debug.log(`\n[STATE-MACHINE] State Machine fully parsed!`);
        debug.log(`   - Object Name: '${state.stateMachineInfo.objectName}'`);
        debug.log(`   - Setter Fn:   '${setterName}'`);
        debug.log(`   - Calculator Fn: '${calculatorName}'`);
        debug.log(`   - Logic map size: ${logicMap.size}\n`);
        path.getStatementParent().remove();
      } else {
        debug.error(`  -> [FAIL] Could not identify both a setter and a calculator from the properties.`);
      }
    },

    CallExpression: {
      exit(path, state) {
        const info = state.stateMachineInfo;
        if (!info) return;

        const callee = path.get('callee');
        if (!callee.isMemberExpression()) return;

        const objectCode = gen(callee.node.object);
        const propName = callee.node.property.name;

        if (objectCode !== info.objectName) return;

        if (propName === info.setterName) {
          const stateArg = path.get('arguments.0');
          if (!stateArg) return;

          const evaluation = stateArg.evaluate();
          if (evaluation.confident) {
            state.currentMachineState = evaluation.value;
            debug.log(`[STATE-MACHINE] State set to: ${state.currentMachineState} from call ${gen(path.node)}`);
            if (path.parentPath.isExpressionStatement()) {
              path.parentPath.remove();
            } else {
              path.replaceWith(t.identifier('undefined'));
            }
          } else {
            debug.warn(`[STATE-MACHINE] Could not determine state value for: ${gen(path.node)}`);
          }
        }

        if (propName === info.calculatorName) {
          const currentState = state.currentMachineState;
          if (currentState === null) {
            debug.warn(`[STATE-MACHINE] Calculator called before state was set: ${gen(path.node)}`);
            return;
          }

          const logicNode = info.logicMap.get(currentState);
          if (!logicNode) {
            debug.warn(`[STATE-MACHINE] No logic for state ${currentState} in call: ${gen(path.node)}`);
            return;
          }

          const argValues = path.get('arguments').map(p => {
            const evalResult = p.evaluate();
            if (!evalResult.confident) {
              debug.error(`Argument ${gen(p.node)} could not be evaluated confidently.`);
            }
            return evalResult.value;
          });

          try {
            const result = evaluateAstNode(logicNode, argValues);
            debug.log(`[STATE-MACHINE] Solved ${gen(path.node)} with state ${currentState} => ${result}`);
            path.replaceWith(t.valueToNode(result));
          } catch (e) {
            debug.error(`[STATE-MACHINE] Failed evaluation for ${gen(path.node)}: ${e.message}`);
          }
        }
      }
    }
  }
};
