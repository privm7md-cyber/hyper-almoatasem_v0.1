import "dotenv/config";
import { Client } from "pg";

// Read-only role inventory. Connects ONLY to the maintenance database
// (never to hyper_almoatasem) using the migrator URL with pathname replaced.
const sourceUrl = process.env.MIGRATION_DATABASE_URL;

if (!sourceUrl) {
  throw new Error("MIGRATION_DATABASE_URL is missing");
}

const adminUrl = new URL(sourceUrl);
adminUrl.pathname = "/postgres";

const client = new Client({
  connectionString: adminUrl.toString(),
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();
  const roles = await client.query(
    `SELECT rolname, rolcreatedb, rolsuper
       FROM pg_roles
      WHERE rolname IN ('hyper_owner', 'hyper_migrator', 'hyper_app', 'postgres')
      ORDER BY rolname;`,
  );
  console.log(JSON.stringify(roles.rows, null, 2));
} finally {
  await client.end().catch(() => {});
}
