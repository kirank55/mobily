const fs = require("fs");
const t = fs.readFileSync("/home/kiran/code-wsl/mobily/cli/dist/index.js", "utf8");
const lines = t.split(/\n/);
console.log("count", (t.match(/@mobily\/shared/g) || []).length);
console.log("=== @mobily/shared lines ===");
lines.forEach((L, idx) => {
  if (L.includes("@mobily/shared")) console.log(idx + 1 + ": " + L);
});
console.log("=== first ~30 import lines (with multiline) ===");
let n = 0;
let inImp = false;
for (let idx = 0; idx < lines.length && n < 30; idx++) {
  const L = lines[idx];
  if (L.startsWith("import ")) inImp = true;
  if (inImp) {
    console.log(idx + 1 + ": " + L);
    n++;
    if (L.includes(" from ") || (/^import .*;$/.test(L))) inImp = false;
  }
}