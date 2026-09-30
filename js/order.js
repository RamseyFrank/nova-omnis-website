"use strict";

const status = document.querySelector("#order-status");
const list = document.querySelector("#order-downloads");
const sessionId = new URLSearchParams(location.search).get("session_id");

async function loadOrder() {
  if (!sessionId) {
    status.textContent = "This download link is incomplete.";
    return;
  }
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      const response = await fetch(`/api/order?session_id=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
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
      return;
    } catch (error) {
      status.textContent = error.message || "Could not load your order. Please refresh and try again.";
      return;
    }
  }
  status.textContent = "Payment is still processing. Save this link and refresh the page later.";
}

loadOrder();
