# Nova Omnis

This repository contains the Nova Omnis website.

The storefront uses static HTML, CSS, and JavaScript, plus a small Node.js server
for Stripe Checkout and private STL downloads from Cloudflare R2. Node.js 22 or newer is required.
Run `npm install` before starting the server.

## Checkout and STL delivery

The server creates a Stripe hosted Checkout Session using prices from the generated
catalog. On return, the order page asks Stripe whether that session was paid before
showing download links. Every download checks payment again, then streams the object
from a private Cloudflare R2 bucket. STL files are never served as public static assets.
Checkout accepts card payments so a delayed payment method cannot complete after
the 24-hour download window has already expired.

1. In Cloudflare, use the `nova-omnis-stl` R2 bucket for the STL files. Keep its public development
   URL disabled and do not connect a public custom domain. Upload each product's
   object at the bucket root as `<product-id>.stl`, for example
   `sister-of-battle.stl`. IDs are listed in `data/products.json`. Checkout refuses
   an item whose object is missing or empty. Never add STLs to this project or Git.
2. Create an R2 API token with **Object Read only** permission scoped to this bucket.
   Record its Access Key ID and Secret Access Key securely; Cloudflare only shows the
   secret once. Find the account ID in the R2 dashboard. The Node app uses these
   credentials to read objects; buyers never receive them or a public R2 URL.
3. Create a Stripe account and, in test mode, create a restricted API key with
   **Checkout Sessions: Write** permission (which also permits reads). A standard
   test secret key works too. Keep the key on the server; never put it in HTML or JS.
4. Configure these environment variables on the host:

   - `STRIPE_SECRET_KEY`: Stripe server-side key. A restricted key begins `rk_test_`
     or `rk_live_`; a standard secret key begins `sk_test_` or `sk_live_`.
   - `STRIPE_WEBHOOK_SECRET`: Stripe webhook signing secret for this site's
     `/api/stripe-webhook` endpoint, beginning `whsec_`.
   - `GMAIL_USER`: full Gmail address that sends purchase emails.
   - `GMAIL_APP_PASSWORD`: Gmail app password for that address. Keep it in
     Hostinger's environment settings, never in Git or a website file.
   - `PUBLIC_BASE_URL`: the site's public origin, such as `https://example.com`.
   - `R2_ACCOUNT_ID`: Cloudflare account ID (32 hexadecimal characters).
   - `R2_BUCKET`: `nova-omnis-stl`.
   - `R2_ACCESS_KEY_ID`: R2 token's Access Key ID.
   - `R2_SECRET_ACCESS_KEY`: R2 token's Secret Access Key.
   - `R2_JURISDICTION`: optional; set to `eu`, `us`, or `fedramp` only if the bucket
     was created in one of those jurisdictions. Otherwise leave it unset.
   - `DOWNLOAD_LINK_HOURS`: optional; defaults to `24`. Paid order pages and
     file downloads expire this many hours after the Stripe checkout was started.
     Set a whole number from 1 to 8760. A buyer who takes time to complete
     payment has less than this full period after payment.
   - `PORT`: optional; defaults to `3000`. Hosts usually set this automatically.

5. In Stripe, create a webhook endpoint at `<PUBLIC_BASE_URL>/api/stripe-webhook`
   for `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET`. Gmail requires two step
   verification to create an app password. Put the sender address and app password
   in `GMAIL_USER` and `GMAIL_APP_PASSWORD` on Hostinger. Test and live Stripe
   modes use separate webhook endpoints and signing secrets.
6. Start with `node server.mjs` or `npm start`, then open the URL for that server.
   Checkout requires this server; a static file host alone cannot protect the files
   or call Stripe with a secret key.
7. Test a purchase using Stripe test mode and a test card before switching to a
   live key. A paid order returns to `order.html` with download links. If payment
   is still processing, the page checks again for up to one minute. Save that
   link: it allows repeat downloads until it expires and should be treated as private. The current
   implementation also emails separate links for each purchased file after Stripe
   confirms payment. Those links have the same 24-hour deadline as the order page.
   After a paid order, the browser remembers the checkout email locally and
   prefills it on later purchases from the same browser. Stripe still displays
   the contact field; private browsing or clearing site data removes the saved email.

### Hostinger Business Web Hosting

Your Business plan supports Node.js web apps. In hPanel, choose **Add Website →
Deploy Web App** and deploy this project from GitHub or a ZIP. Choose Node.js 22
and **Other** if asked for a framework; set the entry file to `server.mjs` or the
start command to `npm start`. This project has no build command, but npm
dependencies must be installed during deployment.

R2 storage is independent of both the temporary and final Hostinger websites. Upload
the objects directly to the private R2 bucket and set the environment variables
above in the Node.js app deployment settings. After uploading the objects, check
`https://novaomnis.com/api/health` for `{"checkout":true}`. If checkout is
`false`, check the `missing` array for absent or empty `<product-id>.stl` files
and the `configuration` array for missing webhook or purchase email settings.
The R2 token must also be able to read each object. Complete a Stripe test
purchase and open a download before switching to the live key.

For `novaomnis.com`, first deploy the Node.js app on a temporary Hostinger
domain, using that temporary HTTPS origin as `PUBLIC_BASE_URL`. Verify its
`/api/health` response. Keep the same R2 bucket and credentials when switching
domains. When ready to switch, release `novaomnis.com` from
the existing website before connecting it to the Node.js app. Hostinger may
offer **Change domain → Use temporary domain** to keep the old site's files,
but its domain-change flow warns that associated email accounts, subdomains,
and existing backups may be lost. Back those up and review the exact hPanel
confirmation first. Deleting the old website is another way to release the
domain, but it removes that website's files and settings. Change
`PUBLIC_BASE_URL` to `https://novaomnis.com` in the Node.js app settings. The
Stripe webhook URL must also be changed to `https://novaomnis.com/api/stripe-webhook`;
if you create a new webhook endpoint, use its new signing secret in Hostinger.
Previously emailed links to the temporary domain remain tied to that domain
until they expire. The checkout button checks `/api/health`, so it remains disabled until every
published product has a private R2 object and webhook and email settings are present.
Use a Stripe test key for the first purchase test on the live domain; replace it
with a live key after payment and download succeed in test mode.

## Product pipeline

Product details live in `content/products/<id>.json`. The pipeline validates these
files and their images, then generates `data/products.json` for the storefront.
**Edit the source files, not the generated catalog.** Node.js 22 or newer is needed
for these commands. Run `npm install` once first. The catalog is served by the
Node.js app after deployment.

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
  upload the matching private R2 object before enabling sales for a new product.

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

## Header logo and footer wordmark

The transparent SVG at `assets/images/novaomnis-logo.svg` is centered in the
shop and order page headers and links to the shop home page. The animated
`novaomnis` name remains at the left of each header.

The lowercase `novaomnis` wordmark loads Bauhaus Bold (`bauhaub`) from
the supplied `static.wfonts.com` TrueType URL in the headers and shop footer. It uses the
color `#373c44`. While the font loads, or if the
remote service is unavailable, the wordmark uses the system font fallback.
On page entry and when the footer enters view, a single staggered color wave passes through the letters using
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
  matching private R2 objects are present. Overlays close via the close button,
  Escape, or the backdrop.
