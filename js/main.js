"use strict";

const productGrid = document.querySelector("#product-grid");
const catalogStatus = document.querySelector("#catalog-status");
const productDialog = document.querySelector("#product-dialog");
const cartDialog = document.querySelector("#cart-dialog");
const cartTrigger = document.querySelector("#cart-trigger");
const cartItems = document.querySelector("#cart-items");
const detailAdd = document.querySelector("#detail-add");
const detailStatus = document.querySelector("#detail-status");

// Prices in the current data are displayed as USD for this storefront prototype.
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const products = new Map();
const cart = new Map();
const feedbackTimers = new WeakMap();
let activeProduct = null;

function formatPrice(amount) {
  return currency.format(amount);
}

function makePlaceholder(label = "IMAGE UNAVAILABLE") {
  const placeholder = document.createElement("span");
  placeholder.className = "placeholder-image";
  placeholder.textContent = label;
  placeholder.setAttribute("aria-hidden", "true");
  return placeholder;
}

function makeImage(product, index = 0, lazy = false) {
  const image = document.createElement("img");
  image.src = product.images[index];
  image.alt = `${product.name} — view ${index + 1}`;
  image.width = 2048;
  image.height = 2048;
  image.decoding = "async";
  image.loading = lazy ? "lazy" : "eager";
  image.addEventListener("error", () => image.replaceWith(makePlaceholder("IMAGE UNAVAILABLE")), { once: true });
  return image;
}

function renderCatalog() {
  const template = document.querySelector("#product-card-template");
  const fragment = document.createDocumentFragment();

  for (const product of products.values()) {
    const card = template.content.cloneNode(true);
    const media = card.querySelector(".product-media");
    const quickAdd = card.querySelector(".quick-add");
    media.append(product.images.length ? makeImage(product) : makePlaceholder());
    media.setAttribute("aria-label", `View ${product.name}`);
    card.querySelector(".product-name").textContent = product.name;
    card.querySelector(".product-price").textContent = formatPrice(product.price);
    card.querySelectorAll("[data-open-product]").forEach((button) => {
      button.addEventListener("click", () => openProduct(product));
    });
    quickAdd.setAttribute("aria-label", `Add one ${product.name} to cart`);
    quickAdd.addEventListener("click", () => addToCart(product, quickAdd));
    fragment.append(card);
  }

  productGrid.replaceChildren(fragment);
}

function showProductImage(product, index) {
  document.querySelector("#detail-image").replaceChildren(makeImage(product, index));
  document.querySelectorAll(".detail-thumbnail").forEach((button, buttonIndex) => {
    button.setAttribute("aria-pressed", String(buttonIndex === index));
  });
}

function resetAddFeedback(button) {
  clearTimeout(feedbackTimers.get(button));
  button.classList.remove("is-added");
}

function openProduct(product) {
  activeProduct = product;
  document.querySelector("#detail-name").textContent = product.name;
  document.querySelector("#detail-price").textContent = formatPrice(product.price);
  const description = document.querySelector("#detail-description");
  description.textContent = product.description;
  description.hidden = !product.description;
  detailStatus.textContent = "";
  resetAddFeedback(detailAdd);
  detailAdd.setAttribute("aria-label", `Add one ${product.name} to cart`);

  const thumbnails = document.querySelector("#detail-thumbnails");
  thumbnails.replaceChildren();
  thumbnails.hidden = product.images.length < 2;

  product.images.forEach((_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "detail-thumbnail";
    button.setAttribute("aria-label", `View angle ${index + 1} of ${product.images.length}`);
    button.setAttribute("aria-pressed", String(index === 0));
    const image = makeImage(product, index, true);
    image.alt = "";
    button.append(image);
    button.addEventListener("click", () => showProductImage(product, index));
    thumbnails.append(button);
  });

  const media = document.querySelector("#detail-image");
  media.replaceChildren(product.images.length ? makeImage(product) : makePlaceholder());
  productDialog.showModal();
  productDialog.scrollTop = 0;
}

function addToCart(product, button) {
  cart.set(product.id, (cart.get(product.id) || 0) + 1);
  updateCart();

  resetAddFeedback(button);
  button.classList.add("is-added");
  feedbackTimers.set(button, setTimeout(() => resetAddFeedback(button), 1000));

  const count = cartCount();
  const message = `${product.name} added. ${count} ${count === 1 ? "item" : "items"} in your cart.`;
  document.querySelector("#cart-status").textContent = message;
  if (productDialog.open) detailStatus.textContent = message;
}

function cartCount() {
  return [...cart.values()].reduce((total, quantity) => total + quantity, 0);
}

function updateCart() {
  const count = cartCount();
  const countBadge = document.querySelector("#cart-count");
  countBadge.textContent = count;
  countBadge.hidden = count === 0;
  document.querySelector("#drawer-count").textContent = count;
  cartTrigger.setAttribute("aria-label", `Cart, ${count} ${count === 1 ? "item" : "items"}`);
  document.querySelector("#cart-empty").hidden = count > 0;
  cartItems.hidden = count === 0;

  // Use integer cents for the subtotal to avoid floating-point rounding drift.
  let subtotalCents = 0;
  for (const [id, quantity] of cart) {
    subtotalCents += Math.round(products.get(id).price * 100) * quantity;
  }
  document.querySelector("#cart-subtotal").textContent = formatPrice(subtotalCents / 100);
  if (cartDialog.open) renderCartItems();
}

function changeQuantity(id, change) {
  const product = products.get(id);
  const quantity = Math.max(0, (cart.get(id) || 0) + change);
  if (quantity) cart.set(id, quantity);
  else cart.delete(id);
  updateCart();
  document.querySelector("#drawer-status").textContent = quantity
    ? `${product.name}: ${quantity}. Subtotal ${document.querySelector("#cart-subtotal").textContent}.`
    : `${product.name} removed from your cart.`;
}

function renderCartItems() {
  // Preserve keyboard focus when quantity changes rebuild the list.
  const focused = document.activeElement;
  const focusedRow = focused.closest(".cart-item");
  const focusedId = focusedRow?.dataset.productId;
  const focusedIndex = [...cartItems.children].indexOf(focusedRow);
  const focusedControl = focused.dataset.quantity || (focused.classList.contains("remove-item") ? "remove" : null);
  const template = document.querySelector("#cart-item-template");
  const fragment = document.createDocumentFragment();

  for (const [id, quantity] of cart) {
    const product = products.get(id);
    const item = template.content.cloneNode(true);
    item.querySelector(".cart-item").dataset.productId = id;
    item.querySelector(".cart-item-image").append(product.images.length ? makeImage(product, 0, true) : makePlaceholder());
    item.querySelector(".cart-item-name").textContent = product.name;
    item.querySelector(".cart-item-price").textContent = `${formatPrice(product.price)} each`;
    item.querySelector(".cart-item-total").textContent = formatPrice(Math.round(product.price * 100) * quantity / 100);
    item.querySelector(".item-quantity").textContent = quantity;
    item.querySelector(".quantity-control").setAttribute("aria-label", `Quantity for ${product.name}`);
    item.querySelectorAll("[data-quantity]").forEach((button) => {
      const change = Number(button.dataset.quantity);
      button.setAttribute("aria-label", `${change > 0 ? "Increase" : "Decrease"} quantity of ${product.name}`);
      button.addEventListener("click", () => changeQuantity(id, change));
    });
    const remove = item.querySelector(".remove-item");
    remove.setAttribute("aria-label", `Remove ${product.name} from cart`);
    remove.addEventListener("click", () => changeQuantity(id, -quantity));
    fragment.append(item);
  }

  cartItems.replaceChildren(fragment);
  if (focusedId && focusedControl) {
    const rows = [...cartItems.children];
    const row = rows.find((item) => item.dataset.productId === focusedId)
      || rows[Math.min(focusedIndex, rows.length - 1)];
    const control = focusedControl === "remove" ? ".remove-item" : `[data-quantity="${focusedControl}"]`;
    (row?.querySelector(control) || document.querySelector("#cart-empty button")).focus();
  }
}

cartTrigger.addEventListener("click", () => {
  renderCartItems();
  document.querySelector("#drawer-status").textContent = "";
  cartDialog.showModal();
});

detailAdd.addEventListener("click", () => {
  if (activeProduct) addToCart(activeProduct, detailAdd);
});

// Native dialogs provide Escape handling, focus trapping, and focus restoration.
for (const dialog of [productDialog, cartDialog]) {
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });
  const isOutside = (event) => {
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  let pointerStartedOutside = false;
  dialog.addEventListener("pointerdown", (event) => {
    pointerStartedOutside = event.target === dialog && isOutside(event);
  });
  dialog.addEventListener("click", (event) => {
    if (pointerStartedOutside && event.target === dialog && isOutside(event)) dialog.close();
    pointerStartedOutside = false;
  });
}

async function loadCatalog() {
  try {
    const response = await fetch("data/products.json");
    if (!response.ok) throw new Error(`Product data returned ${response.status}`);
    const realProducts = await response.json();
    for (const product of realProducts) {
      products.set(product.id, product);
    }
    renderCatalog();
    catalogStatus.textContent = products.size ? "" : "No products available yet.";
    catalogStatus.hidden = products.size > 0;
  } catch (error) {
    catalogStatus.textContent = "Products could not be loaded. Please refresh to try again.";
    console.error("Unable to load the catalog:", error);
  }
}

updateCart();
loadCatalog();
