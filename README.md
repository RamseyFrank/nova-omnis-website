# Nova Omnis

This repository contains the Nova Omnis website.

The storefront uses static HTML, CSS, and JavaScript, plus a small Node.js server
for Stripe Checkout and private STL downloads. Node.js 22 or newer is required.
There are no npm dependencies.

## Checkout and STL delivery

The server creates a Stripe hosted Checkout Session using prices from the generated
catalog. On return, the order page asks Stripe whether that session was paid before
showing download links. Every download checks payment again. Files are never served
as public static assets.

1. Place each product's STL in a **private folder outside this project and outside
   the host's public website directory**, named `<product-id>.stl`. For example,
   `sister-of-battle.stl`. IDs are listed in `data/products.json`. Checkout refuses
   an item whose file is missing or empty. Never add the files to `assets/`, `data/`,
   or a public Git repository.
2. Create a Stripe account and get its secret key from the Stripe dashboard. Use a
   test key while testing. Keep the key on the server; never put it in HTML or JS.
3. Configure these environment variables on the host:

   - `STRIPE_SECRET_KEY`: Stripe secret key, beginning `sk_test_` or `sk_live_`.
   - `PUBLIC_BASE_URL`: the site's public origin, such as `https://example.com`.
   - `STL_STORAGE_DIR`: absolute path to the private STL folder.
   - `PORT`: optional; defaults to `3000`. Hosts usually set this automatically.

4. Start with `node server.mjs` or `npm start`, then open the URL for that server.
   Checkout requires this server; a static file host alone cannot protect the files
   or call Stripe with a secret key.
5. Test a purchase using Stripe test mode and a test card before switching to a
   live key. A paid order returns to `order.html` with download links. Save that
   link: it allows repeat downloads and should be treated as private. The current
   implementation delivers files on that page; it does not email download links.

### Hostinger Business Web Hosting

Your Business plan supports Node.js web apps. In hPanel, choose **Add Website →
Deploy Web App** and deploy this project from GitHub or a ZIP. Choose Node.js 22
and **Other** if asked for a framework; set the entry file to `server.mjs` or the
start command to `npm start`. This project has no build command.

For STL storage, use Hostinger File Manager to create a private folder at the
domain's directory level, alongside `public_html` and `hbuilds`, for example
`/home/u12345678/domains/example.com/private_stl`. Upload `<product-id>.stl`
files there and set `STL_STORAGE_DIR` to that exact absolute path. The number
and domain are examples; use your own path. Do not put STL files under
`public_html` or `hbuilds`: Hostinger says those locations are managed by
deployments and overwritten. Set the three environment variables above in the
Node.js app deployment settings. The storage folder's readability by the app
must be verified with a test purchase before going live.

For a direct `novaomnis.com` deployment, push this repository to GitHub, then
create a Hostinger Node.js web app connected to that repository and set
`PUBLIC_BASE_URL=https://novaomnis.com`. Hostinger currently requires removing
the website already assigned to `novaomnis.com` before a new Node.js website
can use that domain. Perform that domain reassignment in hPanel after the new
app's configuration is ready. The checkout button checks `/api/health`, so it
remains disabled while the existing static site is still serving the domain and
until every published product has a private STL file.
Use a Stripe test key for the first purchase test on the live domain; replace it
with a live key after payment and download succeed in test mode.

## Product pipeline

Product details live in `content/products/<id>.json`. The pipeline validates these
files and their images, then generates `data/products.json` for the storefront.
**Edit the source files, not the generated catalog.** Node.js 22 or newer is needed
for these commands; no `npm install` is required. The deployed site stays static.

### Add a product

1. From the project root, create a draft:

   ```sh
   npm run product:add -- --name "New Marine" --price 5.00
   ```

   This creates `content/products/new-marine.json` and
   `assets/images/products/new-marine/`. Use `--id custom-slug` to choose the ID.
   Omit `--price` if undecided; the draft starts with `null`.
   Existing product files are never overwritten.

2. Put web-ready images in that image folder, named `01.webp`, `02.webp`, etc.
   Supported formats: WebP, PNG, JPG, JPEG, AVIF. Use lowercase filenames without
   spaces. Images are automatically discovered and sorted in numeric filename
   order; the first image is the cover. `originals/` is ignored by the pipeline
   and Git. Images are used as supplied; this pipeline does not resize or convert them.

3. Edit the draft's name, price, description, and display order. Lower `order`
   numbers appear first; ties sort by ID. Drafts stay out of the generated catalog.
   When ready, set `"status": "published"`:

   ```json
   {
     "id": "new-marine",
     "name": "New Marine",
     "price": 5,
     "description": "Your product description.",
     "status": "published",
     "order": 100
   }
   ```

   For a custom cover, gallery order, or image subset, add an optional field:
   `"images": ["03.webp", "01.webp", "02.webp"]`. These are filenames inside that
   product's folder. Omit `images` to discover all supported images automatically.

4. Generate and check the catalog:

   ```sh
   npm run catalog:build
   npm run check
   ```

5. Preview through your local HTTP server, then commit the product JSON, its
   images, and the generated `data/products.json` together. Deploy the static site
  through your usual hosting process. Building locally does not deploy it. Also
  upload the matching private STL file before enabling sales for a new product.

### Update or hide a product

Edit its source JSON or images and run `npm run catalog:build` again. To hide a
product, change its status back to `draft` and rebuild. Keep IDs stable: the cart
uses them to identify products. There is no ten-product limit; the storefront
displays only published products, with no placeholder cards.

### Validation and automation

- `npm run catalog:build` validates all sources before replacing the catalog.
  A failed validation leaves the last working catalog intact.
- `npm run catalog:check` validates sources and detects an outdated generated
  catalog without writing files.
- `npm test` exercises draft/publish behavior, gallery order, invalid data,
  duplicate IDs, growth beyond ten products, and failed-build preservation.
- `npm run check` runs the catalog check and tests. The GitHub Actions workflow
  runs the same command on pushes and pull requests.

Published products need a name, a non-negative USD price with at most two decimal
places, and at least one existing, nonempty image file. Descriptions may be empty.
Drafts may omit images and use `null` for the price; other fields are still
validated. Unknown fields and invalid image references are rejected to catch typos.
Image validation checks filenames and files, not image decoding or visual quality.

## Wordmark font

The lowercase `novaomnis` wordmark loads Bauhaus Bold (`bauhaub`) from
the supplied `static.wfonts.com` TrueType URL. It uses a 32px desktop size, smaller
sizes on narrow screens, and the color `#373c44`. While the font loads, or if the
remote service is unavailable, the wordmark uses the system font fallback.
On page entry, a single staggered color wave passes through the letters using
the product-background palette, then returns to the normal wordmark color.
The animation is disabled for reduced-motion preferences and forced-color mode.

## Local Satoshi fonts

Satoshi is configured as the primary font, but its font files are not included.
Place these files inside `assets/fonts/satoshi/` with these exact names:

- `Satoshi-Regular.woff2` (400)
- `Satoshi-Medium.woff2` (500)
- `Satoshi-Bold.woff2` (700)

The existing `@font-face` rules in `css/styles.css` will load them automatically.
Until they are present, the browser uses the configured system font fallback.
Satoshi is not downloaded from external services; only the wordmark font is remote.

## Prototype behavior

- Dark Angel Marine loads from the generated `data/products.json` and
  uses its first WebP on the homepage. All six existing angles are available in
  the product overlay. Its description remains empty until real copy is added.
- The grid displays only products from the generated catalog. An empty catalog
  shows "No products available yet." instead of placeholder cards.
- The grid uses two columns on desktop and tablet, and one column at widths of
  480px or less. The centered page is capped at 1280px, with fluid square images.
- The plus button adds one item without opening a dialog. Product images and
  names open the detail overlay. The cart icon opens the product list and subtotal.
- Each product can be added only once per cart. Its add buttons stay disabled
  and sage with a checkmark on the card and "Added to cart" in the detail overlay
  until it is removed. Different products can be
  added together; cart rows provide Remove without quantity controls.
- The cart icon shows a count only when items are present. Each cart row includes
  the product's cover image beside its name, price, and total.
- The cart stays in memory for the current page session and resets on refresh.
  Prices are displayed in USD. Removing a product enables its add buttons again.
- CHECKOUT starts Stripe hosted payment when the server is configured and the
  matching private STL files are present. Overlays close via the close button,
  Escape, or the backdrop.
