import * as fs from "fs";
import * as path from "path";

const ROOT = path.join(__dirname, "..");
const TARGETS = [
  "deployments/base-sepolia.json",
  ".openzeppelin/base-sepolia.json",
];

function main(): void {
  let removed = 0;
  for (const rel of TARGETS) {
    const abs = path.join(ROOT, rel);
    if (fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      console.log(`[reset] removed ${rel}`);
      removed++;
    } else {
      console.log(`[reset] not present: ${rel}`);
    }
  }
  console.log(`[reset] done — ${removed} file(s) removed`);
}

main();
