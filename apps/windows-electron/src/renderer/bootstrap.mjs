import { validateRendererModuleContract } from "./modules/contract.mjs";
import { rendererModules } from "./modules/index.mjs";

rendererModules.forEach(validateRendererModuleContract);
window.WinPlateRendererModules = Object.freeze(rendererModules);

await import("./app.js");
