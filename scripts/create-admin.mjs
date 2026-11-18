// Creates an admin account or resets the password of an existing one.
//   npm run admin:create -- admin@olevswatchshop.com "new-password"
// Without a password it falls back to ADMIN_PASSWORD from server/.env.
import { closeDb, connect, describeDatabase } from "../src/db.js";
import { config } from "../src/env.js";
import { upsertAdmin } from "../src/auth.js";

const [emailArg, passwordArg] = process.argv.slice(2);
const email = emailArg ?? config.adminEmail;
const password = passwordArg ?? config.adminPassword;

if (!password) {
  console.error(
    "Usage: npm run admin:create -- <email> <password>\n" +
      "   or set ADMIN_PASSWORD in server/.env"
  );
  process.exit(1);
}

if (String(password).length < 8) {
  console.error("✖ The password must be at least 8 characters.");
  process.exit(1);
}

try {
  await connect();
  const admin = await upsertAdmin({ email, password });
  console.log(`✔ Admin account ready for ${admin.email} on "${describeDatabase().name}".`);
  console.log("  Any sessions for that account were signed out; existing product/order data was not touched.");
} catch (error) {
  console.error("✖ Could not create the admin account:", error.message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
