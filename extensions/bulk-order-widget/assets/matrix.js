// SSActiveWear Variant Selection Widget
// Redesigned: Color variant images + Size-based quantity inputs
(function() {
  document.addEventListener("DOMContentLoaded", initVariantWidgets);

  function initVariantWidgets() {
    const widgets = document.querySelectorAll('[id^="ss-matrix-widget-"]');
    widgets.forEach(widget => initWidget(widget));
  }

  function initWidget(container) {
    const blockId = container.id.replace('ss-matrix-widget-', '');
    const loadingEl = document.getElementById(`ss-loading-${blockId}`);
    const contentEl = document.getElementById(`ss-content-${blockId}`);
    const errorEl = document.getElementById(`ss-error-${blockId}`);

    const variants = JSON.parse(container.dataset.variants || '[]');
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
        renderVariantSelector(variants, inventoryData, contentEl, { showWarehouse, buttonText });
        contentEl.style.display = 'block';
      })
      .catch(error => {
        console.error("Widget Error:", error);
        loadingEl.style.display = 'none';
        errorEl.innerHTML = `<p>Unable to load inventory data. Please refresh the page.</p>`;
        errorEl.style.display = 'block';
      });
  }

  async function fetchInventory(skus) {
    // App Proxy endpoint - configured in shopify.app.toml
    const response = await fetch("/apps/ssactiveorder", {
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

  function renderVariantSelector(variants, inventoryMap, container, options) {
    const { showWarehouse, buttonText } = options;

    // Group variants by color (option1) and collect sizes (option2)
    const colorMap = new Map();
    const allSizes = new Set();

    variants.forEach(variant => {
      const color = variant.option1 || 'Default';
      const size = variant.option2 || 'One Size';
      const image = variant.featured_image?.src || variant.image || '';

      allSizes.add(size);

      if (!colorMap.has(color)) {
        colorMap.set(color, {
          name: color,
          image: image,
          sizes: new Map()
        });
      }

      const stockInfo = inventoryMap.get(variant.sku) || { total: 0, warehouses: {} };
      colorMap.get(color).sizes.set(size, {
        variant,
        stock: stockInfo.total,
        warehouses: stockInfo.warehouses,
        price: parseFloat(variant.price) / 100 // Shopify prices are in cents
      });

      // Update color image if we have one
      if (image && !colorMap.get(color).image) {
        colorMap.get(color).image = image;
      }
    });

    const colors = Array.from(colorMap.values());
    const sizes = Array.from(allSizes);

    // Sort sizes by common order
    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'XXS', 'XSM', 'SML', 'MED', 'LRG', 'XLG', '2X', '3X', '4X', '5X'];
    sizes.sort((a, b) => {
      const aIdx = sizeOrder.findIndex(s => a.toUpperCase().includes(s));
      const bIdx = sizeOrder.findIndex(s => b.toUpperCase().includes(s));
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    let html = '';

    // Color variant selector - visual grid
    html += `
      <div class="ss-section">
        <div class="ss-section-title">Select Color</div>
        <div class="ss-color-grid">
    `;

    colors.forEach((color, index) => {
      const isFirst = index === 0;
      html += `
        <div class="ss-color-card ${isFirst ? 'ss-color-selected' : ''}"
             data-color="${escapeHtml(color.name)}"
             tabindex="0">
          <div class="ss-color-image">
            ${color.image
              ? `<img src="${color.image}" alt="${escapeHtml(color.name)}" loading="lazy">`
              : `<div class="ss-no-image">No Image</div>`
            }
          </div>
          <div class="ss-color-name">${escapeHtml(color.name)}</div>
        </div>
      `;
    });

    html += `
        </div>
      </div>
    `;

    // Size quantity inputs - one section per color (hidden by default except first)
    colors.forEach((color, index) => {
      const isFirst = index === 0;
      html += `
        <div class="ss-sizes-section ${isFirst ? '' : 'ss-hidden'}" data-color-section="${escapeHtml(color.name)}">
          <div class="ss-section-title">Sizes</div>
          <div class="ss-sizes-grid">
      `;

      sizes.forEach(sizeName => {
        const sizeData = color.sizes.get(sizeName);
        if (!sizeData) {
          html += `
            <div class="ss-size-card ss-size-unavailable">
              <div class="ss-size-name">${escapeHtml(sizeName)}</div>
              <div class="ss-size-stock">N/A</div>
            </div>
          `;
          return;
        }

        const stockClass = getStockClass(sizeData.stock);
        const isDisabled = sizeData.stock === 0;

        html += `
          <div class="ss-size-card ${isDisabled ? 'ss-size-out' : ''}">
            <input type="number"
                   class="ss-size-input ${isDisabled ? 'ss-disabled' : ''}"
                   min="0"
                   max="${sizeData.stock}"
                   value=""
                   placeholder="0"
                   data-variant-id="${sizeData.variant.id}"
                   data-color="${escapeHtml(color.name)}"
                   data-size="${escapeHtml(sizeName)}"
                   data-max-stock="${sizeData.stock}"
                   data-price="${sizeData.price}"
                   ${isDisabled ? 'disabled' : ''}>
            <div class="ss-size-name">${escapeHtml(sizeName)}</div>
            <div class="ss-size-stock ${stockClass}">${formatStock(sizeData.stock)}</div>
            ${sizeData.price > 0 ? `<div class="ss-size-price">$${sizeData.price.toFixed(2)}</div>` : ''}
            ${showWarehouse ? renderWarehouseDetails(sizeData.warehouses) : ''}
          </div>
        `;
      });

      html += `
          </div>
        </div>
      `;
    });

    // Summary and add to cart
    html += `
      <div class="ss-order-summary">
        <div class="ss-summary-row">
          <span class="ss-summary-label">Selected Items</span>
          <span class="ss-summary-value" id="ss-total-items">0</span>
        </div>
        <div class="ss-summary-row">
          <span class="ss-summary-label">Estimated Total</span>
          <span class="ss-summary-value ss-total-price" id="ss-total-price">$0.00</span>
        </div>
      </div>

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

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function renderWarehouseDetails(warehouses) {
    const entries = Object.entries(warehouses).filter(([_, qty]) => qty > 0);
    if (entries.length === 0) return '';

    const details = entries.slice(0, 3).map(([abbr, qty]) => `${abbr}: ${qty}`).join(', ');
    return `<div class="ss-warehouse-details">${details}</div>`;
  }

  function getStockClass(stock) {
    if (stock === 0) return 'ss-stock-out';
    if (stock < 50) return 'ss-stock-low';
    if (stock < 500) return 'ss-stock-medium';
    return 'ss-stock-high';
  }

  function formatStock(qty) {
    if (qty === 0) return 'Out';
    if (qty >= 1000) return `${(qty / 1000).toFixed(1)}K`;
    return qty.toString();
  }

  function attachEventListeners(container) {
    const colorCards = container.querySelectorAll('.ss-color-card');
    const inputs = container.querySelectorAll('.ss-size-input');
    const addToCartBtn = container.querySelector('#ss-add-to-cart-btn');
    const totalItemsEl = container.querySelector('#ss-total-items');
    const totalPriceEl = container.querySelector('#ss-total-price');

    // Color selection
    colorCards.forEach(card => {
      card.addEventListener('click', function() {
        const selectedColor = this.dataset.color;

        // Update card selection
        colorCards.forEach(c => c.classList.remove('ss-color-selected'));
        this.classList.add('ss-color-selected');

        // Show corresponding size section
        container.querySelectorAll('.ss-sizes-section').forEach(section => {
          section.classList.add('ss-hidden');
        });
        const targetSection = container.querySelector(`[data-color-section="${selectedColor}"]`);
        if (targetSection) targetSection.classList.remove('ss-hidden');
      });

      // Keyboard accessibility
      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.click();
        }
      });
    });

    // Quantity input handlers
    function updateSummary() {
      let totalItems = 0;
      let totalPrice = 0;

      inputs.forEach(input => {
        const qty = parseInt(input.value) || 0;
        const price = parseFloat(input.dataset.price) || 0;
        if (qty > 0) {
          totalItems += qty;
          totalPrice += qty * price;
        }
      });

      totalItemsEl.textContent = totalItems;
      totalPriceEl.textContent = `$${totalPrice.toFixed(2)}`;
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

      // Clear placeholder on focus
      input.addEventListener('focus', function() {
        if (this.value === '0' || this.value === '') {
          this.value = '';
        }
      });
    });

    // Add to cart
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
      addToCartBtn.innerHTML = '<span class="ss-btn-spinner"></span> Adding...';

      try {
        const response = await fetch(window.Shopify.routes.root + 'cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items })
        });

        if (response.ok) {
          const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
          showSuccessToast(`Added ${totalQty} items to cart!`);

          // Clear inputs
          inputs.forEach(input => {
            input.value = '';
          });
          updateSummary();

          // Redirect to cart
          setTimeout(() => {
            window.location.href = '/cart';
          }, 1500);
        } else {
          throw new Error('Failed to add to cart');
        }
      } catch (error) {
        console.error('Add to cart error:', error);
        showErrorToast('Failed to add items. Please try again.');
      } finally {
        addToCartBtn.disabled = false;
        addToCartBtn.innerHTML = `
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
          </svg>
          Add Selected to Cart
        `;
        updateSummary();
      }
    });
  }

  function showSuccessToast(message) {
    showToast(message, 'success');
  }

  function showErrorToast(message) {
    showToast(message, 'error');
  }

  function showToast(message, type) {
    const existing = document.querySelector('.ss-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `ss-toast ss-toast-${type}`;
    toast.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${type === 'success'
          ? '<polyline points="20 6 9 17 4 12"/>'
          : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
        }
      </svg>
      ${message}
    `;
    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }
})();
