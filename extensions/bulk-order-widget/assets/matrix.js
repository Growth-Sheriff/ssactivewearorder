// SSActiveWear Bulk Order Matrix Widget
(function() {
  document.addEventListener("DOMContentLoaded", initBulkOrderWidgets);

  function initBulkOrderWidgets() {
    const widgets = document.querySelectorAll('[id^="ss-matrix-widget-"]');
    widgets.forEach(widget => initWidget(widget));
  }

  function initWidget(container) {
    const blockId = container.id.replace('ss-matrix-widget-', '');
    const loadingEl = document.getElementById(`ss-loading-${blockId}`);
    const contentEl = document.getElementById(`ss-content-${blockId}`);
    const errorEl = document.getElementById(`ss-error-${blockId}`);

    const variants = JSON.parse(container.dataset.variants || '[]');
    const layout = container.dataset.layout || 'expanded';
    const showWarehouse = container.dataset.showWarehouse === 'true';
    const buttonText = container.dataset.buttonText || 'Add Selected to Cart';

    const skus = variants.map(v => v.sku).filter(s => s && s.trim());

    if (skus.length === 0) {
      loadingEl.style.display = 'none';
      errorEl.innerHTML = '<p>This product is not connected to SSActiveWear inventory.</p>';
      errorEl.style.display = 'block';
      return;
    }

    // Fetch Inventory from App Proxy
    fetchInventory(skus)
      .then(inventoryData => {
        loadingEl.style.display = 'none';
        renderMatrix(variants, inventoryData, contentEl, { layout, showWarehouse, buttonText });
        contentEl.style.display = 'block';
      })
      .catch(error => {
        console.error("Matrix Widget Error:", error);
        loadingEl.style.display = 'none';
        errorEl.innerHTML = `<p>Unable to load inventory data. Please refresh the page.</p>`;
        errorEl.style.display = 'block';
      });
  }

  async function fetchInventory(skus) {
    const response = await fetch("/apps/ssactiveorder/api/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query GetInventory($skus: [String]!) {
            getInventory(skus: $skus) {
              sku
              warehouses {
                warehouseAbbr
                qty
              }
            }
          }
        `,
        variables: { skus }
      })
    });

    const json = await response.json();

    if (json.data && json.data.getInventory) {
      const inventoryMap = new Map();
      json.data.getInventory.forEach(item => {
        const warehouseData = {};
        let total = 0;
        item.warehouses.forEach(w => {
          warehouseData[w.warehouseAbbr] = w.qty;
          total += w.qty;
        });
        inventoryMap.set(item.sku, { total, warehouses: warehouseData });
      });
      return inventoryMap;
    }

    return new Map();
  }

  function renderMatrix(variants, inventoryMap, container, options) {
    const { layout, showWarehouse, buttonText } = options;

    // Group variants by option (color/size)
    const colorSizeMap = new Map();
    const allSizes = new Set();
    const allColors = new Set();

    variants.forEach(variant => {
      const color = variant.option1 || 'Default';
      const size = variant.option2 || 'One Size';

      allColors.add(color);
      allSizes.add(size);

      if (!colorSizeMap.has(color)) {
        colorSizeMap.set(color, new Map());
      }

      const stockInfo = inventoryMap.get(variant.sku) || { total: 0, warehouses: {} };
      colorSizeMap.get(color).set(size, {
        variant,
        stock: stockInfo.total,
        warehouses: stockInfo.warehouses,
      });
    });

    const sizes = Array.from(allSizes);
    const colors = Array.from(allColors);

    let html = '';

    if (layout === 'expanded' && colors.length > 1 && sizes.length > 1) {
      // Full matrix layout for products with multiple colors and sizes
      html = renderExpandedMatrix(colors, sizes, colorSizeMap, showWarehouse);
    } else {
      // Compact list layout
      html = renderCompactList(variants, inventoryMap, showWarehouse);
    }

    // Summary section
    html += `
      <div class="ss-summary" id="ss-summary">
        <div class="ss-summary-item">
          <div class="ss-summary-value" id="ss-total-items">0</div>
          <div class="ss-summary-label">Total Items</div>
        </div>
        <div class="ss-summary-item">
          <div class="ss-summary-value" id="ss-total-variants">0</div>
          <div class="ss-summary-label">Variants</div>
        </div>
      </div>
    `;

    // Add to cart button
    html += `
      <button class="ss-add-to-cart-btn" id="ss-add-to-cart-btn" disabled>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
          <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
        </svg>
        ${buttonText}
      </button>
    `;

    container.innerHTML = html;

    // Attach event listeners
    attachEventListeners(container);
  }

  function renderExpandedMatrix(colors, sizes, colorSizeMap, showWarehouse) {
    let html = '<div style="overflow-x: auto;"><table class="ss-matrix-table">';

    // Header row with sizes
    html += '<thead><tr><th>Color / Size</th>';
    sizes.forEach(size => {
      html += `<th style="text-align: center;">${size}</th>`;
    });
    html += '</tr></thead><tbody>';

    // Rows for each color
    colors.forEach(color => {
      html += `<tr><td><strong>${color}</strong></td>`;

      sizes.forEach(size => {
        const data = colorSizeMap.get(color)?.get(size);

        if (data) {
          const stockBadgeClass = getStockClass(data.stock);
          html += `
            <td style="text-align: center;">
              <span class="ss-stock-badge ${stockBadgeClass}">${formatStock(data.stock)}</span>
              <br>
              <input
                type="number"
                class="ss-qty-input"
                min="0"
                max="${data.stock}"
                value=""
                placeholder="0"
                data-variant-id="${data.variant.id}"
                data-max-stock="${data.stock}"
                ${data.stock === 0 ? 'disabled' : ''}
              >
              ${showWarehouse ? renderWarehouseDetails(data.warehouses) : ''}
            </td>
          `;
        } else {
          html += '<td style="text-align: center; color: #999;">-</td>';
        }
      });

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  function renderCompactList(variants, inventoryMap, showWarehouse) {
    let html = '<table class="ss-matrix-table"><thead><tr>';
    html += '<th>Variant</th><th>Stock</th><th style="text-align: center;">Quantity</th>';
    html += '</tr></thead><tbody>';

    variants.forEach(variant => {
      const stockInfo = inventoryMap.get(variant.sku) || { total: 0, warehouses: {} };
      const stock = stockInfo.total;
      const stockBadgeClass = getStockClass(stock);

      html += `
        <tr>
          <td>
            <strong>${variant.title}</strong>
            ${variant.sku ? `<br><small style="color: #666;">SKU: ${variant.sku}</small>` : ''}
          </td>
          <td>
            <span class="ss-stock-badge ${stockBadgeClass}">${formatStock(stock)}</span>
            ${showWarehouse ? renderWarehouseDetails(stockInfo.warehouses) : ''}
          </td>
          <td style="text-align: center;">
            <input
              type="number"
              class="ss-qty-input"
              min="0"
              max="${stock}"
              value=""
              placeholder="0"
              data-variant-id="${variant.id}"
              data-max-stock="${stock}"
              ${stock === 0 ? 'disabled' : ''}
            >
          </td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    return html;
  }

  function renderWarehouseDetails(warehouses) {
    const entries = Object.entries(warehouses).filter(([_, qty]) => qty > 0);
    if (entries.length === 0) return '';

    const details = entries.map(([abbr, qty]) => `${abbr}: ${qty}`).join(', ');
    return `<div class="ss-warehouse-details">${details}</div>`;
  }

  function getStockClass(stock) {
    if (stock === 0) return 'ss-stock-none';
    if (stock < 50) return 'ss-stock-low';
    if (stock < 500) return 'ss-stock-medium';
    return 'ss-stock-high';
  }

  function formatStock(qty) {
    if (qty === 0) return 'Out of Stock';
    if (qty >= 1000) return `${(qty / 1000).toFixed(1)}K`;
    return qty.toString();
  }

  function attachEventListeners(container) {
    const inputs = container.querySelectorAll('.ss-qty-input');
    const addToCartBtn = container.querySelector('#ss-add-to-cart-btn');
    const totalItemsEl = container.querySelector('#ss-total-items');
    const totalVariantsEl = container.querySelector('#ss-total-variants');

    function updateSummary() {
      let totalItems = 0;
      let totalVariants = 0;

      inputs.forEach(input => {
        const qty = parseInt(input.value) || 0;
        if (qty > 0) {
          totalItems += qty;
          totalVariants++;
        }
      });

      totalItemsEl.textContent = totalItems;
      totalVariantsEl.textContent = totalVariants;
      addToCartBtn.disabled = totalItems === 0;
    }

    inputs.forEach(input => {
      input.addEventListener('input', function() {
        const max = parseInt(this.dataset.maxStock) || 0;
        let value = parseInt(this.value) || 0;

        if (value > max) {
          this.value = max;
        }
        if (value < 0) {
          this.value = 0;
        }

        updateSummary();
      });
    });

    addToCartBtn.addEventListener('click', async function() {
      const items = [];

      inputs.forEach(input => {
        const qty = parseInt(input.value) || 0;
        if (qty > 0) {
          items.push({
            id: input.dataset.variantId,
            quantity: qty
          });
        }
      });

      if (items.length === 0) return;

      addToCartBtn.disabled = true;
      addToCartBtn.innerHTML = '<span class="ss-loading-spinner" style="width:20px;height:20px;border-width:2px;"></span> Adding...';

      try {
        const response = await fetch(window.Shopify.routes.root + 'cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items })
        });

        if (response.ok) {
          showSuccessToast(`Added ${items.reduce((sum, i) => sum + i.quantity, 0)} items to cart!`);

          // Clear inputs
          inputs.forEach(input => {
            input.value = '';
          });
          updateSummary();

          // Redirect to cart after a short delay
          setTimeout(() => {
            window.location.href = '/cart';
          }, 1500);
        } else {
          throw new Error('Failed to add to cart');
        }
      } catch (error) {
        console.error('Add to cart error:', error);
        alert('Failed to add items to cart. Please try again.');
      } finally {
        addToCartBtn.disabled = false;
        addToCartBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
          ${addToCartBtn.closest('[data-button-text]')?.dataset.buttonText || 'Add Selected to Cart'}
        `;
      }
    });
  }

  function showSuccessToast(message) {
    const toast = document.createElement('div');
    toast.className = 'ss-success-toast';
    toast.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:8px;">
        <polyline points="20 6 9 17 4 12"/>
      </svg>
      ${message}
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.remove();
    }, 3000);
  }
})();
