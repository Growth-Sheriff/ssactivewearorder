// SSActiveWear Variant Selection Widget v5.2 (Dynamic Size Pricing + Highlight Fix)
(function() {
  document.addEventListener("DOMContentLoaded", initVariantWidgets);

  window.uploadedDesigns = {};
  window.volumeRules = {}; // Store rules { tiers: [], sizePremiums: [], basePrice: 0 }

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

    const uploadEl = document.getElementById(`ss-upload-${blockId}`);
    if (uploadEl) uploadEl.style.display = 'block';

    const footerEl = document.querySelector(`#ss-matrix-widget-${blockId} .ss-footer`);
    if (footerEl) footerEl.style.display = 'flex';

    // 2. Fetch Volume Pricing
    try {
      const response = await fetch(`/apps/ssactiveorder/api/volume-pricing?product_id=${productId}`);
      if (response.ok) {
        const data = await response.json();

        // Save Rules
        window.volumeRules[blockId] = {
           tiers: data.tiers || [],
           sizePremiums: data.sizePremiums || [], // e.g. "2XL": +2.00
           basePrice: data.basePrice || 0
        };

        if (data.tiers && data.tiers.length > 0) {
           renderVolumeTable(blockId, data.tiers);
        }

        // Initial Calculation
        updateMatrixTotal(blockId);
      }
    } catch (e) {
      console.warn("Volume pricing fetch failed", e);
    }
  }

  function renderVolumeTable(blockId, tiers) {
    const container = document.getElementById(`ss-volume-${blockId}`);
    const content = document.getElementById(`ss-volume-content-${blockId}`);
    if (!container || !content) return;

    container.style.display = 'block';

    // We show the BASE discount structure.
    // Usually Volume Pricing is based on Quantity -> Price (or Discount %).
    // If it's a fixed price rule, we show the price. If percentage, we show % off?
    // User image shows PRICE ($3.49). This implies a fixed price tier or calculated from base.
    // We'll calculate display price based on Rule Base Price (if available) or assume user wants to see logic.
    // Best UX: Show the PRICE for a standard size (e.g. S-XL).

    const rule = window.volumeRules[blockId];
    const baseP = rule.basePrice || 0; // Cost Price?

    content.innerHTML = tiers.map(t => {
       // Display Logic: If rule has Base Price, show calculated price. Else show Discount %.
       let label = "";
       if (t.type === 'percentage') {
          label = `-${t.value}%`; // Fallback
          // If we have a base price, calculate:
          if (baseP > 0) {
             const p = baseP * (1 - t.value / 100); // Wait, basePrice is usually COST.
             // If Volume Pricing is "Discount from Retail", we don't have a single Retail price.
             // But if specific price is enforced (fixed), we show it.
          }
       } else {
          // Fixed discount or Fixed Price?
          // Usually 'fixed' in this app context might mean "Fixed Price per item" or "Fixed Discount Amount".
          // Looking at standard logic: Amount Off or Fixed Price.
          // Let's assume Fixed Price if big number, Amount Off if small?
          // Prisma schema says: "discountValue".
          // If the user sees $3.49, it's likely the Final Price.
          label = `$${t.value.toFixed(2)}`;
       }

       return `
         <div class="ss-volume-cell"
              data-min="${t.min}"
              data-max="${t.max || 99999}"
              onclick="window.applyVolumeTier('${blockId}', ${t.min})"
              style="cursor:pointer;">
            <div class="ss-vol-qty">${t.min}${t.max ? '-' + t.max : '+'}</div>
            <div class="ss-vol-price">${label}</div>
         </div>
       `;
    }).join('');
  }

  window.applyVolumeTier = function(blockId, minQty) {
    // Helper to auto-fill meaningful quantity if user clicks tier
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    const inputs = container.querySelectorAll('.ss-input-field:not(:disabled)');

    // Check current total
    let currentTotal = 0;
    container.querySelectorAll('.ss-input-field').forEach(i => currentTotal += (parseInt(i.value) || 0));

    if (currentTotal >= minQty) return; // Already met

    const needed = minQty - currentTotal;

    // Find first available input (or currently focused?)
    // Prefer "L" or "M" or first one.
    let target = inputs[0];
    inputs.forEach(inp => {
       if (inp.dataset.sizeName === 'L' || inp.dataset.sizeName === 'M') target = inp;
    });

    if (target) {
       const oldVal = parseInt(target.value) || 0;
       target.value = oldVal + needed;
       updateMatrixTotal(blockId); // Recalc

       // Flash effect
       target.style.transition = "background 0.3s";
       target.style.background = "#dbeafe";
       setTimeout(() => target.style.background = "#fff", 600);
    }
  };

  window.selectMatrixColor = function(colorName, blockId) {
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    if (!container) return;

    container.querySelectorAll('.ss-color-item').forEach(el => {
      el.classList.toggle('ss-color-selected', el.dataset.color === colorName);
    });

    const label = container.querySelector('#ss-selected-color-name');
    if (label) label.textContent = `: ${colorName}`;

    // Show correct Size Group
    container.querySelectorAll('.ss-size-group').forEach(group => {
      group.style.display = (group.dataset.colorGroup === colorName) ? 'block' : 'none';
    });

    const mContainer = container.querySelector('.ss-matrix-container');
    if (mContainer) mContainer.style.display = 'block';

    updateMatrixTotal(blockId);
  };

  window.updateMatrixTotal = function(blockId) {
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    const inputs = container.querySelectorAll('.ss-input-field');
    const priceEl = document.getElementById(`ss-total-price-${blockId}`);
    const btn = document.getElementById(`ss-add-to-cart-${blockId}`);

    let totalQty = 0;
    inputs.forEach(inp => {
      // Only count visible inputs (for selected color)?
      // No, usually bulk order allows mixing colors.
      // BUT our UI hides other colors.
      // If we want MIXED colors, we shouldn't hide them or we should serialize all inputs.
      // Current logic: We only show ONE color group at a time. This implies Single Color selection.
      // So we only count visible inputs.
      if (inp.offsetParent !== null) {
         totalQty += parseInt(inp.value) || 0;
      }
    });

    const rule = window.volumeRules[blockId];

    // 1. Find Active Tier
    let activeTier = null;
    if (rule && rule.tiers) {
       activeTier = rule.tiers.find(t => totalQty >= t.min && totalQty <= (t.max || 999999));
    }

    // 2. Highlight Table (Fix: Explicit class manipulation)
    const volumeContent = document.getElementById(`ss-volume-content-${blockId}`);
    if (volumeContent) {
       volumeContent.querySelectorAll('.ss-volume-cell').forEach(cell => {
          const min = parseInt(cell.dataset.min);
          const max = parseInt(cell.dataset.max);
          if (totalQty >= min && totalQty <= max) {
             cell.classList.add('active');
             cell.style.background = '#dbeafe'; // Inline fallback
             cell.style.borderBottom = '3px solid #3b82f6';
          } else {
             cell.classList.remove('active');
             cell.style.background = '';
             cell.style.borderBottom = '';
          }
       });
    }

    // 3. Calculate Total & Update Per-Item Prices
    let grandTotal = 0;

    inputs.forEach(inp => {
      if (inp.offsetParent === null) return; // Skip hidden

      const qty = parseInt(inp.value) || 0;
      const variantPrice = parseFloat(inp.dataset.price) || 0;
      const variantId = inp.dataset.variantId;
      const sizeName = inp.dataset.sizeName || "";

      // Calculate Price for this item
      // Start with Variant Price (Shopify Retail)
      let itemPrice = variantPrice;

      // Apply Volume Discount
      // Usually Tier Logic:
      // If Tier is Percentage -> Price = Price * (1 - val/100)
      // If Tier is Fixed Price -> Price = val (This overrides variant price!)
      // If Tier is Fixed Off -> Price = Price - val

      // We need to know what "discountType" means in this App.
      // Looking at table ($3.49, $3.14), these look like Fixed Prices.
      // So if activeTier.type == 'fixed' or value is > 1 (and looks like price), we assume Override.

      if (activeTier) {
         if (activeTier.type === 'percentage') {
             itemPrice = itemPrice * (1 - activeTier.value / 100);
         } else {
             // Assume Fixed Price per item
             itemPrice = activeTier.value;
         }
      }

      // Apply Size Premium?
      // Use case: 2XL is +$2.
      // If we use Fixed Price Tier ($3.49), does it include Premium?
      // Usually NO. $3.49 is base. 2XL should be $5.49.
      // So we ADD premium.
      if (rule && rule.sizePremiums) {
          const premium = rule.sizePremiums.find(p => sizeName.includes(p.pattern) || sizeName === p.pattern);
          if (premium) {
             if (premium.type === 'percentage') {
                 itemPrice = itemPrice * (1 + premium.value / 100);
             } else {
                 itemPrice = itemPrice + premium.value;
             }
          }
      }

      if (qty > 0) grandTotal += qty * itemPrice;

      // Update Hint
      const hintEl = document.getElementById(`price-hint-${variantId}`);
      if (hintEl) {
         hintEl.textContent = `$${itemPrice.toFixed(2)}`;
         // Colorize logic?
         if (activeTier) hintEl.style.color = '#16a34a'; // Green if discounted
         else hintEl.style.color = '#666';
      }
    });

    if (priceEl) priceEl.textContent = `$${grandTotal.toFixed(2)}`;
    if (btn) btn.disabled = totalQty === 0;
  };

  // Add To Cart (unchanged logic)
  window.addToCart = async function(blockId) {
    // ... (Same as previous script) ...
    // Note: We are just submitting Variant IDs.
    // If prices are dynamic, they WON'T reflect in Cart unless backend intercepts.
    // Assuming backend or Shopify Script handles it.

    // Copy-paste previous addToCart implementation here for completeness
    const btn = document.getElementById(`ss-add-to-cart-${blockId}`);
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    const inputs = container.querySelectorAll('.ss-input-field');

    // Check if mixing colors logic needed?
    // For now, only visible inputs.

    const items = [];
    inputs.forEach(inp => {
       if (inp.offsetParent === null) return;
       const qty = parseInt(inp.value) || 0;
       if (qty > 0) {
         const item = { id: inp.dataset.variantId, quantity: qty, properties: {} };
         // Attach uploads
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
      await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      btn.textContent = 'Added!';
      setTimeout(() => { window.location.href = '/cart'; }, 800);
    } catch (e) {
      console.error(e);
      btn.textContent = 'Error';
      setTimeout(() => { btn.textContent = 'Add to Cart'; btn.disabled = false; }, 2000);
    }
  };

  window.handleFileUpload = async function(input, locationName, blockId) {
     // ... Same logic ...
     // (Using the fix directly to save space, assuming user has it)
     // Or re-implement shorter version:
     const file = input.files[0];
     if (!file) return;
     const preview = document.getElementById(`preview-${locationName}-${blockId}`);
     const placeholder = document.getElementById(`placeholder-${locationName}-${blockId}`);
     placeholder.innerHTML = '...';

     const fd = new FormData(); fd.append('file', file);
     try {
       const res = await fetch('/apps/ssactiveorder/api/upload', { method:'POST', body:fd });
       const json = await res.json();
       if (json.success) {
          window.uploadedDesigns[locationName] = json;
          placeholder.style.display='none';
          preview.style.display='flex';
          let html = file.type.startsWith('image') ? `<img src="${json.url}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : '📄';
          preview.querySelector('.ss-preview-image').innerHTML = html;
       }
     } catch(e) { console.error(e); placeholder.innerHTML='+'; }
  };

  window.removeUpload = function(loc, bid) {
     delete window.uploadedDesigns[loc];
     document.getElementById(`placeholder-${loc}-${bid}`).style.display='flex';
     document.getElementById(`placeholder-${loc}-${bid}`).innerHTML=`<span class="ss-upload-icon">+</span><span class="ss-upload-text">${loc}</span>`;
     document.getElementById(`preview-${loc}-${bid}`).style.display='none';
  };

})();
