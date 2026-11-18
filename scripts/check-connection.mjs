// Verifies the MongoDB connection from server/.env and lists the store's
// collections with document counts:  npm run db:check
import { closeDb, connect, describeDatabase } from "../src/db.js";
import { envPath, missingConfig } from "../src/env.js";

const missing = missingConfig();
if (missing.length > 0) {
  console.error(
    `Missing ${missing.join(", ")} in ${envPath}.\n` +
      'Set e.g. MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>/olevs?retryWrites=true&w=majority"'
  );
  process.exit(1);
}

try {
  const db = await connect();
  const { name } = describeDatabase();
  console.log(`✔ Connected to MongoDB database "${name}"`);

  for (const collection of ["products", "orders", "settings", "counters"]) {
    const count = await db.collection(collection).countDocuments();
    console.log(`  ${collection.padEnd(10)} ${count}`);
  }
} catch (error) {
  console.error("✖ Connection failed:", error.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
