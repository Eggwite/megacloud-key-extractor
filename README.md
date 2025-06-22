# MegaCloud Key Extractor

> This script struggles with NEW patterns that are constantly appearing and thus is not guaranteed to work if at all. As of the update to the README, the obfuscated script file has a significantly changed structure. Consider finding a Crypto-JS patch alternative. 

A Node.js CLI tool to deobfuscate MegaCloud obfuscated JavaScript code and extract the AES encryption key used to secure stream URLs, built off Ciaran's deobfuscator project, extended to pattern match and fetch the key locally automatically. A write-up on the development of this plugin can be found [here](https://eggwite.moe/blog/megacloud-key-extraction-analysis)

## Features

- **Multi-Pass Deobfuscation**: Employs a sophisticated pipeline of Babel plugins to systematically reverse common JavaScript obfuscation techniques.
- **Advanced Key Extraction**: After deobfuscation, a dedicated plugin analyses the Abstract Syntax Tree (AST) to identify and extract the AES key using various pattern-matching strategies.
- **Modular & Debuggable**: Each transformation pass is a separate, debuggable module, allowing for easier maintenance and analysis of the deobfuscation process.
- **Control Flow Unflattening**: Reconstructs the original program flow from flattened `while` or `for` loops containing a `switch` statement.
- **State Machine Solving**: Emulates and resolves obfuscated state machines to simplify the code.
- **String Array Decoding**: Decrypts and replaces calls to large, encoded string arrays with their plaintext values.

## Installation

```powershell
npm install
```

## Usage

  **Extract the key from the obfuscated code**

```bash
node deobfuscate.js <input-file> [--silent]
```

   -   `<input-file>`: Path to the obfuscated JavaScript file (default: `input.txt`).
   -   `--silent`: Disable debug logs for a cleaner output.

Or just run the `deobfuscate.js` entry point with the correct input file in the script.
``` JS
//...
// Process command line arguments
const inputFile = process.argv[2] || 'input.txt'; // <-- Changeme (if you want)
//...
```


## How It Works

The deobfuscator runs the input script through a series of Babel transformations. Each pass simplifies the code further, making it easier for the next pass to analyse.

1.  **Pass 1: Normalization & Unflattening**
    -   `normalizeLiterals`: Simplifies constant expressions (e.g., `1+1` -> `2`).
    -   `controlFlowUnflattener`: Reverts control-flow flattening, turning complex `for-switch` patterns back into readable `if`, `while`, and sequence blocks.

2.  **Pass 2: Data Inlining**
    -   `inlineArrayBuilder`: Replaces array member access with constant values where the array is built through sequential assignments.
    -   `inlineWrapperFunctions`: Inlines proxied or wrapper functions to reveal the true underlying function calls.

3.  **Pass 3: Core Logic Solving**
    -   `solveStringArray`: Decodes the primary shuffled and encoded string array used by the script.
    -   `solveStateMachine`: Resolves simple state machines that hide logic behind state variables.

4.  **Pass 4: String Array Inlining**
    -   `inlineStringArray`: Replaces all calls to the now-decoded string array accessor with their string literal values.

5.  **Pass 5: Final Simplification**
    -   `inlineObjectFunctionProperties`: Inlines simple functions on objects that return literals.
    -   `removeDeadBranches`: Removes `if` statements where the condition is a constant `true` or `false`.
    -   `removeUnusedVariables`: Cleans up the code by removing variables and functions that are no longer referenced.

6.  **Pass 6: Key Extraction**
    -   `findAndExtractKeyPlugin`: The final step. This complex plugin traverses the cleaned-up AST, looking for multiple **known** patterns that construct the AES key. It can handle keys constructed from joined arrays, concatenated function calls, reversed strings, and more. The result is printed to the console.

## Project Structure

```
.
├─ deobfuscate.js       # Main pipeline script that orchestrates all transformations.
├─ quickDecrypt.js      # A simple utility script for manually decrypting a value with a known key.
├─ transformers/        # Directory for all Babel plugins.
│  ├─ centralDebug.js
│  ├─ controlFlowUnflattener.js
│  ├─ inlineArrayBuilder.js
│  ├─ inlineObjectFunctionProperties.js
│  ├─ inlineProxiedFunctions.js
│  ├─ inlineStringArray.js
│  ├─ normalizeLiterals.js
│  ├─ removeDeadBranches.js
│  ├─ removeUnusedVariables.js
│  ├─ solveStateMachine.js
│  ├─ solveStringArray.js
│  └─ key-extraction/    # The dedicated key extraction module.
│     ├─ index.js
│     ├─ core/keyExtractionPlugin.js # The main plugin logic.
│     ├─ collectors/      # AST node collectors (e.g., for arrays).
│     ├─ extractors/      # Specific pattern extractors (e.g., for Array join).
│     └─ ...
├─ examples/            # Sample of observed obfuscated key-gen patterns (not comprehensive).
└─ README.md
```

## Key Extraction Example

The `findAndExtractKeyPlugin` is designed to find the AES key by recognising common patterns in the deobfuscated code. Let's walk through a more complex example.

Consider the following simplified snippet of deobfuscated code, which constructs the key from an array of character codes:

```javascript
//... Somewhere down the script, down there, in the trenches...
if (!o[103210].o2r0mKV()) {
    var E, j, i, X, r, y0, q4, z_, s, K, Q, I, g, D, P, F, N, y, z, A, H, B, C, U, O, q, G, V, a, t, u, w, h, Y; // Not relevant
    E = [
      100, 102, 57, 50, 56, 51, 51, 56, 56, 100, 52, 55, 54, 48, 101, 54, 101, 57, 97, 52, 97, 48, 99, 99, 55, 51, 98,
      101, 49, 51, 52, 53, 51, 98, 51, 56, 53, 97, 99, 102, 51, 56, 57, 51, 55, 50, 50, 55, 55, 48, 56, 99, 48, 102, 55,
      97, 98, 54, 55, 57, 57, 53, 98, 97
    ];

    j = () => {
      o.l6T.R0DdC_o();
      if (!o.Z9D.S$gTmE1()) {
        return String.fromCharCode(...E);
      }
    };

// ... elsewhere in the code, the key is used
// CryptoJS.AES.decrypt(encryptedData, j());
```

The extractor follows these steps:

1.  **Identify the Decryption Call**: The plugin first locates the call to `CryptoJS.AES.decrypt()`. The second argument to this function is the key. In this case, it would be `j()`.

2.  **Trace the Key Variable**: It then traces the key back to its origin, which is the function `j`.

3.  **Resolve the Key-Generating Function**: The plugin analyses the AST of the key-generating function (`j`) to determine its return value.

4.  **Evaluate the Expression**: Inside `j`, it finds the `return` statement with the expression `String.fromCharCode(...E)`. The extractor is smart enough to resolve this:
    *   It identifies `String.fromCharCode` as a known function it can emulate.
    *   It finds the variable `E` and resolves it to the array of numbers.

5.  **Construct the Final Key**: Finally, it emulates the `String.fromCharCode(...E)` call, converting each character code in the array `E` into a character and joining them to produce the final key string.

The resulting key is then printed to the console. This same logic applies to other patterns, such as keys built from concatenated strings, sliced strings, or reversed strings.

## Credits

Thanks to the original author [Ciarands](https://github.com/Ciarands/) for the [original script](https://github.com/Ciarands/e1-player-deobf), which this project is based on.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the LICENSE file for details.

---
pls star
