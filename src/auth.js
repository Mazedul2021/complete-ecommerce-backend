import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { ObjectId } from "mongodb";
import { getDb, isDuplicateKey } from "./db.js";
import { config } from "./env.js";
import { httpError } from "./errors.js";

const scrypt = promisify(scryptCallback);

const SESSION_COOKIE = "ows_session";
const SESSION_DAYS = 7;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const PASSWORD_MIN = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const ROLE_ADMIN = "admin";
export const ROLE_CUSTOMER = "customer";

const users = () => getDb().collection("users");
const sessions = () => getDb().collection("sessions");

/* ------------------------------------------------------------------ */
/* Passwords                                                           */
/* ------------------------------------------------------------------ */

export const hashPassword = async (password) => {
  const salt = randomBytes(16);
  const hash = await scrypt(String(password), salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
};

export const verifyPassword = async (password, stored) => {
  const [scheme, saltPart, hashPart] = String(stored ?? "").split("$");
  if (scheme !== "scrypt" || !saltPart || !hashPart) return false;

  const expected = Buffer.from(hashPart, "base64url");
  if (expected.length === 0) return false;

  const actual = await scrypt(
    String(password),
    Buffer.from(saltPart, "base64url"),
    expected.length
  );

  return expected.length === actual.length && timingSafeEqual(expected, actual);
};

const randomPassword = () => {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(14);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
};

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();

export const publicUser = (doc) =>
  doc
    ? {
        id: String(doc._id),
        name: doc.name ?? "",
        email: doc.email ?? "",
        phone: doc.phone ?? "",
        role: doc.role ?? ROLE_CUSTOMER,
        createdAt: doc.createdAt ?? null,
      }
    : null;

const validationErrors = ({ name, email, password, requirePassword }) => {
  const errors = [];

  if (String(name ?? "").trim().length < 2) {
    errors.push("Please enter your full name.");
  }
  if (!EMAIL_PATTERN.test(normalizeEmail(email))) {
    errors.push("Please enter a valid email address.");
  }
  if (requirePassword && String(password ?? "").length < PASSWORD_MIN) {
    errors.push(`Password must be at least ${PASSWORD_MIN} characters.`);
  }

  return errors;
};

export const registerUser = async ({ name, email, phone = "", password } = {}) => {
  const errors = validationErrors({ name, email, password, requirePassword: true });
  if (errors.length > 0) throw httpError(422, errors[0], errors);

  const cleanEmail = normalizeEmail(email);
  const now = new Date();
  const doc = {
    _id: new ObjectId(),
    name: String(name).trim(),
    email: cleanEmail,
    phone: String(phone ?? "").trim(),
    role: ROLE_CUSTOMER,
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  };

  try {
    await users().insertOne(doc);
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw httpError(409, "An account with that email already exists.");
    }
    throw error;
  }

  return doc;
};

export const authenticate = async (email, password) => {
  const doc = await users().findOne({ email: normalizeEmail(email) });

  if (!doc || !(await verifyPassword(password, doc.passwordHash))) {
    throw httpError(401, "Email or password is incorrect.");
  }

  return doc;
};

export const upsertAdmin = async ({ email, password, name = "Store administrator" }) => {
  const cleanEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const existing = await users().findOne({ email: cleanEmail });

  if (existing) {
    await users().updateOne(
      { _id: existing._id },
      { $set: { passwordHash, role: ROLE_ADMIN, updatedAt: now } }
    );
    await sessions().deleteMany({ userId: existing._id });
    return { ...existing, role: ROLE_ADMIN };
  }

  const doc = {
    _id: new ObjectId(),
    name,
    email: cleanEmail,
    phone: "",
    role: ROLE_ADMIN,
    passwordHash,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await users().insertOne(doc);
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw httpError(409, `The email ${cleanEmail} is already used by another account.`);
    }
    throw error;
  }

  return doc;
};

/**
 * Creates the first admin once. Credentials come from ADMIN_EMAIL /
 * ADMIN_PASSWORD; without ADMIN_PASSWORD a random password is generated and
 * returned so it can be printed a single time at boot.
 */
export const ensureAdminUser = async () => {
  const existing = await users().findOne({ role: ROLE_ADMIN });
  if (existing) return { created: false, email: existing.email };

  const generated = !config.adminPassword;
  const password = config.adminPassword ?? randomPassword();
  const admin = await upsertAdmin({ email: config.adminEmail, password });

  return { created: true, email: admin.email, password, generated };
};

/* ------------------------------------------------------------------ */
/* Sessions (Mongo-backed, cookie carries a random token)              */
/* ------------------------------------------------------------------ */

const tokenHash = (token) => createHash("sha256").update(String(token)).digest("hex");

export const createSession = async (user) => {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);

  await sessions().insertOne({
    _id: tokenHash(token),
    userId: user._id,
    role: user.role ?? ROLE_CUSTOMER,
    createdAt: new Date(),
    expiresAt,
  });

  return { token, expiresAt };
};

const cookieAttributes = () => {
  const parts = ["Path=/", "HttpOnly", `SameSite=${config.cookieSameSite}`];
  // SameSite=None is only accepted by browsers over HTTPS.
  if (config.cookieSecure || config.cookieSameSite === "None") parts.push("Secure");
  return parts;
};

export const sessionCookie = ({ token, expiresAt }) => {
  const maxAge = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return [
    `${SESSION_COOKIE}=${token}`,
    ...cookieAttributes(),
    `Max-Age=${maxAge}`,
  ].join("; ");
};

export const clearSessionCookie = () =>
  [`${SESSION_COOKIE}=`, ...cookieAttributes(), "Max-Age=0"].join("; ");

export const startSession = async (res, user) => {
  const session = await createSession(user);
  res.setHeader("Set-Cookie", sessionCookie(session));
  return session;
};

export const endSession = async (req, res) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (token) await sessions().deleteOne({ _id: tokenHash(token) });
  res.setHeader("Set-Cookie", clearSessionCookie());
};

const readCookie = (req, name) => {
  const header = req.headers?.cookie;
  if (!header) return null;

  for (const part of String(header).split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return null;
};

export const currentUser = async (req) => {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) return null;

  const session = await sessions().findOne({ _id: tokenHash(token) });
  if (!session) return null;

  if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
    await sessions().deleteOne({ _id: session._id });
    return null;
  }

  const user = await users().findOne({ _id: session.userId });
  if (!user) {
    await sessions().deleteOne({ _id: session._id });
    return null;
  }

  return user;
};

/* ------------------------------------------------------------------ */
/* Guards + login throttling                                           */
/* ------------------------------------------------------------------ */

export const requireUser = async (req) => {
  const user = await currentUser(req);
  if (!user) throw httpError(401, "Please sign in to continue.");
  return user;
};

export const requireAdmin = async (req) => {
  const user = await requireUser(req);
  if (user.role !== ROLE_ADMIN) {
    throw httpError(403, "This account does not have admin access.");
  }
  return user;
};

const loginAttempts = new Map();

const attemptKey = (req, email) =>
  `${req.socket?.remoteAddress ?? "unknown"}:${normalizeEmail(email)}`;

export const assertLoginAllowed = (req, email) => {
  const key = attemptKey(req, email);
  const entry = loginAttempts.get(key);
  if (!entry) return;

  if (entry.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return;
  }

  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    throw httpError(429, "Too many sign-in attempts. Please try again later.");
  }
};

export const recordLoginFailure = (req, email) => {
  const key = attemptKey(req, email);
  const entry = loginAttempts.get(key);
  const now = Date.now();

  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }

  entry.count += 1;

  if (loginAttempts.size > 5000) loginAttempts.clear();
};

export const clearLoginFailures = (req, email) => {
  loginAttempts.delete(attemptKey(req, email));
};
