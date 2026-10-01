import { createServer } from "node:http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createR2Client } from "./r2.mjs";
import { sendDownloadEmail } from "./mail.mjs";

const root = fileURLToPath(new URL("./", import.meta.url));
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const sessionPattern = /^cs_(?:test_|live_)?[A-Za-z0-9]+$/;
const emailPattern = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const publicFiles = new Set(["/", "/index.html", "/order.html", "/js/main.js", "/js/order.js", "/css/styles.css", "/data/products.json"]);
const imagePath = /^\/assets\/images\/products\/[a-z0-9-]+\/[a-z0-9._-]+\.(?:webp|png|jpe?g|avif)$/;
const fontPath = /^\/assets\/fonts\/satoshi\/Satoshi-(?:Regular|Medium|Bold)\.woff2$/;
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".avif": "image/avif" };

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readRawBody(req, limit = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Request too large"), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validStripeSignature(raw, header, secret, now) {
  if (typeof header !== "string" || !secret) return false;
  const fields = header.split(",").map((field) => field.trim().split("="));
  const timestamp = Number(fields.find(([key]) => key === "t")?.[1]);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest();
  return fields.some(([key, value]) => {
    if (key !== "v1" || !/^[a-f0-9]{64}$/.test(value || "")) return false;
    return timingSafeEqual(expected, Buffer.from(value, "hex"));
  });
}

async function readBody(req) {
  let text = "";
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 8192) throw Object.assign(new Error("Request too large"), { status: 413 });
  }
  try { return JSON.parse(text); } catch { throw Object.assign(new Error("Invalid JSON"), { status: 400 }); }
}

export function createApp({ secretKey = process.env.STRIPE_SECRET_KEY, baseUrl = process.env.PUBLIC_BASE_URL,
  r2AccountId = process.env.R2_ACCOUNT_ID, r2Bucket = process.env.R2_BUCKET,
  r2AccessKeyId = process.env.R2_ACCESS_KEY_ID, r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY,
  r2Jurisdiction = process.env.R2_JURISDICTION || "",
  downloadLinkHours = Number(process.env.DOWNLOAD_LINK_HOURS ?? 24), now = () => Date.now(),
  webhookSecret = process.env.STRIPE_WEBHOOK_SECRET, deliverEmail = sendDownloadEmail,
  fetchImpl = fetch, siteRoot = root } = {}) {
  if (!secretKey || !baseUrl) {
    throw new Error("Set STRIPE_SECRET_KEY and PUBLIC_BASE_URL before starting the server.");
  }
  if (!Number.isSafeInteger(downloadLinkHours) || downloadLinkHours < 1 || downloadLinkHours > 8760) {
    throw new Error("DOWNLOAD_LINK_HOURS must be a whole number from 1 to 8760.");
  }
  const origin = new URL(baseUrl).origin;
  if (new URL(baseUrl).pathname !== "/" || !/^https?:$/.test(new URL(baseUrl).protocol)) {
    throw new Error("PUBLIC_BASE_URL must be an HTTP(S) origin without a path.");
  }
  const r2 = createR2Client({ accountId: r2AccountId, bucket: r2Bucket, accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey, jurisdiction: r2Jurisdiction, fetchImpl });
  const emailDeliveries = new Map();

  async function stripe(endpoint, options = {}) {
    const response = await fetchImpl(`https://api.stripe.com/v1/${endpoint}`, {
      ...options,
      headers: { Authorization: `Bearer ${secretKey}`, ...(options.headers || {}) },
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error?.message || "Stripe request failed"), { status: 502 });
    return data;
  }

  async function catalog() {
    return JSON.parse(await readFile(path.join(siteRoot, "data/products.json"), "utf8"));
  }

  async function hasStl(id) {
    return r2.exists(id);
  }

  async function paidOrder(sessionId, allowPending = false) {
    if (!sessionPattern.test(sessionId || "")) throw Object.assign(new Error("Invalid order link"), { status: 400 });
    const session = await stripe(`checkout/sessions/${sessionId}`);
    if (session.id !== sessionId || session.mode !== "payment" || session.status !== "complete") {
      throw Object.assign(new Error("Payment is not complete"), { status: 403 });
    }
    if (!Number.isSafeInteger(session.created) || session.created <= 0) {
      throw Object.assign(new Error("Order link unavailable"), { status: 403 });
    }
    const expiresAt = session.created + downloadLinkHours * 3600;
    if (now() >= expiresAt * 1000) {
      throw Object.assign(new Error("Download link has expired"), { status: 410 });
    }
    if (session.payment_status !== "paid") {
      if (allowPending && session.payment_status === "unpaid") return null;
      throw Object.assign(new Error("Payment is not complete"), { status: 403 });
    }
    const ids = (session.metadata?.product_ids || "").split(",");
    if (!ids.length || ids.length > 20 || ids.some((id) => !idPattern.test(id)) || new Set(ids).size !== ids.length) {
      throw Object.assign(new Error("Order has invalid products"), { status: 403 });
    }
    const email = session.customer_details?.email || session.customer_email;
    return { ids, expiresAt, email: typeof email === "string" && email.length <= 254 && emailPattern.test(email) ? email : null,
      emailSentAt: session.metadata?.delivery_email_sent_at };
  }

  async function deliverOrderEmail(sessionId) {
    if (emailDeliveries.has(sessionId)) return emailDeliveries.get(sessionId);
    const delivery = (async () => {
      let order;
      try { order = await paidOrder(sessionId, true); }
      catch (error) {
        if (error.status === 403 || error.status === 410) return;
        throw error;
      }
      if (!order || order.emailSentAt) return;
      if (!order.email) throw new Error("Paid order has no customer email");
      const products = await catalog();
      const items = order.ids.map((id) => ({ name: products.find((product) => product.id === id)?.name || id,
        url: `${origin}/api/download?session_id=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(id)}` }));
      await deliverEmail({ to: order.email, items, expiresAt: new Date(order.expiresAt * 1000).toISOString() });
      const update = new URLSearchParams({ "metadata[delivery_email_sent_at]": String(Math.floor(now() / 1000)) });
      await stripe(`checkout/sessions/${sessionId}`, { method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: update });
    })();
    emailDeliveries.set(sessionId, delivery);
    try { await delivery; } finally { emailDeliveries.delete(sessionId); }
  }

  async function handler(req, res) {
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      const url = new URL(req.url, origin);
      if (req.method === "POST" && url.pathname === "/api/stripe-webhook") {
        if (!webhookSecret) throw Object.assign(new Error("Email delivery is not configured"), { status: 503 });
        const raw = await readRawBody(req);
        if (!validStripeSignature(raw, req.headers["stripe-signature"], webhookSecret, now)) {
          throw Object.assign(new Error("Invalid webhook signature"), { status: 400 });
        }
        let event;
        try { event = JSON.parse(raw.toString("utf8")); }
        catch { throw Object.assign(new Error("Invalid webhook payload"), { status: 400 }); }
        if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) {
          return sendJson(res, 200, { received: true });
        }
        const sessionId = event.data?.object?.id;
        if (!sessionPattern.test(sessionId || "")) return sendJson(res, 200, { received: true });
        await deliverOrderEmail(sessionId);
        return sendJson(res, 200, { received: true });
      }
      if (req.method === "GET" && url.pathname === "/api/health") {
        const products = await catalog();
        const filesReady = await Promise.all(products.map((product) => hasStl(product.id)));
        const missing = products.filter((_, index) => !filesReady[index]).map((product) => `${product.id}.stl`);
        return sendJson(res, 200, missing.length || !products.length
          ? { checkout: false, missing } : { checkout: true });
      }
      if (req.method === "POST" && url.pathname === "/api/checkout") {
        if (req.headers.origin && req.headers.origin !== origin) throw Object.assign(new Error("Invalid origin"), { status: 403 });
        const body = await readBody(req);
        const ids = body?.productIds;
        const email = body?.email;
        if (email !== undefined && (typeof email !== "string" || email.length > 254 || !emailPattern.test(email))) {
          throw Object.assign(new Error("Invalid checkout email"), { status: 400 });
        }
        if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || ids.some((id) => typeof id !== "string" || !idPattern.test(id)) || new Set(ids).size !== ids.length) {
          throw Object.assign(new Error("Choose 1 to 20 distinct products"), { status: 400 });
        }
        const products = await catalog();
        const selected = ids.map((id) => products.find((product) => product.id === id));
        if (selected.some((product) => !product || !Number.isSafeInteger(Math.round(product.price * 100)) || product.price <= 0)) {
          throw Object.assign(new Error("A product is unavailable"), { status: 400 });
        }
        for (const id of ids) {
          if (!(await hasStl(id))) throw Object.assign(new Error(`STL file for ${id} is unavailable`), { status: 409 });
        }
        const params = new URLSearchParams({
          mode: "payment", success_url: `${origin}/order.html?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/`, "metadata[product_ids]": ids.join(","),
        });
        if (email) params.set("customer_email", email);
        selected.forEach((product, i) => {
          params.set(`line_items[${i}][price_data][currency]`, "usd");
          params.set(`line_items[${i}][price_data][unit_amount]`, String(Math.round(product.price * 100)));
          params.set(`line_items[${i}][price_data][product_data][name]`, product.name);
          params.set(`line_items[${i}][quantity]`, "1");
        });
        const session = await stripe("checkout/sessions", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params });
        if (!session.url?.startsWith("https://checkout.stripe.com/")) throw new Error("Stripe returned an invalid checkout URL");
        return sendJson(res, 200, { url: session.url });
      }
      if (req.method === "GET" && url.pathname === "/api/order") {
        const order = await paidOrder(url.searchParams.get("session_id"), true);
        if (order === null) return sendJson(res, 202, { status: "pending" });
        const products = await catalog();
        return sendJson(res, 200, { products: order.ids.map((id) => ({ id, name: products.find((product) => product.id === id)?.name || id })),
          expiresAt: new Date(order.expiresAt * 1000).toISOString(),
          email: order.email });
      }
      if (req.method === "GET" && url.pathname === "/api/download") {
        const id = url.searchParams.get("id");
        const order = await paidOrder(url.searchParams.get("session_id"));
        if (!order.ids.includes(id)) throw Object.assign(new Error("This file is not in the order"), { status: 403 });
        const object = await r2.get(id);
        if (!object?.body) throw Object.assign(new Error("File unavailable"), { status: 404 });
        const length = object.headers.get("content-length");
        const size = Number(length);
        const headers = { "Content-Type": "model/stl",
          "Content-Disposition": `attachment; filename="${id}.stl"`, "Cache-Control": "private, no-store" };
        if (length !== null && Number.isSafeInteger(size) && size >= 0) headers["Content-Length"] = size;
        res.writeHead(200, headers);
        await pipeline(Readable.fromWeb(object.body), res);
        return;
      }
      if (req.method === "GET" && (publicFiles.has(url.pathname) || imagePath.test(url.pathname) || fontPath.test(url.pathname))) {
        const name = url.pathname === "/" ? "/index.html" : url.pathname;
        const filePath = path.join(siteRoot, name.slice(1));
        const file = await stat(filePath).catch(() => null);
        if (!file?.isFile()) throw Object.assign(new Error("Not found"), { status: 404 });
        res.writeHead(200, { "Content-Type": types[path.extname(filePath)] || "font/woff2", "Content-Length": file.size });
        return createReadStream(filePath).pipe(res);
      }
      throw Object.assign(new Error("Not found"), { status: 404 });
    } catch (error) {
      if (!error.status) console.error(error);
      if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : "Server error" });
      else res.destroy(error);
    }
  }
  return createServer(handler);
}
