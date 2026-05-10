import * as fs from "fs";
import * as path from "path";

import { getNetworkPathsFromCli } from "./lib/paths";
import { makeLogger } from "./lib/log";

const log = makeLogger("reset");

function main(): void {
  const paths = getNetworkPathsFromCli();
  log.start(`network: ${paths.name} (slug ${paths.slug})`);

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
      log.reset(`removed ${rel}`);
      removed++;
    } else {
      log.info(`not present: ${rel}`);
    }
  }
  log.ok(`done, ${removed} file(s) removed`);
}

main();
