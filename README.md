# MegaCloud Key Extractor

A Node.js CLI tool to deobfuscate MegaCloud JavaScript code and extract the AES encryption key used to secure downloads.

## Features

- **Deobfuscation Pipeline**: Uses Babel plugins to normalize literals, unflatten control flow, inline arrays and functions, resolve string arrays and state machines, and simplify code.
- **Key Extraction**: Detects and extracts the AES key from the deobfuscated code.
- **Quick Decrypt**: A simple script to decrypt data once you have the encrypted payload and key.
- **Examples**: Sample scripts demonstrating common obfuscation patterns in the `examples/` folder.

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

2. **Quick decrypt**
   ```powershell
   node quickDecrypt.js
   ```
   - Edit `quickDecrypt.js` to set your own `encrypted` string and extracted `key`.

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
├─ examples/            # Sample obfuscated scripts
└─ README.md
```

## License

ISC
