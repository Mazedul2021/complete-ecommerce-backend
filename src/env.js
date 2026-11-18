import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export const envPath = join(here, "..", ".env");

// Node ships a .env loader, so no dotenv dependency is needed. Values already
// present in the real environment always win over the file.
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const text = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" ? undefined : trimmed;
};

const integer = (value, fallback) => {
  const parsed = Number(text(value));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const config = {
  nodeEnv: text(process.env.NODE_ENV) ?? "development",
  port: integer(process.env.PORT, 4000),
  host: text(process.env.HOST) ?? "127.0.0.1",
  mongoUri: text(process.env.MONGODB_URI),
  // Optional: when omitted the database name comes from the URI path.
  mongoDbName: text(process.env.MONGODB_DB),
  distDir: text(process.env.OLEVS_DIST),
  logRequests: text(process.env.LOG_REQUESTS) !== "false",
  // Admin bootstrap: used only while no admin account exists.
  adminEmail: text(process.env.ADMIN_EMAIL) ?? "admin@olevswatchshop.com",
  adminPassword: text(process.env.ADMIN_PASSWORD),
  // Cookies are marked Secure by default in production, or when forced.
  cookieSecure:
    text(process.env.COOKIE_SECURE) === "true" ||
    text(process.env.NODE_ENV) === "production",
};

export const missingConfig = () => {
  const missing = [];
  if (!config.mongoUri) missing.push("MONGODB_URI");
  return missing;
};
