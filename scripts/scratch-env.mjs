import "dotenv/config";
import fs from "node:fs";

const sourceUrl = process.env.MIGRATION_DATABASE_URL;

if (!sourceUrl) {
  throw new Error("MIGRATION_DATABASE_URL is missing");
}

const scratchUrl = new URL(sourceUrl);
scratchUrl.pathname = "/hyper_almoatasem_scratch";

fs.writeFileSync(
  ".scratch-env",
  `DATABASE_URL=${scratchUrl.toString()}\nMIGRATION_DATABASE_URL=${scratchUrl.toString()}\n`,
  "utf8",
);

console.log("SCRATCH_ENV_CREATED");
