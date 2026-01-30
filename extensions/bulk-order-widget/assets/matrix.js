// SSActiveWear Variant Selection Widget v2
// Features: Color selection, size quantities, design upload, product import check, theme form hiding
(function() {
  document.addEventListener("DOMContentLoaded", initVariantWidgets);

  // State for uploaded design
  let uploadedDesignUrl = null;
  let uploadedDesignThumb = null;

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

    // First, check if this product was imported from SSActiveWear
    if (productId) {
      try {
        const importStatus = await checkProductImported(productId);
        if (!importStatus.imported) {
          // Product not imported - hide widget completely
          container.style.display = 'none';
          return;
        }
      } catch (error) {
        console.log("Import check failed, showing widget anyway");
      }
    }

    const skus = variants.map(v => v.sku).filter(s => s && s.trim());

    if (skus.length === 0) {
      // No SKUs - hide widget
      container.style.display = 'none';
      return;
    }

    // Hide theme's default product form elements
    hideThemeFormElements();

    // Fetch Inventory from App Proxy
    try {
      const inventoryData = await fetchInventory(skus);
      loadingEl.style.display = 'none';
      renderVariantSelector(variants, inventoryData, contentEl, { showWarehouse, buttonText });
      contentEl.style.display = 'block';
    } catch (error) {
      console.error("Widget Error:", error);
      loadingEl.style.display = 'none';
      errorEl.innerHTML = `<p>Unable to load inventory data. Please refresh the page.</p>`;
      errorEl.style.display = 'block';
    }
  }

  // Check if product was imported from SSActiveWear
  async function checkProductImported(productId) {
    const response = await fetch("/apps/ssactiveorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `
          query IsProductImported($shopifyProductId: String!) {
            isProductImported(shopifyProductId: $shopifyProductId) {
              imported
              ssStyleId
            }
          }
        `,
        variables: { shopifyProductId: productId }
      })
    });

    const json = await response.json();
    return json.data?.isProductImported || { imported: false };
  }

  // Hide theme's default product form elements
  function hideThemeFormElements() {
    // Common selectors for theme product forms
    const selectorsToHide = [
      // Variant selectors
      '.product-form__input',
      '.product-form__variant-selector',
      '.variant-selector',
      '[class*="variant-picker"]',
      '[class*="variant-select"]',
      '[data-variant-picker]',
      // Quantity inputs
      '.product-form__quantity',
      '.quantity-selector',
      '.quantity-wrapper',
      '[class*="quantity-input"]',
      '[data-quantity-input]',
      // Add to cart buttons (main form)
      'product-form .shopify-payment-button',
      '.product-form__submit',
      '.product-form__buttons',
      '.product-form .btn--add-to-cart',
      'form[action*="/cart/add"] button[type="submit"]',
      // Size and color selectors
      '.size-selector',
      '.color-selector',
      '[class*="option-selector"]',
      '[class*="swatch"]'
    ];

    selectorsToHide.forEach(selector => {
      try {
        const elements = document.querySelectorAll(selector);
        elements.forEach(el => {
          if (!el.closest('.ss-bulk-order-widget')) {
            el.style.display = 'none';
          }
        });
      } catch (e) {}
    });

    // Also try to hide the entire product form but keep product info
    const productForms = document.querySelectorAll('form[action*="/cart/add"]');
    productForms.forEach(form => {
      if (!form.closest('.ss-bulk-order-widget')) {
        // Hide form children but not the whole form (might break things)
        const formInputs = form.querySelectorAll('input, select, button');
        formInputs.forEach(input => {
          if (input.type !== 'hidden') {
            input.style.display = 'none';
          }
        });
      }
    });
  }

  async function fetchInventory(skus) {
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
        price: parseFloat(variant.price) / 100
      });

      if (image && !colorMap.get(color).image) {
        colorMap.get(color).image = image;
      }
    });

    const colors = Array.from(colorMap.values());
    const sizes = Array.from(allSizes);

    // Sort sizes
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

    // Color variant selector
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

    // Size sections per color
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

    // Design Upload Section
    html += `
      <div class="ss-section ss-upload-section">
        <div class="ss-section-title">Upload Your Design (Optional)</div>
        <div class="ss-upload-area" id="ss-upload-area">
          <input type="file" id="ss-design-input" accept="image/*,.pdf,.ai,.eps" style="display:none">
          <div class="ss-upload-placeholder" id="ss-upload-placeholder">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p>Click or drag to upload design</p>
            <span>PNG, JPG, PDF, AI, EPS (Max 25MB)</span>
          </div>
          <div class="ss-upload-preview" id="ss-upload-preview" style="display:none">
            <img id="ss-design-thumb" src="" alt="Design Preview">
            <div class="ss-upload-info">
              <span id="ss-design-name">design.png</span>
              <button type="button" class="ss-remove-design" id="ss-remove-design">✕ Remove</button>
            </div>
          </div>
        </div>
      </div>
    `;

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
    attachUploadListeners(container);
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

  function attachUploadListeners(container) {
    const uploadArea = container.querySelector('#ss-upload-area');
    const fileInput = container.querySelector('#ss-design-input');
    const placeholder = container.querySelector('#ss-upload-placeholder');
    const preview = container.querySelector('#ss-upload-preview');
    const thumb = container.querySelector('#ss-design-thumb');
    const nameEl = container.querySelector('#ss-design-name');
    const removeBtn = container.querySelector('#ss-remove-design');

    // Click to upload
    uploadArea.addEventListener('click', (e) => {
      if (e.target === removeBtn || e.target.closest('.ss-remove-design')) return;
      fileInput.click();
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
      e.preventDefault();
      uploadArea.classList.add('ss-upload-dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
      uploadArea.classList.remove('ss-upload-dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
      e.preventDefault();
      uploadArea.classList.remove('ss-upload-dragover');
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        handleFileUpload(files[0], placeholder, preview, thumb, nameEl);
      }
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFileUpload(files[0], placeholder, preview, thumb, nameEl);
      }
    });

    // Remove design
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      uploadedDesignUrl = null;
      uploadedDesignThumb = null;
      placeholder.style.display = 'flex';
      preview.style.display = 'none';
      fileInput.value = '';
    });
  }

  async function handleFileUpload(file, placeholder, preview, thumb, nameEl) {
    if (file.size > 25 * 1024 * 1024) {
      showErrorToast('File too large. Max 25MB allowed.');
      return;
    }

    placeholder.innerHTML = '<div class="ss-btn-spinner"></div><p>Uploading...</p>';

    // Create thumbnail preview immediately for images
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        uploadedDesignThumb = e.target.result;
        thumb.src = uploadedDesignThumb;
      };
      reader.readAsDataURL(file);
    } else {
      // For non-image files, show a placeholder
      thumb.src = 'data:image/svg+xml,' + encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 24 24" fill="none" stroke="#999" stroke-width="2">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13,2 13,9 20,9"/>
        </svg>
      `);
    }

    try {
      // Upload to server
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/apps/ssactiveorder/upload', {
        method: 'POST',
        body: formData
      });

      const result = await response.json();

      if (result.success && result.url) {
        uploadedDesignUrl = result.url;
        nameEl.textContent = file.name;
        placeholder.style.display = 'none';
        preview.style.display = 'flex';
        showSuccessToast('Design uploaded!');
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      // Still show preview with local thumbnail
      nameEl.textContent = file.name + ' (local only)';
      placeholder.style.display = 'none';
      preview.style.display = 'flex';
      showErrorToast('Upload failed. Design saved locally.');
    }
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
        colorCards.forEach(c => c.classList.remove('ss-color-selected'));
        this.classList.add('ss-color-selected');

        container.querySelectorAll('.ss-sizes-section').forEach(section => {
          section.classList.add('ss-hidden');
        });
        const targetSection = container.querySelector(`[data-color-section="${selectedColor}"]`);
        if (targetSection) targetSection.classList.remove('ss-hidden');
      });

      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.click();
        }
      });
    });

    // Quantity inputs
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
        if (value > max) this.value = max;
        if (value < 0) this.value = 0;
        updateSummary();
      });

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
          const itemData = {
            id: input.dataset.variantId,
            quantity: qty
          };

          // Add design as line item property if uploaded
          if (uploadedDesignUrl) {
            itemData.properties = {
              'Design': uploadedDesignUrl,
              '_design_preview': uploadedDesignThumb || uploadedDesignUrl
            };
          }

          items.push(itemData);
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

          inputs.forEach(input => { input.value = ''; });
          updateSummary();

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

  function showSuccessToast(message) { showToast(message, 'success'); }
  function showErrorToast(message) { showToast(message, 'error'); }

  function showToast(message, type) {
    const existing = document.querySelector('.ss-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `ss-toast ss-toast-${type}`;
    toast.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        ${type === 'success' ? '<polyline points="20 6 9 17 4 12"/>' : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
      </svg>
      ${message}
    `;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }
})();
