// SSActiveWear Variant Selection Widget v5.3 (Detailed Pricing Tooltips + Premium Logic)
(function() {
  document.addEventListener("DOMContentLoaded", initVariantWidgets);

  window.uploadedDesigns = {};
  window.volumeRules = {};

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

        // Save Rules
        window.volumeRules[blockId] = {
           tiers: data.tiers || [],
           sizePremiums: data.sizePremiums || [],
           basePrice: data.basePrice || 0
        };

        if (data.tiers && data.tiers.length > 0) {
           renderVolumeTable(blockId, data.tiers, window.volumeRules[blockId].basePrice);
        }

        updateMatrixTotal(blockId);
      }
    } catch (e) {
      console.warn("Pricing fetch failed", e);
    }
  }

  function renderVolumeTable(blockId, tiers, baseP) {
    const container = document.getElementById(`ss-volume-${blockId}`);
    const content = document.getElementById(`ss-volume-content-${blockId}`);
    if (!container || !content) return;

    container.style.display = 'block';

    content.innerHTML = tiers.map(t => {
       let label = "";
       if (t.type === 'percentage') {
          label = `-${t.value}%`;
       } else {
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
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    const inputs = container.querySelectorAll('.ss-input-field:not(:disabled)');

    let currentTotal = 0;
    container.querySelectorAll('.ss-input-field').forEach(i => currentTotal += (parseInt(i.value) || 0));

    if (currentTotal >= minQty) return;

    const needed = minQty - currentTotal;

    // Find visibly active inputs
    let target = null; // Prefer visible inputs
    const visibleInputs = Array.from(inputs).filter(i => i.offsetParent !== null);

    if (visibleInputs.length > 0) {
       // Prefer L, M, S
       target = visibleInputs.find(i => i.dataset.sizeName === 'L' || i.dataset.sizeName === 'M') || visibleInputs[0];
    } else {
       target = inputs[0];
    }

    if (target) {
       const oldVal = parseInt(target.value) || 0;
       target.value = oldVal + needed;
       updateMatrixTotal(blockId);

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

    // 2. Highlight Table
    const volumeContent = document.getElementById(`ss-volume-content-${blockId}`);
    if (volumeContent) {
       volumeContent.querySelectorAll('.ss-volume-cell').forEach(cell => {
          const min = parseInt(cell.dataset.min);
          const max = parseInt(cell.dataset.max);
          if (totalQty >= min && totalQty <= max) {
             cell.classList.add('active');
             cell.style.background = '#dbeafe';
             cell.style.borderBottom = '3px solid #3b82f6';
          } else {
             cell.classList.remove('active');
             cell.style.background = '';
             cell.style.borderBottom = '';
          }
       });
    }

    // 3. Calculate Total & Update Per-Item Prices and Tooltips
    let grandTotal = 0;

    inputs.forEach(inp => {
      if (inp.offsetParent === null) return;

      const qty = parseInt(inp.value) || 0;
      const variantPrice = parseFloat(inp.dataset.price) || 0;
      const variantId = inp.dataset.variantId;
      const sizeName = inp.dataset.sizeName || "";

      let itemPrice = variantPrice;
      let tooltipHtml = `<div class="ss-tooltip-row"><span>Base Price:</span> <span>$${variantPrice.toFixed(2)}</span></div>`;

      // Discount Logic
      if (activeTier) {
         if (activeTier.type === 'percentage') {
             const discAmount = itemPrice * (activeTier.value / 100);
             itemPrice -= discAmount;
             tooltipHtml += `<div class="ss-tooltip-row"><span>Vol Discount (-${activeTier.value}%):</span> <span>-$${discAmount.toFixed(2)}</span></div>`;
         } else {
             // Fixed Price Override
             // Usually Base Price is replaced by this.
             // But if we want to show 'Detail', we show difference.
             const oldP = itemPrice;
             itemPrice = activeTier.value;
             const diff = oldP - itemPrice;
             if (diff > 0) tooltipHtml += `<div class="ss-tooltip-row"><span>Vol Price:</span> <span>-$${diff.toFixed(2)}</span></div>`;
         }
      }

      // Size Premium Logic
      if (rule && rule.sizePremiums) {
          const premium = rule.sizePremiums.find(p => sizeName.includes(p.pattern) || sizeName === p.pattern);
          if (premium) {
             let premAmount = 0;
             if (premium.type === 'percentage') {
                 premAmount = itemPrice * (premium.value / 100); // Percentage of discounted price? Or Base?
                 // Usually Premium is strict add-on. Base * %.
                 // But let's assume simple addition to current price for safety.
                 itemPrice += premAmount;
                 tooltipHtml += `<div class="ss-tooltip-row"><span>Size Prem (+${premium.value}%):</span> <span>+$${premAmount.toFixed(2)}</span></div>`;
             } else {
                 premAmount = premium.value;
                 itemPrice += premAmount;
                 tooltipHtml += `<div class="ss-tooltip-row"><span>Size Prem:</span> <span>+$${premAmount.toFixed(2)}</span></div>`;
             }
          }
      }

      if (qty > 0) grandTotal += qty * itemPrice;

      // Update Hint with Tooltip
      const hintEl = document.getElementById(`price-hint-${variantId}`);
      if (hintEl) {
         tooltipHtml += `<div class="ss-tooltip-row total"><span>Final Price:</span> <span>$${itemPrice.toFixed(2)}</span></div>`;

         hintEl.innerHTML = `$${itemPrice.toFixed(2)} <div class="ss-price-tooltip">${tooltipHtml}</div>`;

         if (activeTier) hintEl.style.color = '#16a34a'; // Green
         else hintEl.style.color = '#666';
      }
    });

    if (priceEl) priceEl.textContent = `$${grandTotal.toFixed(2)}`;
    if (btn) btn.disabled = totalQty === 0;
  };

  // ─── ADD TO CART ───
  window.addToCart = async function(blockId) {
    const btn = document.getElementById(`ss-add-to-cart-${blockId}`);
    const container = document.getElementById(`ss-matrix-widget-${blockId}`);
    const inputs = container.querySelectorAll('.ss-input-field');

    const items = [];
    inputs.forEach(inp => {
       if (inp.offsetParent === null) return;
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

  // Upload Logic (Condensed safety version)
  window.handleFileUpload = async function(input, locationName, blockId) {
     const file = input.files[0];
     if (!file) return;
     const preview = document.getElementById(`preview-${locationName}-${blockId}`);
     const placeholder = document.getElementById(`placeholder-${locationName}-${blockId}`);
     const previewImg = preview.querySelector('.ss-preview-image');

     const originHtml = placeholder.innerHTML;
     placeholder.innerHTML = '<span class="ss-upload-text">...</span>';

     const fd = new FormData(); fd.append('file', file);
     try {
       const res = await fetch('/apps/ssactiveorder/api/upload', { method:'POST', body:fd });
       if (!res.ok) throw new Error('Upload server error');
       const json = await res.json();
       if (json.success) {
          window.uploadedDesigns[locationName] = json;
          placeholder.style.display='none';
          preview.style.display='flex';
          if (file.type.startsWith('image')) {
             previewImg.innerHTML = `<img src="${json.url}" style="width:100%;height:100%;object-fit:cover;border-radius:12px">`;
          } else {
             previewImg.innerHTML = '📄';
          }
       } else throw new Error(json.error);
     } catch(e) {
       console.error(e);
       alert('Upload Failed: ' + e.message);
       placeholder.innerHTML = originHtml;
     }
  };

  window.removeUpload = function(loc, bid) {
     delete window.uploadedDesigns[loc];
     document.getElementById(`placeholder-${loc}-${bid}`).style.display='flex';
     document.getElementById(`placeholder-${loc}-${bid}`).innerHTML=`<span class="ss-upload-icon">+</span><span class="ss-upload-text">${loc}</span>`;
     document.getElementById(`preview-${loc}-${bid}`).style.display='none';
     document.getElementById(`file-input-${loc}-${bid}`).value = '';
  };

})();
