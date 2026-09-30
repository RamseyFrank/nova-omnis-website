import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../server.mjs";

test("checkout prices come from the server and paid sessions gate STL downloads", async (t) => {
  const workspace = await mkdtemp(path.join(tmpdir(), "nova-checkout-"));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const siteRoot = path.join(workspace, "site");
  const storageDir = path.join(workspace, "private");
  await mkdir(path.join(siteRoot, "data"), { recursive: true });
  await mkdir(storageDir);
  await writeFile(path.join(siteRoot, "data/products.json"), JSON.stringify([
    { id: "marine", name: "Marine", price: 5 }, { id: "other", name: "Other", price: 7 },
  ]));
  await writeFile(path.join(storageDir, "marine.stl"), "solid marine\nendsolid marine\n");
  const calls = [];
  let paid = false;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "POST") return Response.json({ url: "https://checkout.stripe.com/test-session" });
    return Response.json({ id: "cs_test_123", mode: "payment", status: "complete",
      payment_status: paid ? "paid" : "unpaid", metadata: { product_ids: "marine" } });
  };
  const server = createApp({ secretKey: "sk_test_example", baseUrl: "http://127.0.0.1", storageDir, siteRoot, fetchImpl });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${base}/api/health`)).json(), { checkout: false });
  const checkout = await fetch(`${base}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["marine"], price: 1 }) });
  assert.equal(checkout.status, 200);
  assert.equal((await checkout.json()).url, "https://checkout.stripe.com/test-session");
  const form = new URLSearchParams(calls[0].options.body);
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "500");
  assert.equal(form.get("metadata[product_ids]"), "marine");
  const pendingOrder = await fetch(`${base}/api/order?session_id=cs_test_123`);
  assert.equal(pendingOrder.status, 202);
  assert.deepEqual(await pendingOrder.json(), { status: "pending" });
  assert.equal((await fetch(`${base}/api/download?session_id=cs_test_123&id=marine`)).status, 403);
  paid = true;
  const order = await fetch(`${base}/api/order?session_id=cs_test_123`);
  assert.deepEqual(await order.json(), { products: [{ id: "marine", name: "Marine" }] });
  const download = await fetch(`${base}/api/download?session_id=cs_test_123&id=marine`);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /marine\.stl/);
  assert.equal(await download.text(), "solid marine\nendsolid marine\n");
  assert.equal((await fetch(`${base}/api/download?session_id=cs_test_123&id=other`)).status, 403);
  assert.equal((await fetch(`${base}/private/marine.stl`)).status, 404);
  assert.equal((await fetch(`${base}/content/products/marine.json`)).status, 404);
  assert.equal((await fetch(`${base}/api/checkout`, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productIds: ["marine", "other"] }) })).status, 409);
});
