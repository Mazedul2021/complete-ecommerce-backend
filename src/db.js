import { MongoClient } from "mongodb";
import { config, envPath, missingConfig } from "./env.js";

const DEFAULT_DB_NAME = "olevs";

let client;
let db;

const databaseNameFromUri = (uri) => {
  try {
    const name = new URL(uri).pathname.replace(/^\//, "").trim();
    return name || undefined;
  } catch {
    return undefined;
  }
};

export const databaseName = () =>
  config.mongoDbName ?? databaseNameFromUri(config.mongoUri ?? "") ?? DEFAULT_DB_NAME;

export const getDb = () => {
  if (!db) throw new Error("MongoDB is not connected yet.");
  return db;
};

const ensureIndexes = async (database) => {
  await Promise.all([
    database
      .collection("products")
      .createIndex({ sku: 1 }, { unique: true, name: "products_sku_unique" }),
    database.collection("orders").createIndex({ placedAt: -1 }, { name: "orders_placed_desc" }),
    database.collection("orders").createIndex({ status: 1 }, { name: "orders_status" }),
    database.collection("settings").createIndex({ key: 1 }, { name: "settings_key" }),
    database
      .collection("categories")
      .createIndex({ slug: 1 }, { unique: true, name: "categories_slug_unique" }),
    database
      .collection("subscribers")
      .createIndex({ email: 1 }, { unique: true, name: "subscribers_email_unique" }),
    database
      .collection("coupons")
      .createIndex({ code: 1 }, { unique: true, name: "coupons_code_unique" }),
    database
      .collection("reviews")
      .createIndex({ productId: 1, approved: 1 }, { name: "reviews_product" }),
    database.collection("users").createIndex({ email: 1 }, { unique: true, name: "users_email_unique" }),
    database
      .collection("sessions")
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "sessions_ttl" }),
    database.collection("sessions").createIndex({ userId: 1 }, { name: "sessions_user" }),
  ]);
};

export const connect = async () => {
  if (db) return db;

  const missing = missingConfig();
  if (missing.length > 0) {
    throw new Error(
      `Missing ${missing.join(", ")}. Add it to ${envPath}, for example:\n` +
        '  MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>/olevs?retryWrites=true&w=majority"'
    );
  }

  client = new MongoClient(config.mongoUri, {
    appName: "olevs-store-api",
    serverSelectionTimeoutMS: 8000,
  });

  await client.connect();
  db = client.db(databaseName());
  await db.command({ ping: 1 });
  await ensureIndexes(db);

  return db;
};

export const closeDb = async () => {
  if (!client) return;
  await client.close();
  client = undefined;
  db = undefined;
};

export const describeDatabase = () => ({
  driver: "mongodb",
  name: db?.databaseName ?? databaseName(),
  connected: Boolean(db),
});

/** Maps a duplicate-key error (unique SKU/index) to a boolean check. */
export const isDuplicateKey = (error) =>
  Boolean(error) && (error.code === 11000 || /E11000 duplicate key/i.test(error.message ?? ""));
