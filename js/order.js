"use strict";

const status = document.querySelector("#order-status");
const list = document.querySelector("#order-downloads");
const help = document.querySelector("#order-help");
const sessionId = new URLSearchParams(location.search).get("session_id");

async function loadOrder() {
  if (!sessionId) {
    status.textContent = "This download link is incomplete.";
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
      for (const product of order.products) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.textContent = `Download ${product.name} STL`;
        link.href = `/api/download?session_id=${encodeURIComponent(sessionId)}&id=${encodeURIComponent(product.id)}`;
        item.append(link);
        list.append(item);
      }
      list.hidden = false;
      status.textContent = "Payment confirmed. Your files are ready.";
      help.textContent = `Download before ${new Date(order.expiresAt).toLocaleString()}. Keep this page link private.`;
      const expirePage = () => {
        list.hidden = true;
        status.textContent = "This download link has expired.";
        help.textContent = "This download link can no longer be used.";
      };
      const remaining = new Date(order.expiresAt).getTime() - Date.now();
      if (remaining <= 0) expirePage();
      else setTimeout(expirePage, remaining);
      return;
    } catch (error) {
      status.textContent = error.message || "Could not load your order. Please refresh and try again.";
      if (response?.status === 410) help.textContent = "This download link can no longer be used.";
      return;
    }
  }
  status.textContent = "Payment is still processing. Save this link and refresh the page later.";
}

loadOrder();
