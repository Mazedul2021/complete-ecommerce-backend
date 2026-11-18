import { readFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, isDuplicateKey } from "./db.js";
import { httpError } from "./errors.js";

const here = dirname(fileURLToPath(import.meta.url));
const catalogPath = join(here, "data", "catalog.json");
const categoriesPath = join(here, "data", "categories.json");

export const FREE_SHIPPING_THRESHOLD = 2000;
export const FLAT_SHIPPING = 80;
export const COUPONS = { OLEVS10: 10, LUXURY20: 20 };
export const ORDER_STATUS_KEYS = [
  "pending",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
];
export const PAYMENT_KEYS = ["cod", "bkash", "card"];

export const DEFAULT_SETTINGS = {
  storeName: "OLEVS Watch Shop",
  supportEmail: "contact@olevswatchshop.com",
  supportPhone: "(+880) 1799018864",
  address: "Sha-38/1, Middle Badda, Gulshan Link Road, Dhaka-1212",
  lowStockThreshold: 10,
  logo: "",
  heroSlides: [],
  promoBanners: [],
  flashDeals: { enabled: true, title: "" },
  homePicks: { popular: [], latest: [], featured: [] },
  navLinks: [
    { label: "About", link: "/about", badge: "" },
    { label: "Contact", link: "/contact", badge: "" },
    { label: "Hot Sale", link: "/shop?sort=discount", badge: "50%" },
  ],
  footer: {
    about:
      "Your premier destination for authentic luxury skeleton timepieces, automatic movements, and contemporary chronographs in Bangladesh.",
    badges: [
      { title: "Fastest Delivery", text: "All across Bangladesh" },
      { title: "7-Day Easy Return", text: "Hassle-free exchange" },
      { title: "Official Warranty", text: "100% genuine products" },
      { title: "24/7 Dedicated Support", text: "Instant response team" },
    ],
    columns: [
      {
        title: "Collections",
        links: [
          { label: "Men's Watches", link: "/shop?category=mens-watches" },
          { label: "Women's Watches", link: "/shop?category=womens-watches" },
          { label: "Luxury Automatic Series", link: "/shop?category=luxury-watches" },
          { label: "Hot Sale Deals (50% Off)", link: "/shop?sort=discount" },
          { label: "New Arrivals", link: "/shop?sort=latest" },
        ],
      },
      {
        title: "Customer Care",
        links: [
          { label: "Order Tracking", link: "/order-tracking" },
          { label: "Delivery & Returns", link: "/help-center" },
          { label: "Warranty Policy", link: "/help-center" },
          { label: "About OWS", link: "/about" },
          { label: "Contact Us", link: "/contact" },
        ],
      },
    ],
    newsletter: {
      title: "Join the VIP Club",
      text: "Subscribe to unlock secret flash sales and get 10% off your first timepiece.",
      button: "Subscribe & Get 10% Off",
    },
    socials: {
      facebook: "https://facebook.com",
      instagram: "https://instagram.com",
      youtube: "https://youtube.com",
      tiktok: "https://tiktok.com",
    },
    copyright: "© 2024 OLEVS Watch Shop. All rights reserved.",
  },
};

/* ------------------------------------------------------------------ */
/* Collections + mapping                                               */
/* ------------------------------------------------------------------ */

const products = () => getDb().collection("products");
const orders = () => getDb().collection("orders");
const categories = () => getDb().collection("categories");
const messages = () => getDb().collection("messages");
const subscribers = () => getDb().collection("subscribers");
const coupons = () => getDb().collection("coupons");
const reviews = () => getDb().collection("reviews");
const users = () => getDb().collection("users");
const settingsCollection = () => getDb().collection("settings");
const counters = () => getDb().collection("counters");

const mapProduct = (doc) =>
  doc
    ? {
        id: Number(doc._id),
        name: doc.name ?? "",
        brand: doc.brand ?? "",
        category: doc.category ?? "",
        subCategory: doc.subCategory ?? "",
        subSubCategory: doc.subSubCategory ?? "",
        shortDescription: doc.shortDescription ?? "",
        price: Number(doc.price ?? 0),
        oldPrice: Number(doc.oldPrice ?? 0),
        rating: Number(doc.rating ?? 0),
        reviews: Number(doc.reviews ?? 0),
        stock: Number(doc.stock ?? 0),
        sku: doc.sku ?? "",
        strap: doc.strap ?? "",
        movement: doc.movement ?? "",
        waterResist: doc.waterResist ?? "",
        featured: Boolean(doc.featured),
        popular: Boolean(doc.popular),
        latest: Boolean(doc.latest),
        description: doc.description ?? "",
        images: Array.isArray(doc.images) ? doc.images : [],
        colors: Array.isArray(doc.colors) ? doc.colors : [],
        tags: Array.isArray(doc.tags) ? doc.tags : [],
      }
    : null;

const mapItem = (item) => ({
  productId: Number(item.productId),
  name: item.name ?? "",
  sku: item.sku ?? "",
  image: item.image ?? "",
  price: Number(item.price ?? 0),
  qty: Number(item.qty ?? 0),
});

const mapOrder = (doc) =>
  doc
    ? {
        id: doc._id,
        date: doc.date,
        customer: {
          name: doc.customer?.name ?? "",
          email: doc.customer?.email ?? "",
          phone: doc.customer?.phone ?? "",
          city: doc.customer?.city ?? "",
          address: doc.customer?.address ?? "",
        },
        items: (doc.items ?? []).map(mapItem),
        subtotal: Number(doc.subtotal ?? 0),
        shipping: Number(doc.shipping ?? 0),
        discount: Number(doc.discount ?? 0),
        total: Number(doc.total ?? 0),
        coupon: doc.coupon ?? null,
        payment: doc.payment ?? "cod",
        status: doc.status ?? "pending",
        notes: doc.notes ?? "",
      }
    : null;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const ObjectIdSafe = (value) => {
  try {
    return new ObjectId(String(value));
  } catch {
    throw httpError(404, "Not found.");
  }
};

const searchFields = (id, customer) => {
  const raw = [id, customer.name, customer.email, customer.phone]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return { search: raw, searchCompact: raw.replace(/\s+/g, "") };
};

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export const listProducts = async () =>
  (await products().find({}).sort({ _id: 1 }).toArray()).map(mapProduct);

export const getProduct = async (id) => mapProduct(await products().findOne({ _id: Number(id) }));

export const countProducts = async () => products().countDocuments();

export const validateProduct = (input = {}, existing = null) => {
  const base = existing ?? {};
  const pick = (key, fallback) =>
    input[key] === undefined ? (base[key] ?? fallback) : input[key];

  const name = String(pick("name", "")).trim();
  const sku = String(pick("sku", "")).trim().toUpperCase();
  const price = Number(pick("price", 0));
  const rawOldPrice = pick("oldPrice", 0);
  const oldPrice =
    rawOldPrice === "" || rawOldPrice === null ? 0 : Number(rawOldPrice);
  const stock = Number(pick("stock", 0));
  const rating = Number(pick("rating", 0));
  const reviews = Number(pick("reviews", 0));

  const errors = [];
  if (!name) errors.push("Product name is required.");
  if (!sku) errors.push("SKU is required.");
  if (!Number.isFinite(price) || price <= 0) {
    errors.push("Selling price must be greater than zero.");
  }
  if (!Number.isFinite(oldPrice) || oldPrice < 0) {
    errors.push("Compare-at price must be zero or more.");
  }
  if (!Number.isFinite(stock) || stock < 0) {
    errors.push("Stock quantity must be zero or more.");
  }
  if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
    errors.push("Rating must be between 0 and 5.");
  }
  if (!Number.isFinite(reviews) || reviews < 0) {
    errors.push("Review count must be zero or more.");
  }

  const asList = (key) =>
    Array.isArray(pick(key, []))
      ? [...new Set(pick(key, []).map((entry) => String(entry).trim()).filter(Boolean))]
      : [];

  const images = asList("images");

  return {
    errors,
    values: {
      name,
      sku,
      price: Math.round(price),
      oldPrice: Math.round(Math.max(oldPrice, price)),
      stock: Math.floor(stock),
      rating: Math.round(Math.min(5, Math.max(0, rating)) * 10) / 10,
      reviews: Math.floor(reviews),
      brand: String(pick("brand", "")).trim(),
      category: String(pick("category", "")).trim(),
      subCategory: String(pick("subCategory", "")).trim(),
      subSubCategory: String(pick("subSubCategory", "")).trim(),
      shortDescription: String(pick("shortDescription", "")).trim(),
      strap: String(pick("strap", "")).trim(),
      movement: String(pick("movement", "")).trim(),
      waterResist: String(pick("waterResist", "")).trim(),
      featured: Boolean(pick("featured", false)),
      popular: Boolean(pick("popular", false)),
      latest: Boolean(pick("latest", false)),
      description: String(pick("description", "")).trim(),
      images: images.length > 0 ? images : ["/products/1.webp"],
      colors: asList("colors"),
      tags: asList("tags"),
    },
  };
};

const nextProductId = async () => {
  const top = await products().find({}, { projection: { _id: 1 } }).sort({ _id: -1 }).limit(1).next();
  const highest = Number(top?._id ?? 0);
  const counter = await counters().findOne({ _id: "productId" });
  const next = Math.max(highest, Number(counter?.value ?? 0)) + 1;
  await counters().updateOne({ _id: "productId" }, { $set: { value: next } }, { upsert: true });
  return next;
};

export const createProduct = async (values) => {
  const id = await nextProductId();
  const now = new Date();
  await products().insertOne({ _id: id, ...values, createdAt: now, updatedAt: now });
  return getProduct(id);
};

export const updateProduct = async (id, values) => {
  await products().updateOne(
    { _id: Number(id) },
    { $set: { ...values, updatedAt: new Date() } }
  );
  return getProduct(id);
};

export const deleteProduct = async (id) =>
  (await products().deleteOne({ _id: Number(id) })).deletedCount > 0;

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

const slugify = (value) =>
  String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const mapSubCategory = (sub) => ({
  name: String(sub?.name ?? "").trim(),
  slug: slugify(sub?.slug || sub?.name),
  children: Array.isArray(sub?.children)
    ? [...new Set(sub.children.map((child) => String(child).trim()).filter(Boolean))]
    : [],
});

const mapCategory = (doc) =>
  doc
    ? {
        id: Number(doc._id),
        name: doc.name ?? "",
        slug: doc.slug ?? "",
        image: doc.image ?? "",
        position: Number(doc.position ?? 0),
        subCategories: (doc.subCategories ?? []).map(mapSubCategory),
      }
    : null;

export const listCategories = async () =>
  (await categories()
    .find({})
    .sort({ position: 1, _id: 1 })
    .toArray())
    .map(mapCategory);

export const getCategory = async (id) =>
  mapCategory(await categories().findOne({ _id: Number(id) }));

export const validateCategory = (input = {}, existing = null) => {
  const base = existing ?? {};
  const pick = (key, fallback) =>
    input[key] === undefined ? (base[key] ?? fallback) : input[key];

  const name = String(pick("name", "")).trim();
  const slug = slugify(pick("slug", "") || name);
  const image = String(pick("image", "")).trim();
  const position = Number(pick("position", 0));

  const errors = [];
  if (!name) errors.push("Category name is required.");
  if (!slug) errors.push("Category slug is required.");
  if (!Number.isFinite(position)) errors.push("Position must be a number.");

  const seenSubSlugs = new Set();
  const subCategories = (Array.isArray(pick("subCategories", []))
    ? pick("subCategories", [])
    : []
  )
    .map((sub) => {
      const mapped = mapSubCategory(sub);
      if (mapped.name && !mapped.slug) mapped.slug = slugify(mapped.name);
      return mapped;
    })
    .filter((sub) => sub.name || sub.slug);

  for (const sub of subCategories) {
    if (!sub.name) errors.push("Every sub-category needs a name.");
    if (!sub.slug) errors.push(`Sub-category "${sub.name || "?"}" needs a slug.`);
    if (sub.slug && seenSubSlugs.has(sub.slug)) {
      errors.push(`Duplicate sub-category slug "${sub.slug}".`);
    }
    seenSubSlugs.add(sub.slug);
  }

  return {
    errors,
    values: {
      name,
      slug,
      image,
      position: Math.floor(position) || 0,
      subCategories,
    },
  };
};

const nextCategoryId = async () => {
  const top = await categories()
    .find({}, { projection: { _id: 1 } })
    .sort({ _id: -1 })
    .limit(1)
    .next();
  const highest = Number(top?._id ?? 0);
  const counter = await counters().findOne({ _id: "categoryId" });
  const next = Math.max(highest, Number(counter?.value ?? 0)) + 1;
  await counters().updateOne(
    { _id: "categoryId" },
    { $set: { value: next } },
    { upsert: true }
  );
  return next;
};

const assertUniqueSlug = async (slug, excludeId = null) => {
  const filter = { slug };
  if (excludeId !== null) filter._id = { $ne: Number(excludeId) };
  if (await categories().findOne(filter)) {
    throw httpError(409, `A category with slug "${slug}" already exists.`);
  }
};

export const createCategory = async (values) => {
  await assertUniqueSlug(values.slug);
  const id = await nextCategoryId();
  const now = new Date();
  await categories().insertOne({
    _id: id,
    ...values,
    createdAt: now,
    updatedAt: now,
  });
  return getCategory(id);
};

export const updateCategory = async (id, values) => {
  await assertUniqueSlug(values.slug, id);
  const result = await categories().updateOne(
    { _id: Number(id) },
    { $set: { ...values, updatedAt: new Date() } }
  );
  if (result.matchedCount === 0) {
    throw httpError(404, `Category ${id} not found.`);
  }
  return getCategory(id);
};

export const deleteCategory = async (id) =>
  (await categories().deleteOne({ _id: Number(id) })).deletedCount > 0;

/* ------------------------------------------------------------------ */
/* Contact messages                                                    */
/* ------------------------------------------------------------------ */

const mapMessage = (doc) =>
  doc
    ? {
        id: String(doc._id),
        name: doc.name ?? "",
        email: doc.email ?? "",
        subject: doc.subject ?? "",
        message: doc.message ?? "",
        read: Boolean(doc.read),
        createdAt: doc.createdAt ?? null,
      }
    : null;

export const submitContactMessage = async (input = {}) => {
  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim();
  const subject = String(input.subject ?? "").trim();
  const message = String(input.message ?? "").trim();

  if (name.length < 2) throw httpError(422, "Please enter your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw httpError(422, "Please enter a valid email address.");
  }
  if (message.length < 5) {
    throw httpError(422, "Please write a short message.");
  }

  const doc = {
    name,
    email,
    subject: subject || "General enquiry",
    message,
    read: false,
    createdAt: new Date(),
  };
  const { insertedId } = await messages().insertOne(doc);
  return mapMessage({ ...doc, _id: insertedId });
};

export const listMessages = async () =>
  (await messages().find({}).sort({ createdAt: -1 }).toArray()).map(mapMessage);

export const setMessageRead = async (id, read) => {
  const result = await messages().updateOne(
    { _id: new ObjectIdSafe(id) },
    { $set: { read: Boolean(read) } }
  );
  if (result.matchedCount === 0) throw httpError(404, "Message not found.");
};

export const deleteMessage = async (id) =>
  (await messages().deleteOne({ _id: new ObjectIdSafe(id) })).deletedCount > 0;

/* ------------------------------------------------------------------ */
/* Newsletter subscribers                                              */
/* ------------------------------------------------------------------ */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const subscribeEmail = async (input = {}) => {
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw httpError(422, "Please enter a valid email address.");
  }

  await subscribers().updateOne(
    { email },
    {
      $setOnInsert: { email, createdAt: new Date(), source: "footer" },
      $set: { updatedAt: new Date() },
    },
    { upsert: true }
  );

  return { subscribed: true, email };
};

export const listSubscribers = async () =>
  (await subscribers().find({}).sort({ createdAt: -1 }).toArray()).map((doc) => ({
    id: String(doc._id),
    email: doc.email ?? "",
    source: doc.source ?? "footer",
    createdAt: doc.createdAt ?? null,
  }));

/* ------------------------------------------------------------------ */
/* Coupons                                                             */
/* ------------------------------------------------------------------ */

const mapCoupon = (doc) =>
  doc
    ? {
        id: String(doc._id),
        code: doc.code ?? "",
        percent: Number(doc.percent ?? 0),
        active: doc.active !== false,
        note: doc.note ?? "",
      }
    : null;

const couponFilter = (code) => ({
  code: String(code ?? "").trim().toUpperCase(),
});

export const couponPercent = async (code) => {
  const doc = await coupons().findOne({
    ...couponFilter(code),
    active: { $ne: false },
  });
  const percent = Number(doc?.percent ?? 0);
  return percent > 0 ? percent : 0;
};

export const validateCoupon = async (code) => {
  const percent = await couponPercent(code);
  if (percent <= 0) return null;
  return { code: couponFilter(code).code, percent };
};

export const listCoupons = async () =>
  (await coupons().find({}).sort({ code: 1 }).toArray()).map(mapCoupon);

export const validateCouponInput = (input = {}, existing = null) => {
  const base = existing ?? {};
  const pick = (key, fallback) =>
    input[key] === undefined ? (base[key] ?? fallback) : input[key];

  const code = String(pick("code", "")).trim().toUpperCase();
  const percent = Number(pick("percent", 0));
  const active = pick("active", true) !== false;
  const note = String(pick("note", "")).trim();

  const errors = [];
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) {
    errors.push("Code must be 3–20 characters: letters, numbers, - or _.");
  }
  if (!Number.isFinite(percent) || percent <= 0 || percent > 90) {
    errors.push("Discount must be between 1% and 90%.");
  }

  return {
    errors,
    values: { code, percent: Math.floor(percent), active, note },
  };
};

export const createCoupon = async (values) => {
  const { insertedId } = await coupons().insertOne({ ...values });
  return mapCoupon({ ...values, _id: insertedId });
};

export const updateCoupon = async (id, values) => {
  const result = await coupons().updateOne(
    { _id: new ObjectIdSafe(id) },
    { $set: values }
  );
  if (result.matchedCount === 0) throw httpError(404, "Coupon not found.");
  return mapCoupon(await coupons().findOne({ _id: new ObjectIdSafe(id) }));
};

export const deleteCoupon = async (id) =>
  (await coupons().deleteOne({ _id: new ObjectIdSafe(id) })).deletedCount > 0;

/* ------------------------------------------------------------------ */
/* Product reviews                                                     */
/* ------------------------------------------------------------------ */

const mapReview = (doc) =>
  doc
    ? {
        id: String(doc._id),
        productId: Number(doc.productId),
        name: doc.name ?? "",
        rating: Number(doc.rating ?? 0),
        text: doc.text ?? "",
        approved: Boolean(doc.approved),
        createdAt: doc.createdAt ?? null,
      }
    : null;

export const listProductReviews = async (productId, { approvedOnly = true } = {}) => {
  const filter = { productId: Number(productId) };
  if (approvedOnly) filter.approved = true;
  return (await reviews().find(filter).sort({ createdAt: -1 }).toArray()).map(
    mapReview
  );
};

export const listAllReviews = async () =>
  (await reviews().find({}).sort({ createdAt: -1 }).toArray()).map(mapReview);

const recomputeProductRating = async (productId) => {
  const approved = await reviews()
    .find({ productId: Number(productId), approved: true })
    .toArray();

  const values = {
    reviews: approved.length,
    rating:
      approved.length > 0
        ? Math.round(
            (approved.reduce((sum, r) => sum + Number(r.rating || 0), 0) /
              approved.length) *
              10
          ) / 10
        : 0,
  };

  await products().updateOne({ _id: Number(productId) }, { $set: values });
  return values;
};

export const createReview = async (productId, input = {}) => {
  const product = await getProduct(productId);
  if (!product) throw httpError(404, `Product ${productId} not found.`);

  const name = String(input.name ?? "").trim();
  const text = String(input.text ?? "").trim();
  const rating = Number(input.rating);

  if (name.length < 2) throw httpError(422, "Please enter your name.");
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw httpError(422, "Please choose a rating between 1 and 5.");
  }
  if (text.length < 3) {
    throw httpError(422, "Please write a short review.");
  }

  const doc = {
    productId: product.id,
    name,
    rating: Math.round(rating * 10) / 10,
    text,
    approved: false,
    createdAt: new Date(),
  };
  const { insertedId } = await reviews().insertOne(doc);
  return mapReview({ ...doc, _id: insertedId });
};

export const setReviewApproved = async (id, approved) => {
  const reviewId = new ObjectIdSafe(id);
  const existing = await reviews().findOne({ _id: reviewId });
  if (!existing) throw httpError(404, "Review not found.");

  await reviews().updateOne({ _id: reviewId }, { $set: { approved: Boolean(approved) } });
  await recomputeProductRating(existing.productId);
};

export const deleteReview = async (id) => {
  const reviewId = new ObjectIdSafe(id);
  const existing = await reviews().findOne({ _id: reviewId });
  if (!existing) throw httpError(404, "Review not found.");

  await reviews().deleteOne({ _id: reviewId });
  await recomputeProductRating(existing.productId);
};

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export const countOrders = async () => orders().countDocuments();

export const listOrders = async ({ status, q, limit } = {}) => {
  const filter = {};

  if (status && status !== "all") {
    if (!ORDER_STATUS_KEYS.includes(status)) {
      throw httpError(422, `Unknown order status "${status}".`);
    }
    filter.status = status;
  }

  const term = String(q ?? "").trim();
  if (term) {
    filter.$or = [
      { search: new RegExp(escapeRegex(term), "i") },
      { searchCompact: new RegExp(escapeRegex(term.replace(/\s+/g, "")), "i") },
    ];
  }

  let cursor = orders().find(filter).sort({ placedAt: -1 });
  const max = Number(limit);
  if (Number.isFinite(max) && max > 0) cursor = cursor.limit(Math.floor(max));

  return (await cursor.toArray()).map(mapOrder);
};

export const getOrder = async (id) => mapOrder(await orders().findOne({ _id: String(id) }));

const buildOrderDoc = ({ id, placedAt, customer, items, subtotal, shipping, discount, total, coupon, payment, status, notes = "", userId = null }) => ({
  _id: id,
  date: placedAt.toISOString(),
  placedAt,
  customer,
  customerEmail: (customer.email ?? "").toLowerCase(),
  userId,
  items,
  subtotal,
  shipping,
  discount,
  total,
  coupon,
  payment,
  status,
  notes,
  ...searchFields(id, customer),
  createdAt: new Date(),
});

export const createOrder = async (payload = {}, user = null) => {
  const customer = {
    name: String(payload.customer?.name ?? "").trim(),
    email: String(payload.customer?.email ?? "").trim(),
    phone: String(payload.customer?.phone ?? "").trim(),
    city: String(payload.customer?.city ?? "").trim(),
    address: String(payload.customer?.address ?? "").trim(),
  };

  if (!customer.name) throw httpError(422, "Customer name is required.");
  if (!customer.phone) throw httpError(422, "Phone number is required.");
  if (!customer.address) throw httpError(422, "Delivery address is required.");
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    throw httpError(422, "An order needs at least one item.");
  }

  const items = [];
  for (const raw of payload.items) {
    const product = await getProduct(raw.productId);
    if (!product) {
      throw httpError(409, `Product ${raw.productId} is no longer in the catalog.`);
    }
    const qty = Math.floor(Number(raw.qty));
    if (!Number.isFinite(qty) || qty < 1) {
      throw httpError(422, `Invalid quantity for ${product.name}.`);
    }
    if (product.stock <= 0) {
      throw httpError(409, `${product.name} is out of stock.`);
    }
    if (qty > product.stock) {
      throw httpError(409, `Only ${product.stock} left of ${product.name}.`);
    }
    items.push({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      image: product.images[0] ?? "",
      price: product.price,
      qty,
    });
  }

  const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const coupon = payload.coupon ? String(payload.coupon).trim().toUpperCase() : null;
  const percent = coupon ? await couponPercent(coupon) : 0;
  const discount = Math.round((subtotal * percent) / 100);
  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
  const total = Math.max(0, subtotal - discount + shipping);

  const payment = PAYMENT_KEYS.includes(payload.payment) ? payload.payment : "cod";
  const status = ORDER_STATUS_KEYS.includes(payload.status) ? payload.status : "pending";
  const placedAt = new Date();

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const id = `OWS-${Math.floor(100000 + Math.random() * 900000)}`;
    const doc = buildOrderDoc({
      id,
      placedAt,
      customer,
      items,
      subtotal,
      shipping,
      discount,
      total,
      coupon: percent > 0 ? coupon : null,
      payment,
      status,
      notes: String(payload.notes ?? "").trim(),
      userId: user ? String(user._id) : null,
    });

    try {
      await orders().insertOne(doc);
      return mapOrder(doc);
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
    }
  }

  throw httpError(500, "Could not allocate an order id, please retry.");
};

export const setOrderStatus = async (id, status) => {
  if (!ORDER_STATUS_KEYS.includes(status)) {
    throw httpError(422, `Status must be one of: ${ORDER_STATUS_KEYS.join(", ")}.`);
  }

  const result = await orders().updateOne(
    { _id: String(id) },
    { $set: { status, updatedAt: new Date() } }
  );
  if (result.matchedCount === 0) throw httpError(404, `Order ${id} not found.`);
  return getOrder(id);
};

export const listAccountOrders = async (user) => {
  const filter = {
    $or: [
      { userId: String(user._id) },
      { customerEmail: String(user.email ?? "").toLowerCase() },
    ],
  };
  return (await orders().find(filter).sort({ placedAt: -1 }).toArray()).map(
    mapOrder
  );
};

export const listCustomers = async () => {
  const map = new Map();

  // Registered accounts count as customers even before their first order.
  for (const user of await users().find({}).toArray()) {
    const email = String(user.email ?? "").toLowerCase();
    if (!email) continue;
    map.set(email, {
      key: email,
      name: user.name ?? "",
      email: user.email ?? "",
      phone: user.phone ?? "",
      city: "",
      address: "",
      orders: [],
      spend: 0,
      lastOrder: null,
      registered: true,
    });
  }

  for (const order of await listOrders()) {
    const { customer } = order;
    const key = (
      customer.email ||
      customer.phone ||
      customer.name ||
      order.id
    ).toLowerCase();

    const entry =
      map.get(key) ??
      {
        key,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        city: customer.city,
        address: customer.address,
        orders: [],
        spend: 0,
        lastOrder: null,
      };

    entry.orders.push(order);
    if (order.status !== "cancelled") entry.spend += order.total;
    if (!entry.lastOrder || new Date(order.date) > new Date(entry.lastOrder)) {
      entry.lastOrder = order.date;
    }
    map.set(key, entry);
  }

  return [...map.values()]
    .map((entry) => ({ ...entry, count: entry.orders.length }))
    .sort((a, b) => b.spend - a.spend);
};

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export const getSettings = async () => {
  const doc = await settingsCollection().findOne({ _id: "store" });
  const stored = doc?.values && typeof doc.values === "object" ? doc.values : {};

  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    lowStockThreshold: Number(stored.lowStockThreshold ?? DEFAULT_SETTINGS.lowStockThreshold),
  };
};

export const saveSettings = async (patch = {}) => {
  const next = { ...(await getSettings()) };

  for (const key of ["storeName", "supportEmail", "supportPhone", "address"]) {
    if (patch[key] !== undefined) {
      const value = String(patch[key]).trim();
      next[key] = value || DEFAULT_SETTINGS[key];
    }
  }

  if (patch.lowStockThreshold !== undefined) {
    const threshold = Number(patch.lowStockThreshold);
    if (!Number.isFinite(threshold) || threshold < 0) {
      throw httpError(422, "Low stock threshold must be zero or more.");
    }
    next.lowStockThreshold = Math.floor(threshold);
  }

  const clip = (value, max = 500000) => String(value ?? "").slice(0, max);
  const cleanMediaList = (list, maxItems = 10) =>
    Array.isArray(list)
      ? list
          .slice(0, maxItems)
          .map((item) => ({
            image: clip(item?.image),
            link: clip(item?.link, 500) || "/shop",
          }))
          .filter((item) => item.image)
      : [];
  const cleanIdList = (list) =>
    Array.isArray(list) ? list.slice(0, 30).map((id) => clip(id, 64)).filter(Boolean) : [];

  if (patch.logo !== undefined) {
    next.logo = clip(patch.logo, 600000);
  }
  if (patch.heroSlides !== undefined) {
    next.heroSlides = cleanMediaList(patch.heroSlides);
  }
  if (patch.promoBanners !== undefined) {
    next.promoBanners = cleanMediaList(patch.promoBanners, 4);
  }
  if (patch.flashDeals !== undefined) {
    next.flashDeals = {
      enabled: patch.flashDeals?.enabled !== false,
      title: clip(patch.flashDeals?.title, 120),
    };
  }
  if (patch.homePicks !== undefined) {
    next.homePicks = {
      popular: cleanIdList(patch.homePicks?.popular),
      latest: cleanIdList(patch.homePicks?.latest),
      featured: cleanIdList(patch.homePicks?.featured),
    };
  }
  if (patch.navLinks !== undefined) {
    next.navLinks = (Array.isArray(patch.navLinks) ? patch.navLinks : [])
      .slice(0, 12)
      .map((item) => ({
        label: clip(item?.label, 60),
        link: clip(item?.link, 300) || "/",
        badge: clip(item?.badge, 20),
      }))
      .filter((item) => item.label);
  }
  if (patch.footer !== undefined && patch.footer && typeof patch.footer === "object") {
    const f = patch.footer;
    const cleanLinks = (list) =>
      (Array.isArray(list) ? list : [])
        .slice(0, 15)
        .map((l) => ({ label: clip(l?.label, 60), link: clip(l?.link, 300) || "/" }))
        .filter((l) => l.label);
    next.footer = {
      about: clip(f.about, 2000),
      badges: (Array.isArray(f.badges) ? f.badges : [])
        .slice(0, 6)
        .map((b) => ({ title: clip(b?.title, 60), text: clip(b?.text, 120) }))
        .filter((b) => b.title),
      columns: (Array.isArray(f.columns) ? f.columns : [])
        .slice(0, 6)
        .map((c) => ({ title: clip(c?.title, 60), links: cleanLinks(c?.links) }))
        .filter((c) => c.title),
      newsletter: {
        title: clip(f.newsletter?.title, 80),
        text: clip(f.newsletter?.text, 300),
        button: clip(f.newsletter?.button, 60),
      },
      socials: {
        facebook: clip(f.socials?.facebook, 300),
        instagram: clip(f.socials?.instagram, 300),
        youtube: clip(f.socials?.youtube, 300),
        tiktok: clip(f.socials?.tiktok, 300),
      },
      copyright: clip(f.copyright, 160),
    };
  }

  await settingsCollection().updateOne(
    { _id: "store" },
    { $set: { values: next, updatedAt: new Date() } },
    { upsert: true }
  );

  return next;
};

/* ------------------------------------------------------------------ */
/* Seeding                                                             */
/* ------------------------------------------------------------------ */

const readSeed = (path) => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Missing seed file at ${path}.`);
  }
};

const readCatalog = () => readSeed(catalogPath);

const seedCatalog = async () => {
  const catalog = readCatalog();
  const now = new Date();

  await products().insertMany(
    catalog.map((product) => ({
      _id: Number(product.id),
      name: product.name,
      brand: product.brand ?? "",
      category: product.category ?? "",
      subCategory: product.subCategory ?? "",
      price: product.price,
      oldPrice: product.oldPrice ?? product.price,
      rating: product.rating ?? 0,
      reviews: product.reviews ?? 0,
      stock: product.stock ?? 0,
      sku: product.sku,
      strap: product.strap ?? "",
      movement: product.movement ?? "",
      waterResist: product.waterResist ?? "",
      featured: Boolean(product.featured),
      popular: Boolean(product.popular),
      latest: Boolean(product.latest),
      description: product.description ?? "",
      images: product.images ?? [],
      colors: product.colors ?? [],
      tags: product.tags ?? [],
      createdAt: now,
      updatedAt: now,
    })),
    { ordered: true }
  );

  const highest = catalog.reduce((max, product) => Math.max(max, Number(product.id) || 0), 0);
  await counters().updateOne(
    { _id: "productId" },
    { $set: { value: highest } },
    { upsert: true }
  );

  return catalog.length;
};

const seedCategories = async () => {
  const list = readSeed(categoriesPath);
  const now = new Date();

  await categories().insertMany(
    list.map((category, index) => ({
      _id: index + 1,
      name: category.name,
      slug: category.slug ?? slugify(category.name),
      image: category.image ?? "",
      position: Number(category.position ?? index),
      subCategories: (category.subCategories ?? []).map(mapSubCategory),
      createdAt: now,
      updatedAt: now,
    })),
    { ordered: true }
  );

  const highest = list.reduce((max, category) => Math.max(max, Number(category.id) || 0), 0);
  await counters().updateOne(
    { _id: "categoryId" },
    { $set: { value: Math.max(highest, list.length) } },
    { upsert: true }
  );

  return list.length;
};

const DEMO_CUSTOMERS = [
  { name: "Rakib Hasan", email: "rakib.hasan@example.com", phone: "01711 204 880", city: "Dhaka", address: "House 42, Road 7, Dhanmondi" },
  { name: "Mim Akter", email: "mim.akter@example.com", phone: "01822 771 043", city: "Dhaka", address: "Flat 5B, Gulshan Avenue" },
  { name: "Shakib Mahmud", email: "shakib.m@example.com", phone: "01933 118 276", city: "Chattogram", address: "12/C Agrabad C/A" },
  { name: "Tanvir Ahmed", email: "tanvir.ahmed@example.com", phone: "01677 903 551", city: "Sylhet", address: "Zindabazar, House 9" },
  { name: "Nusrat Jahan", email: "nusrat.jahan@example.com", phone: "01555 442 019", city: "Dhaka", address: "Road 11, Banani" },
  { name: "Arif Chowdhury", email: "arif.c@example.com", phone: "01712 665 400", city: "Rajshahi", address: "Shaheb Bazar, Lane 3" },
  { name: "Farhana Islam", email: "farhana.islam@example.com", phone: "01890 337 112", city: "Khulna", address: "Khalishpur, Block D" },
  { name: "Sabbir Rahman", email: "sabbir.r@example.com", phone: "01911 508 774", city: "Dhaka", address: "Mirpur 10, Avenue 4" },
  { name: "Rima Sultana", email: "rima.sultana@example.com", phone: "01633 209 885", city: "Barishal", address: "Natun Bazar, Road 2" },
  { name: "Imran Kabir", email: "imran.kabir@example.com", phone: "01755 884 320", city: "Rangpur", address: "Dhap Bazar, House 18" },
];

const mulberry32 = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const statusForAge = (daysAgo, rand) => {
  if (daysAgo >= 25) return rand() < 0.85 ? "delivered" : "cancelled";
  if (daysAgo >= 10) return rand() < 0.55 ? "delivered" : "shipped";
  if (daysAgo >= 5) return rand() < 0.5 ? "shipped" : "packed";
  if (daysAgo >= 2) return rand() < 0.6 ? "confirmed" : "packed";
  return rand() < 0.3 ? "confirmed" : "pending";
};

const seedDemoOrders = async () => {
  const catalog = await listProducts();
  if (catalog.length === 0) return 0;

  const rand = mulberry32(20261111);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const now = Date.now();
  const docs = [];

  for (let i = 0; i < 36; i += 1) {
    const daysAgo = Math.floor(Math.pow(rand(), 1.35) * 88);
    const placedAt = new Date(
      now - daysAgo * 86400000 - Math.floor(rand() * 10) * 3600000
    );
    const customer = { ...pick(DEMO_CUSTOMERS) };

    const itemCount = rand() < 0.72 ? 1 : 2;
    const chosen = [];
    while (chosen.length < itemCount) {
      const candidate = pick(catalog);
      if (!chosen.some((entry) => entry.id === candidate.id)) chosen.push(candidate);
    }

    const items = chosen.map((product) => ({
      productId: product.id,
      name: product.name,
      sku: product.sku,
      image: product.images?.[0] ?? "",
      price: product.price,
      qty: rand() < 0.78 ? 1 : 2,
    }));

    const subtotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
    const shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : FLAT_SHIPPING;
    const discount = rand() < 0.18 ? Math.round(subtotal * 0.1) : 0;
    const coupon = discount > 0 ? "OLEVS10" : null;
    const status = statusForAge(daysAgo, rand);
    const payment = pick(["cod", "cod", "bkash", "card"]);

    docs.push(
      buildOrderDoc({
        id: `OWS-${480000 + i * 173}`,
        placedAt,
        customer,
        items,
        subtotal,
        shipping,
        discount,
        total: subtotal - discount + shipping,
        coupon,
        payment,
        status,
      })
    );
  }

  await orders().insertMany(docs, { ordered: true });
  return docs.length;
};

const SEED_COUPONS = [
  { code: "OLEVS10", percent: 10, note: "VIP welcome discount" },
  { code: "LUXURY20", percent: 20, note: "Exclusive promo" },
  { code: "FESTIVE15", percent: 15, note: "Seasonal sale" },
];

const seedCoupons = async () => {
  const now = new Date();
  await coupons().insertMany(
    SEED_COUPONS.map((coupon) => ({ ...coupon, active: true, createdAt: now }))
  );
  return SEED_COUPONS.length;
};

export const ensureSeeded = async () => {
  if ((await countProducts()) === 0) await seedCatalog();
  if ((await countOrders()) === 0) await seedDemoOrders();
  if ((await categories().countDocuments()) === 0) await seedCategories();
  if ((await coupons().countDocuments()) === 0) await seedCoupons();
  if (!(await settingsCollection().findOne({ _id: "store" }))) {
    await saveSettings(DEFAULT_SETTINGS);
  }
};

export const resetData = async () => {
  await Promise.all([
    products().deleteMany({}),
    orders().deleteMany({}),
    categories().deleteMany({}),
    messages().deleteMany({}),
    subscribers().deleteMany({}),
    coupons().deleteMany({}),
    reviews().deleteMany({}),
    settingsCollection().deleteMany({}),
    counters().deleteMany({}),
  ]);

  await ensureSeeded();

  return { products: await countProducts(), orders: await countOrders() };
};
