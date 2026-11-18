// Drops the store's MongoDB collections so the next server start re-seeds the
// catalog (src/data/catalog.json) and the deterministic demo orders.
import { closeDb, connect, describeDatabase } from "../src/db.js";
import { missingConfig } from "../src/env.js";

const missing = missingConfig();
if (missing.length > 0) {
  console.error(`Missing ${missing.join(", ")} in server/.env — nothing to reset.`);
  process.exit(1);
}

try {
  const db = await connect();
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  const names = collections
    .map((entry) => entry.name)
    .filter((name) =>
      ["products", "orders", "categories", "settings", "counters"].includes(name)
    );

  for (const name of names) {
    await db.collection(name).drop();
  }

  console.log(
    `Dropped ${names.length} collection(s) from "${describeDatabase().name}": ${names.join(", ") || "none"}.`
  );
  console.log("Start the server again to re-seed the catalog and demo orders.");
} catch (error) {
  console.error("Reset failed:", error.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
