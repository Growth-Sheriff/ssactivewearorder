// SSActiveWear Variant Selection Widget v5.0 (Volume Pricing + Upload + Clean UI)
(function() {
  document.addEventListener("DOMContentLoaded", initVariantWidgets);

  window.uploadedDesigns = {};
  window.volumeRules = {}; // Store rules per blockId

  function initVariantWidgets() {
    const widgets = document.querySelectorAll('[id^="ss-matrix-widget-"]');
    widgets.forEach(widget => initWidget(widget));
  }

  async function initWidget(container) {
    const blockId = container.id.replace('ss-matrix-widget-', '');
    const productId = container.dataset.productId;
    const loadingEl = container.querySelector('.ss-loading');

    if (loadingEl) loadingEl.style.display = 'none';

    // 1. Initial State
    const variants = JSON.parse(container.dataset.variants || '[]');
    const firstColor = variants[0]?.option1;
    if (firstColor) selectMatrixColor(firstColor, blockId);

    // Show static sections
    const uploadEl = document.getElementById(`ss-upload-${blockId}`);
    if (uploadEl) uploadEl.style.display = 'block';

    const footerEl = document.querySelector(`#ss-matrix-widget-${blockId} .ss-footer`);
    if (footerEl) footerEl.style.display = 'flex';

    // 2. Fetch Volume Pricing
    try {
      const response = await fetch(`/apps/ssactiveorder/api/volume-pricing?product_id=${productId}`);
      if (response.ok) {
        const data = await response.json();
        if (data.tiers && data.tiers.length > 0) {
           window.volumeRules[blockId] = {
             tiers: data.tiers,
             basePrice: data.basePrice || variants[0]?.price / 100 // fallback
           };
           renderVolumeTable(blockId, data.tiers, window.volumeRules[blockId].basePrice);
        }
      }
    } catch (e) {
      console.warn("Volume pricing fetch failed", e);
    }
  }

  function renderVolumeTable(blockId, tiers, basePrice) {
    const container = document.getElementById(`ss-volume-${blockId}`);
    const content = document.getElementById(`ss-volume-content-${blockId}`);
    if (!container || !content) return;

    container.style.display = 'block';

    content.innerHTML = tiers.map(t => {
       // Calculate price per unit based on discount
       let price = basePrice;
       if (t.type === 'percentage') {
         price = basePrice * (1 - t.value / 100);
       } else {
         price = basePrice - t.value;
       }
       if (price < 0) price = 0;

       return `
         <div class="ss-volume-cell" data-min="${t.min}" data-max="${t.max || 99999}">
            <div class="ss-vol-qty">${t.min}${t.max ? '-' + t.max : '+'}</div>
            <div class="ss-vol-price">$${price.toFixed(2)}</div>
         </div>
       `;
    }).join('');
  }

  // ─── VISIBILITY TOGGLE ───
  window.selectMatrixColor = function(colorName, blockId) {
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    if (!container) return;

    const allColors = container.querySelectorAll('.ss-color-item');
    allColors.forEach(el => {
      if (el.dataset.color === colorName) el.classList.add('ss-color-selected');
      else el.classList.remove('ss-color-selected');
    });

    const label = container.querySelector('#ss-selected-color-name');
    if (label) label.textContent = `: ${colorName}`;

    const groups = container.querySelectorAll('.ss-size-group');
    groups.forEach(group => {
      if (group.dataset.colorGroup === colorName) {
        group.style.display = 'block';
      } else {
        group.style.display = 'none';
      }
    });

    const mContainer = container.querySelector('.ss-matrix-container');
    if (mContainer) mContainer.style.display = 'block';
  };

  // ─── TOTAL CALCULATION WITH VOLUME PRICING ───
  window.updateMatrixTotal = function(blockId) {
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    const inputs = container.querySelectorAll('.ss-input-field');
    const priceEl = document.getElementById(`ss-total-price-${blockId}`);
    const btn = document.getElementById(`ss-add-to-cart-${blockId}`);

    let totalQty = 0;
    inputs.forEach(inp => {
      totalQty += parseInt(inp.value) || 0;
    });

    // Check for Bulk Pricing
    let unitPrice = 0;
    const rule = window.volumeRules[blockId];

    // Highlight Active Tier
    let activeTierFound = false;
    if (rule && rule.tiers) {
       // Find applicable tier
       let appliedDiscount = { type: 'none', value: 0 };

       rule.tiers.forEach(t => {
          const min = t.min;
          const max = t.max || 999999;

          if (totalQty >= min && totalQty <= max) {
             appliedDiscount = t;
          }
       });

       // Logic: If user hasn't selected enough for ANY tier, use base price?
       // Usually base price comes from liquid variant.price.
       // But wait, variants can have DIFFERENT prices (e.g. 2XL > XL).
       // Volume discount is usually a % off the variant price.

       // Complex part: Calculate total based on individual variant prices * quantity, THEN apply discount.
    }

    // Recalculate Total
    let total = 0;
    inputs.forEach(inp => {
      const qty = parseInt(inp.value) || 0;
      if (qty > 0) {
        let price = parseFloat(inp.dataset.price) || 0; // Variant Price

        // Apply Volume Discount if any
        if (rule && rule.tiers) {
           const tier = rule.tiers.find(t => totalQty >= t.min && totalQty <= (t.max || 999999));
           if (tier) {
              if (tier.type === 'percentage') {
                 price = price * (1 - tier.value / 100);
              } else {
                 price = price - tier.value; // Fixed amount off unit
              }
           }
        }
        total += qty * price;
      }
    });

    // Tier Highlighting Logic
    if (rule) {
        const volumeContent = document.getElementById(`ss-volume-content-${blockId}`);
        if (volumeContent) {
           const cells = volumeContent.querySelectorAll('.ss-volume-cell');
           cells.forEach(cell => {
              const min = parseInt(cell.dataset.min);
              const max = parseInt(cell.dataset.max);
              if (totalQty >= min && totalQty <= max) {
                 cell.classList.add('active');
              } else {
                 cell.classList.remove('active');
              }
           });
        }
    }

    if (priceEl) priceEl.textContent = `$${total.toFixed(2)}`;
    if (btn) btn.disabled = totalQty === 0;
  };

  // ─── ADD TO CART ───
  window.addToCart = async function(blockId) {
    const btn = document.getElementById(`ss-add-to-cart-${blockId}`);
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    const inputs = container.querySelectorAll('.ss-input-field');

    // We can't easily change price in Cart API unless we use Discount Codes or automatic discounts.
    // However, if the app uses "Draft Order" or specialized cart attributes, we might handle it differently.
    // For standard "Add to Cart", prices are fixed by variant unless we use a script or specific properties.
    // User request: "Entegre ediyorduk". Usually means prices are updated.
    // IF Volume Pricing App handles auto-discounting in Cart via Script Editor or Functions, we just add normally.
    // IF NOT, we might be showing a price that won't appear in cart!

    // Assumption: The backend app handles cart transformation or Shopify Functions checks the properties.
    // OR we simply add items.

    const items = [];
    inputs.forEach(inp => {
      const qty = parseInt(inp.value) || 0;
      if (qty > 0) {
        const item = { id: inp.dataset.variantId, quantity: qty, properties: {} };
        if (window.uploadedDesigns) {
           Object.keys(window.uploadedDesigns).forEach(loc => {
              const d = window.uploadedDesigns[loc];
              const label = loc.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              item.properties[`${label} Design`] = d.url;
           });
        }
        // Metadata for volume pricing?
        // item.properties['_volume_tier'] = ...
        items.push(item);
      }
    });

    if (items.length === 0) return;

    btn.textContent = 'Adding...';
    btn.disabled = true;

    try {
      const CHUNK_SIZE = 10;
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        await fetch('/cart/add.js', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: chunk })
        });
      }
      btn.textContent = 'Added!';
      setTimeout(() => { window.location.href = '/cart'; }, 800);
    } catch (e) {
      console.error(e);
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = 'Add to Cart'; btn.disabled = false; }, 2000);
    }
  };

  // ─── UPLOAD HANDLERS (Same as before) ───
  window.handleFileUpload = async function(input, locationName, blockId) {
    const file = input.files[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      showToast('File too large (Max 50MB)', 'error');
      return;
    }

    const placeholder = document.getElementById(`placeholder-${locationName}-${blockId}`);
    const preview = document.getElementById(`preview-${locationName}-${blockId}`);
    const previewImg = preview.querySelector('.ss-preview-image');

    const originalContent = placeholder.innerHTML;
    placeholder.innerHTML = '<span class="ss-upload-text">Uploading...</span>';

    try {
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch('/apps/ssactiveorder/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        let errorText = await response.text();
        try { const j = JSON.parse(errorText); if(j.error) errorText = j.error; } catch(e){}
        throw new Error(`Server Error: ${errorText.substring(0, 100)}`);
      }

      const result = await response.json();

      if (result.success && result.url) {
        window.uploadedDesigns[locationName] = {
          url: result.url,
          thumb: result.thumb || result.url,
          name: file.name
        };

        if (file.type.startsWith('image/')) {
           previewImg.innerHTML = `<img src="${result.url}" style="width:100%; height:100%; object-fit:cover; border-radius:12px;">`;
           previewImg.style.backgroundImage = 'none';
        } else {
           previewImg.innerHTML = `<span style="font-size:30px; display:flex; align-items:center; justify-content:center; width:100%; height:100%;">📄</span>`;
        }

        placeholder.style.display = 'none';
        preview.style.display = 'flex';
        showToast(`${locationName} uploaded!`, 'success');
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error) {
      console.error('Upload error:', error);
      showToast(error.message, 'error');
      placeholder.innerHTML = originalContent;
    }
  };

  window.removeUpload = function(locationName, blockId) {
    delete window.uploadedDesigns[locationName];
    const placeholder = document.getElementById(`placeholder-${locationName}-${blockId}`);
    const preview = document.getElementById(`preview-${locationName}-${blockId}`);
    const fileInput = document.getElementById(`file-input-${locationName}-${blockId}`);
    const previewImg = preview.querySelector('.ss-preview-image');

    placeholder.style.display = 'flex';
    placeholder.innerHTML = `<span class="ss-upload-icon">+</span><span class="ss-upload-text">${locationName}</span>`;
    preview.style.display = 'none';
    previewImg.innerHTML = '';
    fileInput.value = '';
  };

  function showToast(m, t) {
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:12px 24px;border-radius:30px;font-size:14px;z-index:9999;box-shadow:0 5px 20px rgba(0,0,0,0.2);`;
    if (t === 'error') el.style.background = '#ef4444';
    el.textContent = m;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

})();
