"use strict";

const status = document.querySelector("#order-status");
const list = document.querySelector("#order-downloads");
const help = document.querySelector("#order-help");
const page = document.querySelector("#order-page");
const title = document.querySelector("#order-title");
const eyebrow = document.querySelector("#order-eyebrow");
const empty = document.querySelector("#order-empty");
const sessionId = new URLSearchParams(location.search).get("session_id");

function showUnavailable(heading, message) {
  page.dataset.state = "unavailable";
  eyebrow.textContent = "DIGITAL DELIVERY";
  title.textContent = heading;
  status.textContent = message;
  list.hidden = true;
  empty.hidden = false;
  empty.textContent = "Your downloads are unavailable from this link.";
}

async function loadOrder() {
  if (!sessionId) {
    showUnavailable("We couldn't load your files.", "This download link is incomplete.");
    help.textContent = "Open the order link from your checkout confirmation email.";
    return;
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    let response;
    try {
      response = await fetch(`/api/order?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
      const order = await response.json();
      if (response.status === 202) {
        status.textContent = "Your payment is still processing. This page will check again shortly.";
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      if (!response.ok) throw new Error(order.error || "Could not load your order.");
      if (order.email) {
        try { localStorage.setItem("novaomnis.checkoutEmail", order.email); } catch { /* Storage may be unavailable. */ }
      }
      for (const product of order.products) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        const fileIcon = document.createElement("span");
        const fileDetails = document.createElement("span");
        const fileName = document.createElement("span");
        const fileType = document.createElement("span");
        const action = document.createElement("span");
        fileIcon.className = "order-download-icon";
        fileIcon.textContent = "STL";
        if (product.image) {
          const image = document.createElement("img");
          image.src = product.image;
          image.alt = "";
          image.decoding = "async";
          image.loading = "lazy";
          image.addEventListener("error", () => image.remove(), { once: true });
          fileIcon.append(image);
        }
        fileDetails.className = "order-download-details";
        fileName.className = "order-download-name";
        fileName.textContent = product.name;
        fileType.className = "order-download-type";
        fileType.textContent = "3D model file";
        fileDetails.append(fileName, fileType);
        action.className = "order-download-action";
        action.textContent = "Download ↓";
        link.className = "order-download-link";
        link.setAttribute("aria-label", `Download ${product.name} STL`);
        link.href = `/api/download?session_id=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(product.id)}`;
        link.append(fileIcon, fileDetails, action);
        item.append(link);
        list.append(item);
      }
      page.dataset.state = "ready";
      eyebrow.textContent = "PURCHASE COMPLETE";
      title.textContent = "Your files are ready.";
      empty.hidden = true;
      list.hidden = false;
      status.textContent = "Payment confirmed. Choose a file below to download.";
      help.textContent = `Download before ${new Date(order.expiresAt).toLocaleString()}. Keep this page link private.`;
      const expirePage = () => {
        showUnavailable("Your link has expired.", "This download link can no longer be used.");
        help.textContent = "This download link can no longer be used.";
      };
      const remaining = new Date(order.expiresAt).getTime() - Date.now();
      if (remaining <= 0) expirePage();
      else setTimeout(expirePage, remaining);
      return;
    } catch (error) {
      if (response?.status === 410) {
        showUnavailable("Your link has expired.", "This download link can no longer be used.");
        help.textContent = "This download link can no longer be used.";
      } else {
        showUnavailable("We couldn't load your files.", error.message || "Could not load your order. Please refresh and try again.");
      }
      return;
    }
  }
  title.textContent = "Your payment is processing.";
  status.textContent = "Save this link and refresh the page later to get your files.";
}

loadOrder();
