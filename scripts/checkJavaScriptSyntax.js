const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function collectJavaScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectJavaScriptFiles(target));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(target);
    }
  }
  return files.sort();
}

function checkJavaScriptFiles(files, spawn = spawnSync) {
  for (const file of files) {
    const result = spawn(process.execPath, ["--check", file], { stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) return Number.isInteger(result.status) ? result.status : 1;
  }
  return 0;
}

if (require.main === module) {
  try {
    const roots = process.argv.slice(2).map((root) => path.resolve(root));
    if (roots.length === 0) throw new Error("Provide at least one JavaScript source directory.");
    const files = roots.flatMap(collectJavaScriptFiles);
    if (files.length === 0) throw new Error("No JavaScript files were found.");
    process.exitCode = checkJavaScriptFiles(files);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { checkJavaScriptFiles, collectJavaScriptFiles };
