import "dotenv/config";
import { Client } from "pg";

const connectionString = process.env.MIGRATION_DATABASE_URL;

if (!connectionString) {
  console.error("MIGRATION_DATABASE_URL is missing");
  process.exit(1);
}

const client = new Client({
  connectionString,
  connectionTimeoutMillis: 5000,
});

try {
  await client.connect();

  const result = await client.query(`
    SELECT
      current_database() AS database_name,
      current_user AS database_user,
      version() AS postgres_version;
  `);

  console.log(JSON.stringify(result.rows[0], null, 2));
} catch (error) {
  console.error("SCRATCH_CONNECTION_TEST_FAILED");
  console.error("name:", error?.name);
  console.error("code:", error?.code);
  console.error("message:", error?.message);
  console.error("severity:", error?.severity);
  console.error("detail:", error?.detail);
  console.error("hint:", error?.hint);
  console.error("routine:", error?.routine);
} finally {
  await client.end().catch(() => {});
}
