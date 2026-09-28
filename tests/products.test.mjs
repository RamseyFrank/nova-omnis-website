import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { addProduct, buildCatalog, writeCatalog, checkCatalog } from "../scripts/products.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "nova-products-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "content/products"), { recursive: true });
  return root;
}

async function save(root, product) {
  await writeFile(path.join(root, `content/products/${product.id}.json`), JSON.stringify(product));
}

async function addImages(root, id, names = ["01.webp"]) {
  const folder = path.join(root, "assets/images/products", id);
  await mkdir(folder, { recursive: true });
  // A real 1x1 PNG; validation checks file presence, not image encoding.
  const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=", "base64");
  for (const name of names) await writeFile(path.join(folder, name), pixel);
}

test("draft → published → draft updates the generated storefront catalog", async (t) => {
  const root = await fixture(t);
  const product = await addProduct({ name: "New Marine" }, root);
  assert.equal(product.id, "new-marine");
  assert.equal(product.price, null);
  assert.deepEqual(await buildCatalog(root), { products: [], drafts: 1 });
  await addImages(root, product.id, ["10.png", "02.png", "01.png"]);
  product.price = 5.99;
  product.status = "published";
  await save(root, product);
  const result = await writeCatalog(root);
  assert.deepEqual(result.products[0], {
    id: product.id, name: product.name, price: 5.99, description: "",
    images: ["01.png", "02.png", "10.png"].map((name) => `assets/images/products/new-marine/${name}`),
  });
  await checkCatalog(root);
  product.status = "draft";
  await save(root, product);
  await assert.rejects(checkCatalog(root), /out of date/);
  assert.deepEqual((await writeCatalog(root)).products, []);
});

test("explicit image order controls the cover and excludes unused files and originals", async (t) => {
  const root = await fixture(t);
  const product = await addProduct({ name: "Marine", price: "0" }, root);
  await addImages(root, product.id, ["01.webp", "02.webp", "unused.webp"]);
  await mkdir(path.join(root, "assets/images/products/marine/originals"));
  product.status = "published";
  product.images = ["02.webp", "01.webp"];
  await save(root, product);
  assert.deepEqual((await buildCatalog(root)).products[0].images, [
    "assets/images/products/marine/02.webp", "assets/images/products/marine/01.webp",
  ]);
});

test("invalid product edits leave the last working catalog untouched", async (t) => {
  const root = await fixture(t);
  const product = await addProduct({ name: "Marine", price: "5" }, root);
  await addImages(root, product.id);
  product.status = "published";
  await save(root, product);
  await writeCatalog(root);
  const before = await readFile(path.join(root, "data/products.json"), "utf8");
  const invalid = [
    [{ price: -1 }, /price/],
    [{ price: 1.234 }, /price/],
    [{ price: "5" }, /price/],
    [{ price: null }, /price/],
    [{ status: "publshed" }, /status/],
    [{ name: " " }, /name/],
    [{ order: 1.5 }, /order/],
    [{ images: [] }, /at least one image/],
    [{ images: ["missing.webp"] }, /missing/],
    [{ images: ["01.webp", "01.webp"] }, /duplicates/],
    [{ images: ["../01.webp"] }, /filenames/],
    [{ images: ["01.WEBP"] }, /filenames/],
    [{ image: "01.webp" }, /unknown field/],
    [{ id: "wrong-name" }, /filename/],
  ];
  for (const [change, message] of invalid) {
    await save(root, { ...product, ...change, id: product.id });
    if (change.id) await writeFile(path.join(root, "content/products/marine.json"), JSON.stringify({ ...product, ...change }));
    await assert.rejects(writeCatalog(root), message);
    assert.equal(await readFile(path.join(root, "data/products.json"), "utf8"), before);
  }
});

test("scaffolding refuses duplicate ids and unsafe paths", async (t) => {
  const root = await fixture(t);
  const product = await addProduct({ name: "Marine", price: "5" }, root);
  await assert.rejects(addProduct({ name: "Marine", price: "10" }, root), /already exists/);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, "content/products/marine.json"), "utf8")), product);
  await assert.rejects(addProduct({ name: "Marine", id: "../escape" }, root), /slug/);
  await assert.rejects(addProduct({ name: "Marine", price: "" }, root), /number/);
});

test("missing, empty, and case-sensitive image errors prevent publishing", async (t) => {
  const root = await fixture(t);
  const product = await addProduct({ name: "Marine", price: "5" }, root);
  product.status = "published";
  await save(root, product);
  await assert.rejects(buildCatalog(root), /at least one image/);
  await addImages(root, product.id);
  await writeFile(path.join(root, "assets/images/products/marine/01.webp"), "");
  await assert.rejects(buildCatalog(root), /empty/);
  await addImages(root, product.id, ["01.webp", "Cover.webp"]);
  await assert.rejects(buildCatalog(root), /lowercase/);
});

test("catalog grows beyond ten products and sorts by order then id", async (t) => {
  const root = await fixture(t);
  for (let i = 11; i >= 0; i -= 1) {
    const product = await addProduct({ name: `Marine ${String(i).padStart(2, "0")}`, price: "5" }, root);
    product.status = "published";
    product.order = i === 11 ? 0 : 100;
    await addImages(root, product.id);
    await save(root, product);
  }
  const result = await writeCatalog(root);
  assert.equal(result.products.length, 12);
  assert.deepEqual(result.products.slice(0, 3).map(({ id }) => id), ["marine-11", "marine-00", "marine-01"]);
  await checkCatalog(root);
});

test("malformed JSON errors identify the source file", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "content/products/broken.json"), "{");
  await assert.rejects(buildCatalog(root), /broken.json/);
});

test("preview placeholders shrink as the real catalog grows and never collide with product slugs", async () => {
  const source = await readFile(new URL("../js/main.js", import.meta.url), "utf8");
  const start = source.indexOf("function makePreviewProducts(");
  const end = source.indexOf("function formatPrice(", start);
  const context = vm.createContext({});
  vm.runInContext(source.slice(start, end), context);
  assert.equal(context.makePreviewProducts([{}]).length, 9);
  assert.equal(context.makePreviewProducts(Array(6).fill({})).length, 4);
  assert.equal(context.makePreviewProducts(Array(10).fill({})).length, 0);
  assert.equal(context.makePreviewProducts(Array(12).fill({})).length, 0);
  assert.match(context.makePreviewProducts([{}])[0].id, /^preview:/);
});

test("CLI rejects unknown commands and prints help", () => {
  const script = fileURLToPath(new URL("../scripts/products.mjs", import.meta.url));
  assert.match(execFileSync(process.execPath, [script, "--help"], { encoding: "utf8" }), /Product pipeline/);
  assert.throws(() => execFileSync(process.execPath, [script, "unknown"], { stdio: "pipe" }),
    (error) => error.status === 1 && /Product pipeline/.test(error.stderr.toString()));
});
