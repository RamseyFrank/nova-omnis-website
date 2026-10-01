import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHmac } from "node:crypto";
import { createApp } from "../app.mjs";

test("checkout prices come from the server and paid sessions gate STL downloads", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "nova-checkout-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const siteRoot = path.join(workspace, "site");
  await mkdir(path.join(siteRoot, "data"), { recursive: true });
  await writeFile(path.join(siteRoot, "data/products.json"), JSON.stringify([
    { id: "marine", name: "Marine", price: 5, images: ["assets/images/products/marine/01.webp"] },
    { id: "other", name: "Other", price: 7 },
  ]));
  const calls = [];
  let paid = false;
  let emailSentAt = null;
  const delivered = [];
  let failDelivery = false;
  const created = 1_700_000_000;
  let currentTime = (created + 3600) * 1000;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith("https://api.stripe.com/")) {
      if (options.method === "POST" && url.endsWith("/cs_test_123")) {
        emailSentAt = new URLSearchParams(options.body).get("metadata[delivery_email_sent_at]");
        return Response.json({ id: "cs_test_123" });
      }
      if (options.method === "POST") return Response.json({ url: "https://checkout.stripe.com/test-session" });
      return Response.json({ id: "cs_test_123", mode: "payment", status: "complete", created,
        payment_status: paid ? "paid" : "unpaid", customer_details: paid ? { email: "buyer@example.com" } : null,
        metadata: { product_ids: "marine", delivery_email_sent_at: emailSentAt } });
    }
    assert.match(options.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=test-access\/\d{8}\/auto\/s3\/aws4_request,/);
    if (url.endsWith("/other.stl")) return new Response(null, { status: 404 });
    assert.equal(url, `https://${"a".repeat(32)}.r2.cloudflarestorage.com/nova-private/marine.stl`);
    if (options.method === "HEAD") return new Response(null, { headers: { "content-length": "29" } });
    return new Response("solid marine\nendsolid marine\n");
  };
  const server = createApp({ secretKey: "sk_test_example", baseUrl: "http://127.0.0.1", siteRoot, fetchImpl,
    now: () => currentTime, webhookSecret: "whsec_example", emailConfigured: true, deliverEmail: async (message) => {
      if (failDelivery) throw new Error("SMTP unavailable");
      delivered.push(message);
    },
    r2AccountId: "a".repeat(32), r2Bucket: "nova-private", r2AccessKeyId: "test-access", r2SecretAccessKey: "test-secret" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { checkout: false, missing: ["other.stl"] });
  const checkout = await fetch(`${base}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["marine"], price: 1 }) });
  assert.equal(checkout.status, 200);
  assert.equal((await checkout.json()).url, "https://checkout.stripe.com/test-session");
  const form = new URLSearchParams(calls.find((call) => call.options.method === "POST").options.body);
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "500");
  assert.equal(form.get("payment_method_types[0]"), "card");
  assert.equal(form.get("metadata[product_ids]"), "marine");
  assert.equal(form.get("customer_email"), null);
  const repeatCheckout = await fetch(`${base}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["marine"], email: "buyer@example.com" }) });
  assert.equal(repeatCheckout.status, 200);
  const repeatForm = new URLSearchParams(calls.filter((call) => call.options.method === "POST").at(-1).options.body);
  assert.equal(repeatForm.get("customer_email"), "buyer@example.com");
  assert.equal((await fetch(`${base}/api/checkout`, { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://www.127.0.0.1" },
    body: JSON.stringify({ productIds: ["marine"] }) })).status, 200);
  assert.equal((await fetch(`${base}/api/checkout`, { method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://other.example" },
    body: JSON.stringify({ productIds: ["marine"] }) })).status, 403);
  assert.equal((await fetch(`${base}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["marine"], email: "invalid" }) })).status, 400);
  const pendingOrder = await fetch(`${base}/api/order?session_id=cs_test_123`);
  assert.equal(pendingOrder.status, 202);
  assert.deepEqual(await pendingOrder.json(), { status: "pending" });
  assert.equal((await fetch(`${base}/api/download?session_id=cs_test_123&id=marine`)).status, 403);
  paid = true;
  const order = await fetch(`${base}/api/order?session_id=cs_test_123`);
  assert.deepEqual(await order.json(), { products: [{ id: "marine", name: "Marine", image: "assets/images/products/marine/01.webp" }],
    expiresAt: new Date((created + 24 * 3600) * 1000).toISOString(), email: "buyer@example.com" });
  const download = await fetch(`${base}/api/download?session_id=cs_test_123&id=marine`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /marine\.stl/);
  assert.equal(await download.text(), "solid marine\nendsolid marine\n");
  assert.equal((await fetch(`${base}/api/download?session_id=cs_test_123&id=other`)).status, 403);
  const event = JSON.stringify({ type: "checkout.session.completed", data: { object: { id: "cs_test_123" } } });
  const timestamp = Math.floor(currentTime / 1000);
  const signature = createHmac("sha256", "whsec_example").update(`${timestamp}.${event}`).digest("hex");
  const webhook = () => fetch(`${base}/api/stripe-webhook`, { method: "POST",
    headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }, body: event });
  assert.equal((await fetch(`${base}/api/stripe-webhook`, { method: "POST", body: event })).status, 400);
  failDelivery = true;
  assert.equal((await webhook()).status, 500);
  assert.equal(delivered.length, 0);
  failDelivery = false;
  assert.equal((await webhook()).status, 200);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, "buyer@example.com");
  assert.deepEqual(delivered[0].items, [{ name: "Marine",
    url: "http://127.0.0.1/api/download?session_id=cs_test_123&id=marine" }]);
  assert.equal(delivered[0].expiresAt, new Date((created + 24 * 3600) * 1000).toISOString());
  assert.equal((await webhook()).status, 200);
  assert.equal(delivered.length, 1);
  currentTime += 301_000;
  assert.equal((await webhook()).status, 400);
  currentTime -= 301_000;
  currentTime = (created + 24 * 3600) * 1000;
  const expiredOrder = await fetch(`${base}/api/order?session_id=cs_test_123`);
  assert.equal(expiredOrder.status, 410);
  assert.deepEqual(await expiredOrder.json(), { error: "Download link has expired" });
  assert.equal((await fetch(`${base}/api/download?session_id=cs_test_123&id=marine`)).status, 410);
  assert.equal((await fetch(`${base}/private/marine.stl`)).status, 404);
  assert.equal((await fetch(`${base}/content/products/marine.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["marine", "other"] }) })).status, 409);
});

test("checkout stays unavailable until webhook and email delivery are configured", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "nova-readiness-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  await mkdir(path.join(workspace, "data"));
  await writeFile(path.join(workspace, "data/products.json"), JSON.stringify([
    { id: "marine", name: "Marine", price: 5 },
  ]));
  const fetchImpl = async (url, options) => {
    assert.equal(options.method, "HEAD");
    assert.match(url, /\/marine\.stl$/);
    return new Response(null, { headers: { "content-length": "29" } });
  };
  const server = createApp({ secretKey: "sk_test_example", baseUrl: "http://127.0.0.1",
    siteRoot: workspace, fetchImpl, webhookSecret: "", emailConfigured: false,
    r2AccountId: "a".repeat(32), r2Bucket: "nova-private", r2AccessKeyId: "test-access",
    r2SecretAccessKey: "test-secret" });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), {
    checkout: false, missing: [], configuration: ["STRIPE_WEBHOOK_SECRET", "GMAIL_USER/GMAIL_APP_PASSWORD"],
  });
  const checkout = await fetch(`${base}/api/checkout`, { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productIds: ["marine"] }) });
  assert.equal(checkout.status, 503);
  assert.deepEqual(await checkout.json(), { error: "Checkout is not ready" });
});
