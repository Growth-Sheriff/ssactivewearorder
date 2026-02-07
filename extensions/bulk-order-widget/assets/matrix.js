// SSActiveWear Variant Selection Widget v2.1
// Features: Multiple Upload Locations, Dynamic Icons, Matrix Qty, Cart Properties
(function() {
  document.addEventListener("DOMContentLoaded", initVariantWidgets);

  // State for multiple designs
  // Format: { 'front': { url: '...', thumb: '...', name: '...' }, 'back': ... }
  window.uploadedDesigns = {};

  function initVariantWidgets() {
    const widgets = document.querySelectorAll('[id^="ss-matrix-widget-"]');
    widgets.forEach(widget => initWidget(widget));
  }

  async function initWidget(container) {
    const blockId = container.id.replace('ss-matrix-widget-', '');
    const loadingEl = document.getElementById(`ss-loading-${blockId}`);
    const contentEl = document.getElementById(`ss-content-${blockId}`);
    const errorEl = document.getElementById(`ss-error-${blockId}`);

    const variants = JSON.parse(container.dataset.variants || '[]');
    const showWarehouse = container.dataset.showWarehouse === 'true';
    const buttonText = container.dataset.buttonText || 'Add Selected to Cart';
    const productId = container.dataset.productId || '';

    const skus = variants.map(v => v.sku).filter(s => s && s.trim());

    if (skus.length === 0) {
      container.style.display = 'none';
      return;
    }

    hideThemeFormElements();

    try {
      const inventoryData = await fetchInventory(skus);
      loadingEl.style.display = 'none';
      renderVariantSelector(variants, inventoryData, contentEl, { showWarehouse, buttonText });
      contentEl.style.display = 'block';
    } catch (error) {
      console.error("Widget Error:", error);
      loadingEl.style.display = 'none';
      errorEl.innerHTML = `<p>Unable to load inventory data.</p>`;
      errorEl.style.display = 'block';
    }
  }

  function hideThemeFormElements() {
    const selectorsToHide = [
      '.product-form__input', '.product-form__variant-selector', '.variant-selector',
      '[class*="variant-picker"]', '[class*="variant-select"]', '[data-variant-picker]',
      '.product-form__quantity', '.quantity-selector', '.quantity-wrapper',
      '[class*="quantity-input"]', '[data-quantity-input]',
      'product-form .shopify-payment-button', '.product-form__submit', '.product-form__buttons',
      '.product-form .btn--add-to-cart', 'form[action*="/cart/add"] button[type="submit"]',
      '.size-selector', '.color-selector', '[class*="option-selector"]', '[class*="swatch"]'
    ];

    selectorsToHide.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (!el.closest('.ss-bulk-order-widget')) { el.style.display = 'none'; }
        });
      } catch (e) {}
    });
  }

  async function fetchInventory(skus) {
    const response = await fetch("/apps/ssactiveorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `query GetInventory($skus: [String]!) { getInventory(skus: $skus) { sku warehouses { warehouseAbbr qty } } }`,
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
    const { buttonText } = options;
    const colorMap = new Map();
    const allSizes = new Set();

    variants.forEach(variant => {
      const color = variant.option1 || 'Default';
      const size = variant.option2 || 'One Size';
      const image = variant.featured_image?.src || variant.image || '';
      allSizes.add(size);

      if (!colorMap.has(color)) {
        colorMap.set(color, { name: color, image: image, sizes: new Map() });
      }

      const stockInfo = inventoryMap.get(variant.sku) || { total: 0, warehouses: {} };
      colorMap.get(color).sizes.set(size, {
        variant, stock: stockInfo.total,
        warehouses: stockInfo.warehouses,
        price: parseFloat(variant.price) / 100
      });
    });

    const colors = Array.from(colorMap.values());
    const sizes = Array.from(allSizes);
    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'XXS', 'XSM', 'SML', 'MED', 'LRG', 'XLG', '2X', '3X', '4X', '5X'];
    sizes.sort((a, b) => {
      const aIdx = sizeOrder.findIndex(s => a.toUpperCase().includes(s));
      const bIdx = sizeOrder.findIndex(s => b.toUpperCase().includes(s));
      if (aIdx === -1 && bIdx === -1) return a.localeCompare(b);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    let html = `
      <div class="ss-section">
        <div class="ss-section-title">Select Color</div>
        <div class="ss-color-grid">
          ${colors.map((color, index) => `
            <div class="ss-color-card ${index === 0 ? 'ss-color-selected' : ''}" data-color="${escapeHtml(color.name)}" tabindex="0">
              <div class="ss-color-image">${color.image ? `<img src="${color.image}" alt="${escapeHtml(color.name)}">` : `<div class="ss-no-image">No Image</div>`}</div>
              <div class="ss-color-name">${escapeHtml(color.name)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    colors.forEach((color, index) => {
      html += `
        <div class="ss-sizes-section ${index === 0 ? '' : 'ss-hidden'}" data-color-section="${escapeHtml(color.name)}">
          <div class="ss-section-title">Sizes</div>
          <div class="ss-sizes-grid">
            ${sizes.map(sizeName => {
              const sizeData = color.sizes.get(sizeName);
              if (!sizeData) return `<div class="ss-size-card ss-size-unavailable"><div class="ss-size-name">${escapeHtml(sizeName)}</div><div class="ss-size-stock">N/A</div></div>`;
              const isDisabled = sizeData.stock === 0;
              return `
                <div class="ss-size-card ${isDisabled ? 'ss-size-out' : ''}">
                  <input type="number" class="ss-size-input ${isDisabled ? 'ss-disabled' : ''}" min="0" max="${sizeData.stock}" placeholder="0"
                    data-variant-id="${sizeData.variant.id}" data-price="${sizeData.price}" ${isDisabled ? 'disabled' : ''}>
                  <div class="ss-size-name">${escapeHtml(sizeName)}</div>
                  <div class="ss-size-stock ${getStockClass(sizeData.stock)}">${formatStock(sizeData.stock)}</div>
                  ${sizeData.price > 0 ? `<div class="ss-size-price">$${sizeData.price.toFixed(2)}</div>` : ''}
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });

    html += `
      <div class="ss-order-summary">
        <div class="ss-summary-row"><span class="ss-summary-label">Items</span><span class="ss-summary-value" id="ss-total-items">0</span></div>
        <div class="ss-summary-row"><span class="ss-summary-label">Total</span><span class="ss-summary-value ss-total-price" id="ss-total-price">$0.00</span></div>
      </div>
      <button class="ss-add-to-cart-btn" id="ss-add-to-cart-btn" disabled>${buttonText}</button>
    `;

    container.innerHTML = html;
    attachEventListeners(container);
  }

  // GLOBAL UPLOAD HANDLERS
  window.handleFileUpload = async function(input, locationName, blockId) {
    const file = input.files[0];
    if (!file) return;

    if (file.size > 25 * 1024 * 1024) {
      showToast('File too large (Max 25MB)', 'error');
      return;
    }

    const placeholder = document.getElementById(`placeholder-${locationName}-${blockId}`);
    const preview = document.getElementById(`preview-${locationName}-${blockId}`);
    const thumbImg = preview.querySelector('img');
    const filenameEl = document.getElementById(`filename-${locationName}-${blockId}`);

    placeholder.innerHTML = '<div class="ss-btn-spinner"></div><p>Uploading...</p>';

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/apps/ssactiveorder/upload', { method: 'POST', body: formData });
      const result = await response.json();

      if (result.success && result.url) {
        window.uploadedDesigns[locationName] = {
          url: result.url,
          thumb: result.thumb || result.url,
          name: file.name
        };

        filenameEl.textContent = file.name;
        if (file.type.startsWith('image/')) thumbImg.src = result.url;
        placeholder.classList.add('ss-hidden');
        placeholder.style.display = 'none';
        preview.classList.remove('ss-hidden');
        preview.style.display = 'flex';
        showToast(`${locationName} design uploaded!`, 'success');
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      showToast('Upload failed', 'error');
      placeholder.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v4m4-10l4-4 4 4m-4-4v12"></path></svg><p>Retry upload</p>`;
    }
  };

  window.removeUpload = function(locationName, blockId) {
    delete window.uploadedDesigns[locationName];
    const placeholder = document.getElementById(`placeholder-${locationName}-${blockId}`);
    const preview = document.getElementById(`preview-${locationName}-${blockId}`);
    const fileInput = document.getElementById(`file-input-${locationName}-${blockId}`);

    placeholder.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v4m4-10l4-4 4 4m-4-4v12"></path></svg><p>Click to upload</p><span>SVG, PNG, JPG</span>`;
    placeholder.classList.remove('ss-hidden');
    placeholder.style.display = 'flex';
    preview.classList.add('ss-hidden');
    preview.style.display = 'none';
    fileInput.value = '';
  };

  function attachEventListeners(container) {
    const colorCards = container.querySelectorAll('.ss-color-card');
    const inputs = container.querySelectorAll('.ss-size-input');
    const addToCartBtn = container.querySelector('#ss-add-to-cart-btn');
    const totalItemsEl = container.querySelector('#ss-total-items');
    const totalPriceEl = container.querySelector('#ss-total-price');

    colorCards.forEach(card => {
      card.addEventListener('click', function() {
        const selectedColor = this.dataset.color;
        colorCards.forEach(c => c.classList.remove('ss-color-selected'));
        this.classList.add('ss-color-selected');
        container.querySelectorAll('.ss-sizes-section').forEach(s => s.classList.add('ss-hidden'));
        container.querySelector(`[data-color-section="${selectedColor}"]`)?.classList.remove('ss-hidden');
      });
    });

    function updateSummary() {
      let totalItems = 0, totalPrice = 0;
      inputs.forEach(input => {
        const qty = parseInt(input.value) || 0;
        if (qty > 0) {
          totalItems += qty;
          totalPrice += qty * (parseFloat(input.dataset.price) || 0);
        }
      });
      totalItemsEl.textContent = totalItems;
      totalPriceEl.textContent = `$${totalPrice.toFixed(2)}`;
      addToCartBtn.disabled = totalItems === 0;
    }

    inputs.forEach(input => {
      input.addEventListener('input', updateSummary);
    });

    addToCartBtn.addEventListener('click', async function() {
      const items = [];
      inputs.forEach(input => {
        const qty = parseInt(input.value) || 0;
        if (qty > 0) {
          const item = { id: input.dataset.variantId, quantity: qty, properties: {} };

          // ADD ALL DESIGNS AS PROPERTIES
          Object.keys(window.uploadedDesigns).forEach(loc => {
            const d = window.uploadedDesigns[loc];
            const label = loc.charAt(0).toUpperCase() + loc.slice(1);
            item.properties[`${label} Design`] = d.url;
            item.properties[`_${loc}_preview`] = d.thumb;
          });

          items.push(item);
        }
      });

      addToCartBtn.disabled = true;
      addToCartBtn.textContent = 'Adding...';

      try {
        const res = await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items })
        });
        if (res.ok) {
          showToast('Added to cart!', 'success');
          setTimeout(() => window.location.href = '/cart', 1000);
        } else { throw new Error(); }
      } catch (e) {
        showToast('Error adding to cart', 'error');
        addToCartBtn.disabled = false;
        addToCartBtn.textContent = 'Add Selected to Cart';
      }
    });
  }

  function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }
  function getStockClass(s) { return s === 0 ? 'ss-stock-out' : (s < 50 ? 'ss-stock-low' : (s < 500 ? 'ss-stock-medium' : 'ss-stock-high')); }
  function formatStock(q) { return q === 0 ? 'Out' : (q >= 1000 ? `${(q / 1000).toFixed(1)}K` : q.toString()); }
  function showToast(m, t) {
    const el = document.createElement('div');
    el.className = `ss-toast ss-toast-${t}`;
    el.textContent = m;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }
})();
