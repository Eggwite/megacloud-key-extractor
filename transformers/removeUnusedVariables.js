export function removeUnusedVariables({ types: t }) {
  return {
    visitor: {
      Program(programPath) {
        // Targeted unused-binding removal without repeated full-tree scans
        programPath.scope.crawl();
        const toRemove = [];
        programPath.traverse({
          // Remove unreferenced function declarations
          FunctionDeclaration(path) {
            const binding = path.scope.getBinding(path.node.id.name);
            if (binding && !binding.referenced) toRemove.push(path);
          },
          // Remove unreferenced variable declarators (for functions/vars)
          VariableDeclarator(path) {
            if (t.isIdentifier(path.node.id)) {
              const binding = path.scope.getBinding(path.node.id.name);
              if (binding && !binding.referenced) toRemove.push(path);
            }
          },
        });
        toRemove.forEach((p) => p.remove());
      },
    },
  };
}
