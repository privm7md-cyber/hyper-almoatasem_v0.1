import "dotenv/config";
import { Client } from "pg";

// Read-only inventory: all roles and databases. Connects ONLY to the
// maintenance database (never to hyper_almoatasem).
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
    `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole, rolcanlogin
       FROM pg_roles
      ORDER BY rolname;`,
  );
  const dbs = await client.query(
    `SELECT d.datname, pg_get_userbyid(d.datdba) AS owner
       FROM pg_database d
      ORDER BY d.datname;`,
  );
  console.log(JSON.stringify({ roles: roles.rows, databases: dbs.rows }, null, 2));
} finally {
  await client.end().catch(() => {});
}
