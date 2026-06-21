(function initModuleDom(globalScope, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.WinPlateModuleDom = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  function syncRequestedModuleNodes(currentRoot, desiredRoot, moduleIds, syncNode) {
    if (!currentRoot || !desiredRoot || typeof syncNode !== "function") return false;
    let structureChanged = false;
    for (const id of moduleIds) {
      const safeId = String(id || "").replace(/[^a-z0-9_-]/gi, "");
      if (!safeId) continue;
      const selector = `[data-module-id="${safeId}"]`;
      const currentNodes = [...currentRoot.querySelectorAll(selector)];
      const desiredNodes = [...desiredRoot.querySelectorAll(selector)];
      if (!currentNodes.length || currentNodes.length !== desiredNodes.length) continue;
      currentNodes.forEach((node, index) => {
        structureChanged = Boolean(syncNode(node, desiredNodes[index])) || structureChanged;
      });
    }
    return structureChanged;
  }

  return { syncRequestedModuleNodes };
});
