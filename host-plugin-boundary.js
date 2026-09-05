// ----------------------------------------------------------------------------------------------
// @desc Reject client modules and external imports anywhere in the host build's dependency graph.
// @param {object} metafile - esbuild metadata containing inputs and outputs, including tree-shaken inputs.
// @returns {void} Throws with offending paths and repair guidance when the boundary is crossed.
export function assertHostPluginBoundary(metafile) {
  const violations = new Set();
  for (const [inputPath, input] of Object.entries(metafile.inputs)) {
    const normalizedPath = inputPath.replaceAll("\\", "/");
    const isHook = /(^|\/)lib\/hooks\//.test(normalizedPath);
    const isComponent = /\.[jt]sx$/.test(normalizedPath);
    const isReact = /(^|\/)node_modules\/(react|react-dom)(\/|$)/.test(normalizedPath);
    if (isHook || isComponent || isReact) violations.add(inputPath);
    for (const dependency of input.imports) {
      if (dependency.external) violations.add(`${ inputPath } imports ${ dependency.path }`);
    }
  }
  for (const output of Object.values(metafile.outputs)) {
    for (const dependency of output.imports) {
      if (dependency.external) violations.add(`External runtime import: ${ dependency.path }`);
    }
  }
  if (violations.size > 0) {
    const details = [...violations].join("\n- ");
    throw new Error(`Host plugin dependency boundary violated:\n- ${ details }\n`
      + "Move shared logic into a React-free utility/service; host code must not import hooks, components, or external packages.");
  }
}
