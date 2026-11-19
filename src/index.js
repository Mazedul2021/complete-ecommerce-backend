import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureAdminUser } from "./auth.js";
import { closeDb, connect, describeDatabase } from "./db.js";
import { config, envPath, missingConfig } from "./env.js";
import { handleApi } from "./routes.js";
import { ensureSeeded } from "./store.js";

const here = dirname(fileURLToPath(import.meta.url));
const distDir = config.distDir ?? resolve(here, "../../storefront/dist");
const { port, host } = config;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const sendJson = (res, status, payload, details) => {
  const body = JSON.stringify(
    details ? { error: payload, details } : { error: payload },
  );
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};

// Same-origin writes only, on top of the cookie session: random pages on other
// origins must not be able to drive the signed-in admin's session (CSRF).
const allowedOrigins = new Set(
  (
    process.env.ALLOWED_ORIGINS ??
    "https://olevswatchshop.netlify.app"
  )
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean)
);

const originAllowed = (req) => {
  const origin = req.headers.origin;

  if (!origin) return true;

  try {
    const parsed = new URL(origin);
    const normalizedOrigin = parsed.origin;

    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      return true;
    }

    return allowedOrigins.has(normalizedOrigin);
  } catch {
    return false;
  }
};

const serveStatic = (req, res, pathname) => {
  if (!existsSync(distDir)) {
    return sendJson(
      res,
      404,
      "API only — run `npm run build` inside storefront to serve the app from here.",
    );
  }

  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, "Malformed URL.");
  }

  let filePath = resolve(distDir, `.${decoded}`);
  if (
    filePath !== distDir &&
    !filePath.startsWith(`${distDir}\\`) &&
    !filePath.startsWith(`${distDir}/`)
  ) {
    return sendJson(res, 403, "Forbidden.");
  }

  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(distDir, "index.html");
  }
  if (!existsSync(filePath)) return sendJson(res, 404, "Not found.");

  const extension = extname(filePath).toLowerCase();
  const isHtml = extension === ".html";

  res.writeHead(200, {
    "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
    "Cache-Control": isHtml ? "no-cache" : "public, max-age=3600",
  });

  if (req.method === "HEAD") return res.end();
  createReadStream(filePath).pipe(res);
};

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );

  if (config.logRequests) {
    res.on("finish", () => {
      if (
        url.pathname.startsWith("/assets/") ||
        url.pathname.startsWith("/products/")
      )
        return;
      console.log(
        `${req.method} ${url.pathname} → ${res.statusCode} (${Date.now() - startedAt}ms)`,
      );
    });
  }

  try {
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      if (!originAllowed(req)) {
        return sendJson(
          res,
          403,
          "Requests from other origins are not allowed.",
        );
      }

      if (req.headers.origin) {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);

        res.setHeader("Vary", "Origin");

        res.setHeader("Access-Control-Allow-Credentials", "true");

        res.setHeader(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization",
        );

        res.setHeader(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        );

        res.setHeader("Access-Control-Max-Age", "86400");
      }

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }

      return await handleApi(req, res, url);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      return sendJson(res, 405, "Method not allowed.");
    }

    return serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = Number(error.status) || 500;
    if (status >= 500) console.error("[api]", error);
    return sendJson(
      res,
      status,
      error.message ?? "Internal server error",
      error.details,
    );
  }
});

const boot = async () => {
  const missing = missingConfig();
  if (missing.length > 0) {
    console.error(
      `\n✖ Missing ${missing.join(", ")}.\n` +
        `  Add your MongoDB connection string to ${envPath}, e.g.\n` +
        '  MONGODB_URI="mongodb+srv://<user>:<password>@<cluster>/olevs?retryWrites=true&w=majority"\n' +
        "  (free cluster: https://www.mongodb.com/cloud/atlas/register)\n",
    );
    process.exitCode = 1;
    return;
  }

  try {
    await connect();
  } catch (error) {
    console.error("\n✖ Could not connect to MongoDB:", error.message, "\n");
    process.exitCode = 1;
    return;
  }

  const { name } = describeDatabase();
  console.log(`Connected to MongoDB database "${name}"`);

  await ensureSeeded();

  const admin = await ensureAdminUser();
  if (admin.created) {
    const line = "─".repeat(64);
    console.log(`\n${line}`);
    console.log(" Admin console account created (only printed once)");
    console.log(`   email:    ${admin.email}`);
    console.log(`   password: ${admin.password}`);
    console.log(
      admin.generated
        ? " Set ADMIN_EMAIL / ADMIN_PASSWORD in server/.env, or run\n `npm run admin:create -- <email> <password>` to choose your own."
        : " Credentials came from ADMIN_EMAIL / ADMIN_PASSWORD in server/.env.",
    );
    console.log(`${line}\n`);
  }

  server.listen(port, host, () => {
    console.log(`OLEVS API listening on http://${host}:${port}`);
    console.log(`Environment: ${config.nodeEnv}`);
    if (existsSync(distDir)) {
      console.log(`Serving built storefront from ${distDir}`);
    }
  });
};

const shutdown = (signal) => {
  console.log(`\n${signal} received, shutting down.`);
  server.close(async () => {
    await closeDb();
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await boot();
