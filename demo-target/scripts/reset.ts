import * as fs from "fs";
import * as path from "path";

import { getNetworkPathsFromCli } from "./lib/paths";

function main(): void {
  const paths = getNetworkPathsFromCli();
  console.log(`[reset] network: ${paths.name} (slug ${paths.slug})`);

  const root = path.join(__dirname, "..");
  const targets = [
    path.relative(root, paths.deploymentsPath),
    path.join(".openzeppelin", `${paths.slug}.json`),
  ];

  let removed = 0;
  for (const rel of targets) {
    const abs = path.join(root, rel);
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
