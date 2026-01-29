document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("ss-matrix-widget");
    if (!container) return;

    const variants = JSON.parse(container.dataset.variants);
    const skus = variants.map(v => v.sku).filter(s => s);

    if (skus.length === 0) {
      container.innerHTML = "<p>No connectable variants found.</p>";
      return;
    }

    // Fetch Inventory from App Proxy
    try {
      const response = await fetch("/apps/ssactiveorder/api/graphql", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query GetInventory($skus: [String]!) {
              getInventory(skus: $skus) {
                sku
                warehouses {
                  qty
                }
              }
            }
          `,
          variables: { skus }
        })
      });

      const { data } = await response.json();
      const inventoryMap = new Map();
      if (data && data.getInventory) {
        data.getInventory.forEach(item => {
          const total = item.warehouses.reduce((sum, w) => sum + w.qty, 0);
          inventoryMap.set(item.sku, total);
        });
      }

      renderMatrix(variants, inventoryMap, container);

    } catch (error) {
      console.error("Matrix Widget Error:", error);
      document.getElementById("ss-matrix-loading").innerText = "Error loading inventory.";
    }
  });

  function renderMatrix(variants, inventoryMap, container) {
    const content = document.getElementById("ss-matrix-content");
    document.getElementById("ss-matrix-loading").style.display = "none";
    content.style.display = "block";

    let html = '<table style="width:100%; text-align: left; border-collapse: collapse;">';
    html += '<thead><tr><th>Variant</th><th>Stock</th><th>Qty</th></tr></thead><tbody>';

    variants.forEach(variant => {
      const stock = inventoryMap.get(variant.sku) || 0;
      html += `
        <tr style="border-bottom: 1px solid #eee;">
          <td style="padding: 10px;">${variant.title}</td>
          <td style="padding: 10px;">${stock}</td>
          <td style="padding: 10px;">
            <input type="number" min="0" max="${stock}" data-variant-id="${variant.id}" class="ss-qty-input" style="width: 60px; padding: 5px;">
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    html += '<button id="ss-add-to-cart" style="margin-top: 15px; padding: 10px 20px; background: black; color: white; border: none; cursor: pointer;">Add All to Cart</button>';

    content.innerHTML = html;

    document.getElementById("ss-add-to-cart").addEventListener("click", addToCart);
  }

  async function addToCart() {
    const inputs = document.querySelectorAll(".ss-qty-input");
    const items = [];

    inputs.forEach(input => {
      const qty = parseInt(input.value);
      if (qty > 0) {
        items.push({
          id: input.dataset.variantId,
          quantity: qty
        });
      }
    });

    if (items.length === 0) return;

    await fetch(window.Shopify.routes.root + 'cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items })
    });

    // Refresh cart or redirect
    window.location.href = '/cart';
  }
