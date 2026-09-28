# Nova Omnis

This repository contains the Nova Omnis website.

This rough storefront uses static HTML, CSS, and JavaScript with no dependencies.
Serve the project root with an existing local HTTP server or static host and open
`index.html` through that server. Opening it directly with a `file://` URL will
not allow the browser to fetch `data/products.json`.

## Local Satoshi fonts

Satoshi is configured as the primary font, but its font files are not included.
Place these files inside `assets/fonts/satoshi/` with these exact names:

- `Satoshi-Regular.woff2` (400)
- `Satoshi-Medium.woff2` (500)
- `Satoshi-Bold.woff2` (700)

The existing `@font-face` rules in `css/styles.css` will load them automatically.
Until they are present, the browser uses the configured system font fallback.
No fonts are downloaded from external services.

## Prototype behavior

- Dark Angel Marine loads directly from the unchanged `data/products.json` and
  uses its first WebP on the homepage. All six existing angles are available in
  the product overlay. Its description remains empty until real copy is added.
- Nine clearly marked temporary products live in `js/main.js`. Their $5 prices
  are sample data, and their image areas are CSS blocks. Replace these entries
  as real products are added to keep the catalog at ten products.
- The grid uses two columns on desktop and tablet, and one column at widths of
  480px or less. The centered page is capped at 1280px, with fluid square images.
- The plus button adds one item without opening a dialog. Product images and
  names open the detail overlay. CART opens the quantity controls and subtotal.
- The cart stays in memory for the current page session and resets on refresh.
  Prices are displayed in USD. Reducing a quantity to zero removes the item.
- CHECKOUT is a disabled visual placeholder. No payment or checkout service is
  connected. Overlays close via the close button, Escape, or the backdrop.
