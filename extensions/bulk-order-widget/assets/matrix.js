// SSActiveWear Bulk Order Widget v6.0 – Visible Breakdown Panel
(function () {
  "use strict";
  console.log("[SS-Widget] v6.0 loaded");

  document.addEventListener("DOMContentLoaded", initVariantWidgets);

  window.uploadedDesigns = {};
  window.volumeRules = {};

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
