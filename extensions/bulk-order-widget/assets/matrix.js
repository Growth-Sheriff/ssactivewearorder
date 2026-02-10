// SSActiveWear Variant Selection Widget v4.1 (Static Liquid + JS Toggle + Upload Fix)
// Features: Clean UI, Static Rendering for Speed, Visibility Toggling, Reliable Uploads

(function() {
  document.addEventListener("DOMContentLoaded", initVariantWidgets);

  // State for multiple designs
  window.uploadedDesigns = {};

  function initVariantWidgets() {
    const widgets = document.querySelectorAll('[id^="ss-matrix-widget-"]');
    widgets.forEach(widget => initWidget(widget));
  }

  async function initWidget(container) {
    const blockId = container.id.replace('ss-matrix-widget-', '');
    const loadingEl = container.querySelector('.ss-loading');

    if (loadingEl) loadingEl.style.display = 'none';

    const variants = JSON.parse(container.dataset.variants || '[]');

    // Initial State: Select first color
    const firstColor = variants[0]?.option1;
    if (firstColor) {
      selectMatrixColor(firstColor, blockId);
    }

    // Show sections that might be hidden by default css if any
    const uploadEl = document.getElementById(`ss-upload-${blockId}`);
    if (uploadEl) uploadEl.style.display = 'block';

    const footerEl = document.querySelector(`#ss-matrix-widget-${blockId} .ss-footer`);
    if (footerEl) footerEl.style.display = 'flex';

    // Volume Pricing (if present)
    const volumeEl = document.getElementById(`ss-volume-${blockId}`);
    if (volumeEl) {
       volumeEl.style.display = 'block';
    }
  }

  // ─── VISIBILITY TOGGLE (Core Logic) ───
  window.selectMatrixColor = function(colorName, blockId) {
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    if (!container) return;

    // 1. Highlight Color Circle
    const allColors = container.querySelectorAll('.ss-color-item');
    allColors.forEach(el => {
      if (el.dataset.color === colorName) el.classList.add('ss-color-selected');
      else el.classList.remove('ss-color-selected');
    });

    // Update Label
    const label = container.querySelector('#ss-selected-color-name');
    if (label) label.textContent = `: ${colorName}`;

    // 2. Toggle Size Groups Visibility
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

  // ─── TOTAL CALCULATION ───
  window.updateMatrixTotal = function(blockId) {
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    const inputs = container.querySelectorAll('.ss-input-field');
    const priceEl = document.getElementById(`ss-total-price-${blockId}`);
    const btn = document.getElementById(`ss-add-to-cart-${blockId}`);

    let count = 0;
    let total = 0;

    inputs.forEach(inp => {
      const val = parseInt(inp.value) || 0;
      if (val > 0) {
        count += val;
        // Price might be in dataset
        const price = parseFloat(inp.dataset.price) || 0;
        total += val * price;
      }
    });

    if (priceEl) priceEl.textContent = `$${total.toFixed(2)}`;
    if (btn) btn.disabled = count === 0;
  };

  // ─── ADD TO CART ───
  window.addToCart = async function(blockId) {
    const btn = document.getElementById(`ss-add-to-cart-${blockId}`);
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    const inputs = container.querySelectorAll('.ss-input-field');

    const items = [];
    inputs.forEach(inp => {
      const qty = parseInt(inp.value) || 0;
      if (qty > 0) {
        const item = { id: inp.dataset.variantId, quantity: qty, properties: {} };

        // Attach Uploads if any
        if (window.uploadedDesigns) {
           Object.keys(window.uploadedDesigns).forEach(loc => {
              const d = window.uploadedDesigns[loc];
              const label = loc.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              item.properties[`${label} Design`] = d.url;
           });
        }
        items.push(item);
      }
    });

    if (items.length === 0) return;

    btn.textContent = 'Adding...';
    btn.disabled = true;

    try {
      // Chunking for safety
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
      setTimeout(() => {
        btn.textContent = 'Add to Cart';
        btn.disabled = false;
      }, 2000);
    }
  };

  // ─── UPLOAD HANDLERS ───
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

      // Use /api/upload endpoint via App Proxy
      // If 500 persists, user should check proxy settings or server logs.
      // Trying '/apps/ssactiveorder/api/upload' assuming simple proxy forwarding.
      const response = await fetch('/apps/ssactiveorder/api/upload', {
        method: 'POST',
        body: formData
      });

      // Check if response is okay
      if (!response.ok) {
        let errorText = await response.text();
        try {
          // try to parse json error if available
          const errorJson = JSON.parse(errorText);
          if (errorJson.error) errorText = errorJson.error;
        } catch (e) {
          // ignore parsing error
        }
        throw new Error(`Server Error (${response.status}): ${errorText.substring(0, 100)}`);
      }

      const result = await response.json();

      if (result.success && result.url) {
        window.uploadedDesigns[locationName] = {
          url: result.url,
          thumb: result.thumb || result.url,
          name: file.name
        };

        // Show Preview with IMG tag
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
    previewImg.innerHTML = ''; // Clear img tag
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
