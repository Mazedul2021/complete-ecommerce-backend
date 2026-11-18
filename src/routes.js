import {
  assertLoginAllowed,
  authenticate,
  clearLoginFailures,
  currentUser,
  endSession,
  publicUser,
  recordLoginFailure,
  registerUser,
  requireAdmin,
  requireUser,
  startSession,
} from "./auth.js";
import { describeDatabase, isDuplicateKey } from "./db.js";
import { httpError } from "./errors.js";
import * as store from "./store.js";

const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
};

const readJson = async (req) => {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw httpError(413, "Request body is too large.");
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (parsed === null || typeof parsed !== "object") {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw httpError(400, "Request body must be a JSON object.");
  }
};

const saveProduct = async (body, existing) => {
  const { errors, values } = store.validateProduct(body, existing);
  if (errors.length > 0) {
    throw httpError(422, errors[0], errors);
  }

  try {
    return existing
      ? await store.updateProduct(existing.id, values)
      : await store.createProduct(values);
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw httpError(409, `SKU ${values.sku} is already used by another product.`);
    }
    throw error;
  }
};

export const handleApi = async (req, res, url) => {
  const { pathname } = url;
  const method = req.method;

  if (pathname === "/api/health" && method === "GET") {
    return send(res, 200, {
      ok: true,
      products: await store.countProducts(),
      orders: await store.countOrders(),
      database: describeDatabase(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  }

  /* -------------------------------- auth -------------------------------- */

  if (pathname === "/api/auth/me" && method === "GET") {
    const user = await currentUser(req);
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === "/api/auth/register" && method === "POST") {
    const body = await readJson(req);
    const user = await registerUser(body);
    await startSession(res, user);
    return send(res, 201, { user: publicUser(user) });
  }

  if (pathname === "/api/auth/login" && method === "POST") {
    const body = await readJson(req);
    const email = String(body.email ?? "");

    assertLoginAllowed(req, email);

    let user;
    try {
      user = await authenticate(email, body.password);
    } catch (error) {
      recordLoginFailure(req, email);
      throw error;
    }

    clearLoginFailures(req, email);
    await startSession(res, user);
    return send(res, 200, { user: publicUser(user) });
  }

  if (pathname === "/api/auth/logout" && method === "POST") {
    await endSession(req, res);
    return send(res, 200, { ok: true });
  }

  /* ------------------------------ products ------------------------------ */

  if (pathname === "/api/products") {
    if (method === "GET") return send(res, 200, await store.listProducts());

    if (method === "POST") {
      await requireAdmin(req);
      const body = await readJson(req);
      return send(res, 201, await saveProduct(body, null));
    }
  }

  const productMatch = pathname.match(/^\/api\/products\/(\d+)$/);
  if (productMatch) {
    const id = Number(productMatch[1]);
    const existing = await store.getProduct(id);
    if (!existing) throw httpError(404, `Product ${id} not found.`);

    if (method === "GET") return send(res, 200, existing);
    if (method === "PUT") {
      await requireAdmin(req);
      const body = await readJson(req);
      return send(res, 200, await saveProduct(body, existing));
    }
    if (method === "DELETE") {
      await requireAdmin(req);
      await store.deleteProduct(id);
      return send(res, 200, { deleted: id });
    }
  }

  /* ----------------------------- categories ---------------------------- */

  if (pathname === "/api/categories") {
    if (method === "GET") return send(res, 200, await store.listCategories());

    if (method === "POST") {
      await requireAdmin(req);
      const body = await readJson(req);
      const { errors, values } = store.validateCategory(body, null);
      if (errors.length > 0) {
        throw httpError(422, errors[0], errors);
      }
      try {
        return send(res, 201, await store.createCategory(values));
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw httpError(409, `Slug ${values.slug} is already used by another category.`);
        }
        throw error;
      }
    }
  }

  const categoryMatch = pathname.match(/^\/api\/categories\/(\d+)$/);
  if (categoryMatch) {
    const id = Number(categoryMatch[1]);
    const existing = await store.getCategory(id);
    if (!existing) throw httpError(404, `Category ${id} not found.`);

    if (method === "GET") return send(res, 200, existing);
    if (method === "PUT") {
      await requireAdmin(req);
      const body = await readJson(req);
      const { errors, values } = store.validateCategory(body, existing);
      if (errors.length > 0) {
        throw httpError(422, errors[0], errors);
      }
      try {
        return send(res, 200, await store.updateCategory(id, values));
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw httpError(409, `Slug ${values.slug} is already used by another category.`);
        }
        throw error;
      }
    }
    if (method === "DELETE") {
      await requireAdmin(req);
      await store.deleteCategory(id);
      return send(res, 200, { deleted: id });
    }
  }

  /* ------------------------------- orders ------------------------------- */

  if (pathname === "/api/orders") {
    if (method === "GET") {
      // The order list contains customer contact details, so it is admin-only.
      await requireAdmin(req);
      return send(
        res,
        200,
        await store.listOrders({
          status: url.searchParams.get("status") ?? undefined,
          q: url.searchParams.get("q") ?? undefined,
          limit: url.searchParams.get("limit") ?? undefined,
        })
      );
    }
    if (method === "POST") {
      const user = await currentUser(req);
      return send(res, 201, await store.createOrder(await readJson(req), user));
    }
  }

  const orderMatch = pathname.match(/^\/api\/orders\/([A-Za-z0-9_-]+)$/);
  if (orderMatch) {
    const id = decodeURIComponent(orderMatch[1]);

    if (method === "GET") {
      // Public: order tracking looks orders up by their unguessable id.
      const order = await store.getOrder(id);
      if (!order) throw httpError(404, `Order ${id} not found.`);
      return send(res, 200, order);
    }

    if (method === "PATCH") {
      await requireAdmin(req);
      const body = await readJson(req);
      if (typeof body.status !== "string") {
        throw httpError(422, "A status value is required.");
      }
      return send(res, 200, await store.setOrderStatus(id, body.status));
    }
  }

  /* ----------------------------- customers ------------------------------ */

  if (pathname === "/api/customers" && method === "GET") {
    await requireAdmin(req);
    return send(res, 200, await store.listCustomers());
  }

  /* ---------------------------- contact/news --------------------------- */

  if (pathname === "/api/contact" && method === "POST") {
    return send(res, 201, await store.submitContactMessage(await readJson(req)));
  }

  if (pathname === "/api/newsletter" && method === "POST") {
    return send(res, 200, await store.subscribeEmail(await readJson(req)));
  }

  if (pathname === "/api/messages" && method === "GET") {
    await requireAdmin(req);
    return send(res, 200, await store.listMessages());
  }

  const messageMatch = pathname.match(/^\/api\/messages\/([a-f0-9]{24})$/i);
  if (messageMatch) {
    await requireAdmin(req);
    const id = messageMatch[1];
    if (method === "PATCH") {
      const body = await readJson(req);
      await store.setMessageRead(id, Boolean(body.read));
      return send(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      await store.deleteMessage(id);
      return send(res, 200, { deleted: id });
    }
  }

  if (pathname === "/api/subscribers" && method === "GET") {
    await requireAdmin(req);
    return send(res, 200, await store.listSubscribers());
  }

  /* ------------------------------- coupons ------------------------------ */

  if (pathname === "/api/coupons/validate" && method === "GET") {
    const coupon = await store.validateCoupon(url.searchParams.get("code"));
    if (!coupon) throw httpError(404, "That coupon code is not valid.");
    return send(res, 200, coupon);
  }

  if (pathname === "/api/coupons") {
    if (method === "GET") {
      await requireAdmin(req);
      return send(res, 200, await store.listCoupons());
    }
    if (method === "POST") {
      await requireAdmin(req);
      const body = await readJson(req);
      const { errors, values } = store.validateCouponInput(body, null);
      if (errors.length > 0) throw httpError(422, errors[0], errors);
      try {
        return send(res, 201, await store.createCoupon(values));
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw httpError(409, `Coupon ${values.code} already exists.`);
        }
        throw error;
      }
    }
  }

  const couponMatch = pathname.match(/^\/api\/coupons\/([a-f0-9]{24})$/i);
  if (couponMatch) {
    await requireAdmin(req);
    const id = couponMatch[1];
    if (method === "PUT") {
      const body = await readJson(req);
      const existing = (await store.listCoupons()).find((c) => c.id === id);
      const { errors, values } = store.validateCouponInput(body, existing);
      if (errors.length > 0) throw httpError(422, errors[0], errors);
      try {
        return send(res, 200, await store.updateCoupon(id, values));
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw httpError(409, `Coupon ${values.code} already exists.`);
        }
        throw error;
      }
    }
    if (method === "DELETE") {
      await store.deleteCoupon(id);
      return send(res, 200, { deleted: id });
    }
  }

  /* ------------------------------- reviews ------------------------------ */

  const productReviewsMatch = pathname.match(/^\/api\/products\/(\d+)\/reviews$/);
  if (productReviewsMatch) {
    const productId = Number(productReviewsMatch[1]);
    if (method === "GET") {
      return send(res, 200, await store.listProductReviews(productId));
    }
    if (method === "POST") {
      return send(res, 201, await store.createReview(productId, await readJson(req)));
    }
  }

  if (pathname === "/api/reviews" && method === "GET") {
    await requireAdmin(req);
    return send(res, 200, await store.listAllReviews());
  }

  const reviewMatch = pathname.match(/^\/api\/reviews\/([a-f0-9]{24})$/i);
  if (reviewMatch) {
    await requireAdmin(req);
    const id = reviewMatch[1];
    if (method === "PATCH") {
      const body = await readJson(req);
      await store.setReviewApproved(id, Boolean(body.approved));
      return send(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      await store.deleteReview(id);
      return send(res, 200, { deleted: id });
    }
  }

  /* ---------------------------- account orders -------------------------- */

  if (pathname === "/api/account/orders" && method === "GET") {
    const user = await requireUser(req);
    return send(res, 200, await store.listAccountOrders(user));
  }

  /* ------------------------------ settings ------------------------------ */

  if (pathname === "/api/settings") {
    if (method === "GET") return send(res, 200, await store.getSettings());
    if (method === "PUT") {
      await requireAdmin(req);
      return send(res, 200, await store.saveSettings(await readJson(req)));
    }
  }

  /* -------------------------------- reset ------------------------------- */

  if (pathname === "/api/admin/reset" && method === "POST") {
    await requireAdmin(req);
    return send(res, 200, await store.resetData());
  }

  throw httpError(404, `No API route for ${method} ${pathname}.`);
};
