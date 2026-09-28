# Nova Omnis

This repository contains the Nova Omnis website.

This rough storefront uses static HTML, CSS, and JavaScript with no dependencies.
Serve the project root with an existing local HTTP server or static host and open
`index.html` through that server. Opening it directly with a `file://` URL will
not allow the browser to fetch `data/products.json`.

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
   through your usual hosting process. Building locally does not deploy it.

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

The lowercase `novaomnis` wordmark loads Motter Tektura at its regular weight from
the supplied `static.wfonts.com` WOFF URL. It uses a 32px desktop size, smaller
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
  names open the detail overlay. The cart icon opens the quantity controls and subtotal.
- The cart stays in memory for the current page session and resets on refresh.
  Prices are displayed in USD. Reducing a quantity to zero removes the item.
- CHECKOUT is a disabled visual placeholder. No payment or checkout service is
  connected. Overlays close via the close button, Escape, or the backdrop.
