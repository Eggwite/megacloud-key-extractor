# MegaCloud Key Extractor

A Node.js CLI tool to deobfuscate MegaCloud JavaScript code and extract the AES encryption key used to secure downloads. Built off Ciarands' deobfuscator project, extended to automatically pattern match and fetch the key locally.

## Features

- **Deobfuscation Pipeline**: Uses Babel plugins to normalize literals, unflatten control flow, inline arrays and functions, resolve string arrays and state machines, and simplify code.
- **Key Extraction**: Uses a babel plugin that eventually parses AST tree from deobfuscation pipeline and pattern matches against the tree for criteria. Matches are investigated to extract the AES key from the deobfuscated code.

## Installation

```powershell
npm install
```

## Usage

1. **Extract the key from obfuscated code**

   ```powershell
   node deobfuscate.js <input-file> [--silent]
   ```

   - `<input-file>`: Path to the obfuscated JavaScript file (default: `input.txt`).
   - `--silent`: Disable debug logs.

## Project Structure

```
├─ deobfuscate.js       # Main pipeline script
├─ quickDecrypt.js      # Simple AES decrypt script
├─ transformers/        # Babel plugins for each transform pass
│  ├─ normalizeLiterals.js
│  ├─ controlFlowUnflattener.js
│  ├─ inlineArrayBuilder.js
│  ├─ inlineProxiedFunctions.js
│  ├─ solveStringArray.js
│  ├─ solveStateMachine.js
│  ├─ inlineStringArray.js
│  ├─ inlineObjectFunctionProperties.js
│  ├─ removeDeadBranches.js
│  └─ removeUnusedVariables.js
├─ examples/            # Sample of observed obfuscated key-gen patterns
└─ README.md
```

## Credits

Thanks to the original author [Ciarands](https://github.com/Ciarands/) for [original script](https://github.com/Ciarands/e1-player-deobf).

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See the LICENSE file for details.
