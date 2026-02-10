// SSActiveWear Bulk Order Widget v6.0 – Visible Breakdown Panel
(function () {
  "use strict";
  console.log("[SS-Widget] v6.0 loaded");

  window.uploadedDesigns = window.uploadedDesigns || {};
  window.volumeRules = window.volumeRules || {};
  window.shippingData = window.shippingData || {};

  document.addEventListener("DOMContentLoaded", initVariantWidgets);

  function initVariantWidgets() {
    var widgets = document.querySelectorAll('[id^="ss-matrix-widget-"]');
    widgets.forEach(function (w) { initWidget(w); });
  }

  function initWidget(container) {
    var blockId = container.id.replace("ss-matrix-widget-", "");
    var productId = container.dataset.productId;
    var loadingEl = container.querySelector(".ss-loading");
    if (loadingEl) loadingEl.style.display = "none";

    // Show first colour
    var variants = [];
    try { variants = JSON.parse(container.dataset.variants || "[]"); } catch (e) {}
    var firstColor = variants.length ? variants[0].option1 : null;
    if (firstColor) window.selectMatrixColor(firstColor, blockId);

    var uploadEl = document.getElementById("ss-upload-" + blockId);
    if (uploadEl) uploadEl.style.display = "block";
    var footerEl = container.querySelector(".ss-footer");
    if (footerEl) footerEl.style.display = "flex";

    // Fetch volume pricing
    fetch("/apps/ssactiveorder/api/volume-pricing?product_id=" + productId)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        window.volumeRules[blockId] = {
          tiers: data.tiers || [],
          sizePremiums: data.sizePremiums || [],
          basePrice: data.basePrice || 0
        };
        if (data.tiers && data.tiers.length > 0) renderVolumeTable(blockId, data.tiers);
        window.updateMatrixTotal(blockId);
      })
      .catch(function (e) { console.warn("[SS-Widget] pricing fetch", e); });

    // Fetch real shipping data from Shopify
    var shopDomain = window.Shopify && window.Shopify.shop ? window.Shopify.shop : "";
    if (shopDomain) {
      fetch("/apps/ssactiveorder/api/shipping-estimate?shop=" + shopDomain)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (data) {
          if (data) {
            window.shippingData[blockId] = data;
            // Update threshold on the DOM element if API returned one
            if (data.freeShippingThreshold) {
              var shipEl = document.getElementById("ss-shipping-" + blockId);
              if (shipEl) shipEl.dataset.threshold = data.freeShippingThreshold;
            }
            window.updateMatrixTotal(blockId);
          }
        })
        .catch(function (e) { console.warn("[SS-Widget] shipping fetch", e); });
    }
  }

  /* ─── Volume Discount Table ─── */
  function renderVolumeTable(blockId, tiers) {
    var container = document.getElementById("ss-volume-" + blockId);
    var content = document.getElementById("ss-volume-content-" + blockId);
    if (!container || !content) return;
    container.style.display = "block";

    content.innerHTML = tiers.map(function (t) {
      var label = t.type === "percentage" ? ("-" + t.value + "%") : ("$" + t.value.toFixed(2));
      return '<div class="ss-volume-cell" data-min="' + t.min + '" data-max="' + (t.max || 99999) + '" ' +
        'onclick="window.applyVolumeTier(\'' + blockId + '\',' + t.min + ')" style="cursor:pointer;">' +
        '<div class="ss-vol-qty">' + t.min + (t.max ? "-" + t.max : "+") + '</div>' +
        '<div class="ss-vol-price">' + label + '</div></div>';
    }).join("");
  }

  window.applyVolumeTier = function (blockId, minQty) {
    var container = document.getElementById("ss-matrix-widget-" + blockId);
    var inputs = container.querySelectorAll(".ss-input-field:not(:disabled)");
    var currentTotal = 0;
    container.querySelectorAll(".ss-input-field").forEach(function (i) {
      currentTotal += parseInt(i.value) || 0;
    });
    if (currentTotal >= minQty) return;
    var needed = minQty - currentTotal;
    var visibleInputs = [];
    inputs.forEach(function (i) { if (i.offsetParent !== null) visibleInputs.push(i); });
    if (!visibleInputs.length) return;
    var target = visibleInputs[0];
    visibleInputs.forEach(function (i) {
      var s = i.dataset.sizeName;
      if (s === "L" || s === "M") target = i;
    });
    target.value = (parseInt(target.value) || 0) + needed;
    window.updateMatrixTotal(blockId);
    target.style.transition = "background 0.3s";
    target.style.background = "#dbeafe";
    setTimeout(function () { target.style.background = "#fff"; }, 600);
  };

  /* ─── Colour Selection ─── */
  window.selectMatrixColor = function (colorName, blockId) {
    var container = document.getElementById("ss-matrix-widget-" + blockId);
    if (!container) return;
    container.querySelectorAll(".ss-color-item").forEach(function (el) {
      el.classList.toggle("ss-color-selected", el.dataset.color === colorName);
    });
    var label = container.querySelector("#ss-selected-color-name");
    if (label) label.textContent = ": " + colorName;
    container.querySelectorAll(".ss-size-group").forEach(function (g) {
      g.style.display = g.dataset.colorGroup === colorName ? "block" : "none";
    });
    var mc = container.querySelector(".ss-matrix-container");
    if (mc) mc.style.display = "block";
    window.updateMatrixTotal(blockId);
  };

  /* ═══════════════════════════════════════════════════════
     MAIN CALCULATION + VISIBLE BREAKDOWN PANEL
     ═══════════════════════════════════════════════════════ */
  window.updateMatrixTotal = function (blockId) {
    var container = document.getElementById("ss-matrix-widget-" + blockId);
    var inputs = container.querySelectorAll(".ss-input-field");
    var priceEl = document.getElementById("ss-total-price-" + blockId);
    var btn = document.getElementById("ss-add-to-cart-" + blockId);

    // Breakdown panel elements
    var breakdownPanel = document.getElementById("ss-breakdown-" + blockId);
    var breakdownTitle = document.getElementById("ss-breakdown-title-" + blockId);
    var breakdownBody = document.getElementById("ss-breakdown-body-" + blockId);
    var breakdownAlert = document.getElementById("ss-breakdown-alert-" + blockId);

    var rule = window.volumeRules[blockId];

    // 1) Total visible qty
    var totalQty = 0;
    inputs.forEach(function (inp) {
      if (inp.offsetParent !== null) totalQty += parseInt(inp.value) || 0;
    });

    // 2) Find active tier
    var activeTier = null;
    if (rule && rule.tiers) {
      for (var i = 0; i < rule.tiers.length; i++) {
        var t = rule.tiers[i];
        if (totalQty >= t.min && totalQty <= (t.max || 999999)) { activeTier = t; break; }
      }
    }

    // 3) Highlight volume table
    var vContent = document.getElementById("ss-volume-content-" + blockId);
    if (vContent) {
      vContent.querySelectorAll(".ss-volume-cell").forEach(function (cell) {
        var mn = parseInt(cell.dataset.min), mx = parseInt(cell.dataset.max);
        if (totalQty >= mn && totalQty <= mx) {
          cell.classList.add("active");
          cell.style.background = "#dbeafe";
          cell.style.borderBottom = "3px solid #3b82f6";
        } else {
          cell.classList.remove("active");
          cell.style.background = "";
          cell.style.borderBottom = "";
        }
      });
    }

    // 4) Calculate and build breakdown rows
    var grandTotal = 0;
    var originalTotal = 0; // without discount
    var lineItems = [];    // for breakdown panel
    var premiumSizes = []; // to show size premium alert

    inputs.forEach(function (inp) {
      if (inp.offsetParent === null) return;
      var qty = parseInt(inp.value) || 0;
      if (qty === 0) return;

      var variantPrice = parseFloat(inp.dataset.price) || 0;
      var variantId = inp.dataset.variantId;
      var sizeName = inp.dataset.sizeName || "OS";

      var itemPrice = variantPrice;
      var origPrice = variantPrice;
      var premiumVal = 0;

      // Volume discount
      if (activeTier) {
        if (activeTier.type === "percentage") {
          itemPrice = itemPrice * (1 - activeTier.value / 100);
        } else {
          itemPrice = activeTier.value;
        }
      }

      // Size premium
      if (rule && rule.sizePremiums) {
        for (var p = 0; p < rule.sizePremiums.length; p++) {
          var prem = rule.sizePremiums[p];
          if (sizeName === prem.pattern || sizeName.indexOf(prem.pattern) !== -1) {
            if (prem.type === "percentage") {
              premiumVal = itemPrice * (prem.value / 100);
            } else {
              premiumVal = prem.value;
            }
            itemPrice += premiumVal;
            premiumSizes.push(sizeName + " (+$" + premiumVal.toFixed(2) + ")");
            break;
          }
        }
      }

      var lineTotal = qty * itemPrice;
      var origLineTotal = qty * origPrice;
      grandTotal += lineTotal;
      originalTotal += origLineTotal;

      lineItems.push({
        size: sizeName,
        qty: qty,
        unitPrice: itemPrice,
        lineTotal: lineTotal,
        hasPremium: premiumVal > 0
      });

      // Update per-input price hint
      var hintEl = document.getElementById("price-hint-" + variantId);
      if (hintEl) {
        hintEl.textContent = "$" + itemPrice.toFixed(2);
        hintEl.style.color = activeTier ? "#16a34a" : "#666";
      }
    });

    // 5) Update total
    if (priceEl) priceEl.textContent = "$" + grandTotal.toFixed(2);
    if (btn) btn.disabled = totalQty === 0;

    // 6) Build visible breakdown panel
    if (breakdownPanel) {
      if (totalQty > 0 && lineItems.length > 0) {
        breakdownPanel.style.display = "block";

        // Title
        if (activeTier && breakdownTitle) {
          var tierLabel = activeTier.type === "percentage"
            ? (activeTier.value + "% discount")
            : ("$" + activeTier.value.toFixed(2) + "/ea");
          breakdownTitle.textContent = "Volume Discount Active: " + tierLabel;
          var tierRange = activeTier.min + (activeTier.max ? "-" + activeTier.max : "+") + " pcs tier";
          breakdownTitle.textContent += " (" + tierRange + ")";
        } else if (breakdownTitle) {
          breakdownTitle.textContent = "Order Summary";
        }

        // Body – line items
        if (breakdownBody) {
          var html = "";
          lineItems.forEach(function (li) {
            var premTag = li.hasPremium ? ' <span style="color:#b45309;font-size:10px;">(incl. size premium)</span>' : "";
            html += '<div class="ss-breakdown-row">' +
              "<span>" + li.qty + "× " + li.size + " @ $" + li.unitPrice.toFixed(2) + premTag + "</span>" +
              "<span>$" + li.lineTotal.toFixed(2) + "</span></div>";
          });

          // Savings
          var savings = originalTotal - grandTotal;
          html += '<div class="ss-breakdown-row total-row">' +
            "<span>Total (" + totalQty + " items)</span>" +
            "<span>$" + grandTotal.toFixed(2);
          if (savings > 0) {
            html += ' <span class="ss-savings-badge">Save $' + savings.toFixed(2) + "</span>";
          }
          html += "</span></div>";

          breakdownBody.innerHTML = html;
        }

        // Alert – size premiums
        if (breakdownAlert) {
          if (premiumSizes.length > 0) {
            var unique = [];
            premiumSizes.forEach(function (s) { if (unique.indexOf(s) === -1) unique.push(s); });
            breakdownAlert.style.display = "flex";
            breakdownAlert.innerHTML = "⚠️ <span>Size premiums applied: <strong>" + unique.join(", ") + "</strong></span>";
          } else {
            breakdownAlert.style.display = "none";
          }
        }
      } else {
        breakdownPanel.style.display = "none";
      }
    }

    // ═══ 7) SMART UPSELL NUDGE ═══
    var upsellEl = document.getElementById("ss-upsell-" + blockId);
    var upsellContent = document.getElementById("ss-upsell-content-" + blockId);

    if (upsellEl && upsellContent && rule && rule.tiers && rule.tiers.length > 0) {
      // Find NEXT tier (the one the customer hasn't reached yet)
      var nextTier = null;
      for (var nt = 0; nt < rule.tiers.length; nt++) {
        if (rule.tiers[nt].min > totalQty) {
          nextTier = rule.tiers[nt];
          break;
        }
      }

      if (nextTier && totalQty > 0) {
        var needed = nextTier.min - totalQty;

        // Calculate what the customer would save at next tier
        var nextDiscLabel = "";
        var potentialSavings = 0;

        if (nextTier.type === "percentage") {
          nextDiscLabel = nextTier.value + "% discount";
          // Estimate savings: current price * next discount - current total
          // Simple estimate using average unit price
          var avgPrice = grandTotal / totalQty;
          var nextTotal = (nextTier.min) * avgPrice * (1 - nextTier.value / 100);
          potentialSavings = (nextTier.min * avgPrice) - nextTotal;
        } else {
          nextDiscLabel = "$" + nextTier.value.toFixed(2) + "/each";
          // Fixed price tier
          var currentAvg = grandTotal / totalQty;
          potentialSavings = (nextTier.min * currentAvg) - (nextTier.min * nextTier.value);
        }

        // Store next tier min for the Apply button
        window._upsellTarget = window._upsellTarget || {};
        window._upsellTarget[blockId] = nextTier.min;

        // Build the nudge message
        var msg = "💡 <strong>" + needed + " more item" + (needed > 1 ? "s" : "") + "</strong> to unlock " +
          "<strong>" + nextDiscLabel + "</strong>!";
        if (potentialSavings > 0) {
          msg += " <span style='color:#166534;font-weight:700;'>You'd save ~$" + potentialSavings.toFixed(2) + "</span>";
        }

        upsellContent.innerHTML = msg;
        upsellEl.style.display = "flex";
      } else {
        // Already at highest tier or no items
        upsellEl.style.display = "none";
      }
    } else if (upsellEl) {
      upsellEl.style.display = "none";
    }

    // ═══ 8) SHIPPING PROGRESS BAR & DELIVERY ESTIMATE ═══
    var shipSection = document.getElementById("ss-shipping-" + blockId);
    if (shipSection) {
      if (totalQty > 0) {
        shipSection.style.display = "block";
        var shipData = window.shippingData && window.shippingData[blockId];
        var threshold = shipData && shipData.freeShippingThreshold
          ? parseFloat(shipData.freeShippingThreshold)
          : (parseFloat(shipSection.dataset.threshold) || 500);

        var fillEl = document.getElementById("ss-shipping-fill-" + blockId);
        var textEl = document.getElementById("ss-shipping-text-" + blockId);
        var deliveryEl = document.getElementById("ss-delivery-" + blockId);
        var pct = Math.min((grandTotal / threshold) * 100, 100);

        if (fillEl) {
          fillEl.style.width = pct + "%";
          if (pct >= 100) { fillEl.classList.add("done"); }
          else { fillEl.classList.remove("done"); }
        }

        if (textEl) {
          if (grandTotal >= threshold) {
            textEl.innerHTML = '🎉 <span class="ss-ship-done">FREE SHIPPING unlocked!</span>';
          } else {
            var remaining = (threshold - grandTotal).toFixed(2);
            textEl.textContent = "🚚 Add $" + remaining + " more for FREE shipping";
          }
        }

        // Show available shipping methods from API
        if (deliveryEl && shipData && shipData.zones && shipData.zones.length > 0) {
          var methodsHtml = "📦 Shipping: ";
          var shown = [];
          for (var zi = 0; zi < shipData.zones.length; zi++) {
            var z = shipData.zones[zi];
            for (var mi = 0; mi < z.methods.length; mi++) {
              var m = z.methods[mi];
              if (shown.indexOf(m.name) === -1) {
                shown.push(m.name);
                if (m.isFree) {
                  methodsHtml += "<strong>" + m.name + " (FREE)</strong> ";
                } else {
                  methodsHtml += m.name + " ($" + m.price.toFixed(2) + ") ";
                }
                if (shown.length < 3) methodsHtml += " · ";
              }
              if (shown.length >= 3) break;
            }
            if (shown.length >= 3) break;
          }
          deliveryEl.innerHTML = methodsHtml;
        } else if (deliveryEl) {
          deliveryEl.innerHTML = "📦 Shipping calculated at checkout";
        }
      } else {
        shipSection.style.display = "none";
      }
    }

    // ═══ 9) VIP MEMBER DISCOUNT STATUS ═══
    var widgetEl = document.getElementById("ss-matrix-widget-" + blockId);
    var vipStatus = document.getElementById("ss-vip-status-" + blockId);
    if (widgetEl && vipStatus && totalQty > 0) {
      var isLoggedIn = widgetEl.dataset.customerLoggedIn === "true";
      var vipEnabled = widgetEl.dataset.vipEnabled === "true";
      var vipDiscount = parseFloat(widgetEl.dataset.vipDiscount) || 10;
      var vipMinOrder = parseFloat(widgetEl.dataset.vipMinOrder) || 200;

      if (isLoggedIn && vipEnabled) {
        if (grandTotal >= vipMinOrder) {
          var vipSavings = (grandTotal * vipDiscount / 100);
          vipStatus.className = "ss-vip-status active";
          vipStatus.innerHTML = "✅ VIP discount ACTIVE! You save an extra <strong>$" +
            vipSavings.toFixed(2) + "</strong> at checkout.";
        } else {
          var vipNeeded = (vipMinOrder - grandTotal).toFixed(2);
          vipStatus.className = "ss-vip-status pending";
          vipStatus.innerHTML = "⏳ Add <strong>$" + vipNeeded +
            "</strong> more to activate your " + vipDiscount + "% VIP discount!";
        }
      }
    } else if (vipStatus) {
      vipStatus.innerHTML = "";
    }

    // ═══ 10) LEAD CAPTURE FORM VISIBILITY (Guest only) ═══
    var leadForm = document.getElementById("ss-lead-form-" + blockId);
    if (leadForm && widgetEl) {
      var isGuest = widgetEl.dataset.customerLoggedIn !== "true";
      if (isGuest && totalQty > 0) {
        leadForm.style.display = "block";
        // Randomize counter for social proof
        var countEl = document.getElementById("ss-lead-count-" + blockId);
        if (countEl && !countEl.dataset.set) {
          countEl.textContent = String(Math.floor(Math.random() * 18) + 12);
          countEl.dataset.set = "1";
        }
      } else {
        leadForm.style.display = "none";
      }
    }
  };
  /* ─── Apply Upsell (Auto-fill to next tier) ─── */
  window.applyUpsell = function (blockId) {
    var target = window._upsellTarget && window._upsellTarget[blockId];
    if (target) {
      window.applyVolumeTier(blockId, target);
    }
  };

  /* ─── Lead Form Submit ─── */
  window.submitLeadForm = function (blockId) {
    var emailInput = document.getElementById("ss-lead-email-" + blockId);
    var submitBtn = document.getElementById("ss-lead-submit-" + blockId);
    var successEl = document.getElementById("ss-lead-success-" + blockId);
    var container = document.getElementById("ss-matrix-widget-" + blockId);

    if (!emailInput || !emailInput.value || !emailInput.value.includes("@")) {
      emailInput.style.borderColor = "#dc2626";
      emailInput.focus();
      return;
    }

    // Collect order details
    var inputs = container.querySelectorAll(".ss-input-field");
    var orderItems = [];
    inputs.forEach(function (inp) {
      if (inp.offsetParent === null) return;
      var qty = parseInt(inp.value) || 0;
      if (qty > 0) {
        orderItems.push({
          variantId: inp.dataset.variantId,
          size: inp.dataset.size || "N/A",
          qty: qty
        });
      }
    });

    var productTitle = "";
    var productEl = container.closest("[data-product-title]");
    if (productEl) productTitle = productEl.dataset.productTitle;

    // Build payload
    var payload = {
      email: emailInput.value.trim(),
      product: container.dataset.productId,
      productTitle: productTitle || document.title,
      items: orderItems,
      totalQty: orderItems.reduce(function(s, i) { return s + i.qty; }, 0),
      pageUrl: window.location.href,
      timestamp: new Date().toISOString()
    };

    // Disable button
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    // Send to backend
    fetch("/apps/ssactiveorder/api/lead-capture", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        // Show success
        document.querySelector("#ss-lead-form-" + blockId + " .ss-lead-form-row").style.display = "none";
        document.querySelector("#ss-lead-form-" + blockId + " .ss-lead-trust").style.display = "none";
        if (successEl) successEl.style.display = "flex";
      })
      .catch(function (err) {
        console.warn("[SS-Widget] Lead submit error:", err);
        // Still show success for UX
        document.querySelector("#ss-lead-form-" + blockId + " .ss-lead-form-row").style.display = "none";
        document.querySelector("#ss-lead-form-" + blockId + " .ss-lead-trust").style.display = "none";
        if (successEl) successEl.style.display = "flex";
      });
  };

  /* ─── Add to Cart ─── */
  window.addToCart = function (blockId) {
    var btn = document.getElementById("ss-add-to-cart-" + blockId);
    var container = document.getElementById("ss-matrix-widget-" + blockId);
    var inputs = container.querySelectorAll(".ss-input-field");
    var items = [];

    inputs.forEach(function (inp) {
      if (inp.offsetParent === null) return;
      var qty = parseInt(inp.value) || 0;
      if (qty <= 0) return;
      var item = { id: inp.dataset.variantId, quantity: qty, properties: {} };
      if (window.uploadedDesigns) {
        Object.keys(window.uploadedDesigns).forEach(function (loc) {
          var d = window.uploadedDesigns[loc];
          var label = loc.split("_").map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join(" ");
          item.properties[label + " Design"] = d.url;
        });
      }
      items.push(item);
    });

    if (!items.length) return;
    btn.textContent = "Adding...";
    btn.disabled = true;

    fetch("/cart/add.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items })
    })
      .then(function () {
        btn.textContent = "Added ✓";
        setTimeout(function () { window.location.href = "/cart"; }, 800);
      })
      .catch(function (e) {
        console.error(e);
        btn.textContent = "Error";
        setTimeout(function () { btn.textContent = "Add to Cart"; btn.disabled = false; }, 2000);
      });
  };

  /* ─── Upload ─── */
  window.handleFileUpload = function (input, locationName, blockId) {
    var file = input.files[0];
    if (!file) return;
    var preview = document.getElementById("preview-" + locationName + "-" + blockId);
    var placeholder = document.getElementById("placeholder-" + locationName + "-" + blockId);
    var origHtml = placeholder.innerHTML;
    placeholder.innerHTML = '<span class="ss-upload-text">Uploading…</span>';

    var fd = new FormData();
    fd.append("file", file);

    fetch("/apps/ssactiveorder/api/upload", { method: "POST", body: fd })
      .then(function (r) { if (!r.ok) throw new Error("Upload failed"); return r.json(); })
      .then(function (json) {
        if (!json.success) throw new Error(json.error || "Upload error");
        window.uploadedDesigns[locationName] = json;
        placeholder.style.display = "none";
        preview.style.display = "flex";
        var imgBox = preview.querySelector(".ss-preview-image");
        if (file.type.startsWith("image")) {
          imgBox.innerHTML = '<img src="' + json.url + '" style="width:100%;height:100%;object-fit:cover;border-radius:12px" width="120" height="120">';
        } else {
          imgBox.innerHTML = "📄";
        }
      })
      .catch(function (e) {
        console.error(e);
        alert("Upload Failed: " + e.message);
        placeholder.innerHTML = origHtml;
      });
  };

  window.removeUpload = function (loc, bid) {
    delete window.uploadedDesigns[loc];
    var ph = document.getElementById("placeholder-" + loc + "-" + bid);
    ph.style.display = "flex";
    ph.innerHTML = '<span class="ss-upload-icon">+</span><span class="ss-upload-text">' + loc + "</span>";
    document.getElementById("preview-" + loc + "-" + bid).style.display = "none";
    var fi = document.getElementById("file-input-" + loc + "-" + bid);
    if (fi) fi.value = "";
  };
})();
