import fs from 'fs';
import * as babel from '@babel/core';
import { normalizeLiterals } from './transformers/normalizeLiterals.js';
import { controlFlowUnflattener } from './transformers/controlFlowUnflattener.js';
import { inlineArrayBuilder } from './transformers/inlineArrayBuilder.js';
import { inlineWrapperFunctions } from './transformers/inlineProxiedFunctions.js';
import { solveStringArray } from './transformers/solveStringArray.js';
import { solveStateMachine } from './transformers/solveStateMachine.js';
import { inlineStringArray } from './transformers/inlineStringArray.js';
import { findAndExtractKeyPlugin } from './transformers/findAndExtractKey.js';
import { debug, setDebug } from './transformers/centralDebug.js';
import { inlineObjectFunctionProperties } from './transformers/inlineObjectFunctionProperties.js';
import { removeDeadBranches } from './transformers/removeDeadBranches.js';
import { removeUnusedVariables } from './transformers/removeUnusedVariables.js';
// Process command line arguments
const inputFile = process.argv[2] || 'input.txt'; // Default to input.txt if no arg provided
const silentMode = process.argv.includes('--silent');

// If silent mode, disable all debug logs
if (silentMode) {
  setDebug(false);
}

try {
  let intermediateCode;
  // normalize literals and unflatten cf
  debug.log(`Reading input from: ${inputFile}`);
  const inputCode = fs.readFileSync(inputFile, 'utf-8');
  debug.log('--- Starting Pass 1: Normalizing Literals and Unflattening Control Flow ---');
  const unflattenedResult = babel.transformSync(inputCode, {
    sourceType: 'script',
    plugins: [normalizeLiterals, controlFlowUnflattener],
    code: true
  });

  if (!unflattenedResult || !unflattenedResult.code) {
    throw new Error('Pass 1 (Normalizing and unflattening) failed to produce code.');
  }
  intermediateCode = unflattenedResult.code;
  debug.log('Pass 1 complete.');

  // inline data
  debug.log('--- Starting Pass 2: Inlining Arrays and Wrapper Funcs ---');
  const inlinedDataResult = babel.transformSync(intermediateCode, {
    sourceType: 'script',
    plugins: [inlineArrayBuilder, inlineWrapperFunctions],
    code: true
  });

  if (!inlinedDataResult || !inlinedDataResult.code) {
    throw new Error('Pass 2 (Inlining Arbitrary Data) failed to produce code.');
  }
  intermediateCode = inlinedDataResult.code;
  debug.log('Pass 2 complete.');

  // solve string array and state machine
  debug.log('--- Starting Pass 3: Solving String Array and Solving State Machine ---');
  const transformStringArray = babel.transformSync(intermediateCode, {
    sourceType: 'script',
    plugins: [solveStringArray, solveStateMachine],
    code: true
  });

  if (!transformStringArray || !transformStringArray.code) {
    throw new Error('Pass 3 (Solving String Array & State Machine) failed to produce code.');
  }
  intermediateCode = transformStringArray.code;
  debug.log('Pass 3 complete.');

  // --- Pass 4: Inlining String Array ---
  debug.log('--- Starting Pass 4: Inlining String Array ---');
  const inlineStringArr = babel.transformSync(intermediateCode, {
    sourceType: 'script',
    plugins: [inlineStringArray],
    code: true
  });

  if (!inlineStringArr || !inlineStringArr.code) {
    throw new Error('Pass 4 (Inlining String Array) failed to produce code.');
  }
  intermediateCode = inlineStringArr.code;
  debug.log('Pass 4 complete.');

  // --- Pass 5: Simplification ---
  debug.log('--- Starting Pass 5: Simplification (Inlining and Dead Branch Removal) ---');
  const simplificationResult = babel.transformSync(intermediateCode, {
    sourceType: 'script',
    plugins: [inlineObjectFunctionProperties, removeDeadBranches, removeUnusedVariables],
    code: true
  });
  if (!simplificationResult || !simplificationResult.code) {
    throw new Error('Pass 5 (Simplification) failed.');
  }
  intermediateCode = simplificationResult.code;
  debug.log('Pass 5 complete.');

  // --- Pass 6, find and extract key ---
  debug.log('--- Starting Pass 6: Finding and Extracting AES Key ---');
  const keyExtractionResult = babel.transformSync(intermediateCode, {
    sourceType: 'script',
    plugins: [findAndExtractKeyPlugin],
    code: false // We don't actually need the code output for this pass
  });
  debug.log('Pass 6 complete.');

  // Write final code to output.js for inspection
  const finalResult = babel.transformSync(intermediateCode, {
    sourceType: 'script',
    // Add no plugins here, just parse and generate code
    code: true,
    ast: false
  });
  if (finalResult && finalResult.code) {
    fs.writeFileSync('output.js', finalResult.code, 'utf-8');
    debug.log('Wrote final code to output.js');
  }

  // The key, if found, is printed by the plugin
} catch (err) {
  console.error('\nAn error occurred during deobfuscation:', err);
  process.exit(1);
}
