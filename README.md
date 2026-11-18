# OLEVS store API

Node HTTP API backing the storefront and the admin dashboard. It stores the
catalog, orders and store settings in **MongoDB** and serves the built React app
from the same origin.

## 1. Configure the database

```bash
cd server
cp .env.example .env     # already present in this checkout
```

Put your connection string in `server/.env`:

```ini
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/olevs?retryWrites=true&w=majority
MONGODB_DB=olevs
```

- **Atlas (free, no card):** create an M0 cluster at
  https://www.mongodb.com/cloud/atlas/register, add a database user under
  *Database Access*, allow your IP under *Network Access* (or `0.0.0.0/0` for
  local development only), then copy the Node.js driver string from
  *Connect → Drivers*.
- **Local server:** `MONGODB_URI=mongodb://127.0.0.1:27017/olevs`.

Check the connection before starting the API:

```bash
npm run db:check
```

`.env` is gitignored; `.env.example` is safe to commit. Real environment
variables always take precedence over the file. Node's built-in `.env` loader is
used, so there is no `dotenv` dependency.

### Environment variables

| Variable        | Default               | Purpose                                        |
| --------------- | --------------------- | ---------------------------------------------- |
| `MONGODB_URI`   | — (required)          | MongoDB connection string                      |
| `MONGODB_DB`    | URI path, else `olevs`| Database name override                         |
| `PORT`          | `4000`                | API port                                       |
| `HOST`          | `127.0.0.1`           | Bind address (`0.0.0.0` for LAN)               |
| `NODE_ENV`      | `development`         | Logged on boot                                 |
| `LOG_REQUESTS`  | `true`                | Set `false` to silence the request log         |
| `OLEVS_DIST`    | `storefront/dist`     | Built storefront served by this server         |
| `ADMIN_EMAIL`   | `admin@olevswatchshop.com` | First admin account, created on first boot |
| `ADMIN_PASSWORD`| random, printed once  | Password for that first admin account          |
| `COOKIE_SECURE` | on when `NODE_ENV=production` | Force `Secure` on the session cookie    |

## 2. Run it

```bash
cd server
npm run dev        # http://127.0.0.1:4000, restarts on file changes
# or: npm start
```

Then, in another terminal:

```bash
cd storefront
npm run dev        # http://127.0.0.1:5173, proxies /api to the server
```

The database is created and seeded automatically on first start: 26 products
from `src/data/catalog.json` plus 36 deterministic demo orders. Existing data is
never overwritten.

### Collections

| Collection | Contents                                                          |
| ---------- | ----------------------------------------------------------------- |
| `products` | One document per watch, `_id` is the numeric product id           |
| `orders`   | One document per order, `_id` is the `OWS-######` id, items embedded |
| `settings` | Single `{ _id: "store", values: {...} }` document                 |
| `counters` | Allocates the next product id                                     |
| `users`    | One document per account: unique `email`, scrypt password hash, `role` (`customer` or `admin`) |
| `sessions` | SHA-256 hashes of session tokens with a TTL index on `expiresAt`  |

## Production

```bash
cd storefront && npm run build
cd ../server && npm start
```

`src/index.js` serves the built SPA from `storefront/dist` with an
`index.html` fallback for client-side routes, so the whole shop runs on one
origin and one port. Product photos are in `storefront/public/products/` and are
referenced by stable `/products/*.webp` paths, so the same URLs work in the API,
in development and in the built app.

## Endpoints

| Method   | Path                   | Auth    | Description                                    |
| -------- | ---------------------- | ------- | ---------------------------------------------- |
| `GET`    | `/api/health`          | public  | Liveness plus product/order counts and DB info |
| `POST`   | `/api/auth/register`   | public  | Create a customer account and sign in          |
| `POST`   | `/api/auth/login`      | public  | Sign in — `{ "email", "password" }`            |
| `POST`   | `/api/auth/logout`     | any     | Clear the session cookie                       |
| `GET`    | `/api/auth/me`         | any     | `{ user }` for the current session, or `null`  |
| `GET`    | `/api/products`        | public  | Full catalog                                   |
| `GET`    | `/api/products/:id`    | public  | One product                                    |
| `POST`   | `/api/products`        | admin   | Create a product                               |
| `PUT`    | `/api/products/:id`    | admin   | Update a product                               |
| `DELETE` | `/api/products/:id`    | admin   | Delete a product                               |
| `GET`    | `/api/orders`          | admin   | Orders, newest first (`?status=`, `?q=`, `?limit=`) |
| `GET`    | `/api/orders/:id`      | public  | One order (used by order tracking)             |
| `POST`   | `/api/orders`          | public  | Place an order                                 |
| `PATCH`  | `/api/orders/:id`      | admin   | Update status — `{ "status": "shipped" }`      |
| `GET`    | `/api/customers`       | admin   | Customers derived from order history           |
| `GET`    | `/api/settings`        | public  | Store profile + low-stock threshold            |
| `PUT`    | `/api/settings`        | admin   | Update settings                                |
| `POST`   | `/api/admin/reset`     | admin   | Re-seed catalog, demo orders and settings      |

Orders are priced by the server, not the browser: item prices come from the
database, shipping is free from ৳2,000 (otherwise ৳80), and coupons `OLEVS10`
(10%) and `LUXURY20` (20%) are applied server-side. Unknown products, out-of-stock
quantities and invalid statuses are rejected with `409`/`422`.

## Reset the data

```bash
cd server
npm run seed:reset   # drops the store's collections; next start re-seeds
```

Or from the admin dashboard: **Settings → Reset all data** calls
`POST /api/admin/reset` on the running server.

## Accounts and the admin console

The first admin account is created on boot: it uses `ADMIN_EMAIL` and
`ADMIN_PASSWORD` from `server/.env`, or a random password that is printed once
in the server log. Only the scrypt hash is stored in MongoDB.

The admin console at `/admin` requires an admin session; `/login` also accepts
admin credentials and sends admins straight to the console. Creating an account
on `/register` always produces a `customer`, who can browse and order but gets
`403` from the admin endpoints.

Sessions are random 256-bit tokens kept in the `sessions` collection, sent in an
`HttpOnly` `SameSite=Lax` cookie (7 days, `Secure` in production). Passwords use
Node's built-in `scrypt`, so there is no auth dependency. Sign-in attempts are
throttled to 10 per email/IP per 10 minutes.

Create an admin, or reset an existing admin's password (this signs that account
out everywhere and leaves products/orders untouched):

```bash
cd server
npm run admin:create -- admin@olevswatchshop.com "a-long-password"
```

## Security notes

Every write and every customer-data read (orders list, customers, settings, reset)
requires an admin session, and cookies are only sent same-origin. Two things are
still worth knowing before exposing this publicly:

- `/api/orders/:id` and order tracking are public by design — the `OWS-######` id
  is the only secret, so anyone who knows an id can read that order.
- Terminate TLS in front of the server (and set `COOKIE_SECURE=true`), keep the
  server bound to `127.0.0.1` behind a reverse proxy, and never commit
  `server/.env` (it holds the database credentials) or ship it to the browser.
- Catalog/product data is public: never put secrets in product fields.
