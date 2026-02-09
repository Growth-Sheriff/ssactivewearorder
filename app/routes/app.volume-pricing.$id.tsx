import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigate, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Box,
    Button,
    Card,
    Checkbox,
    Divider,
    FormLayout,
    Icon,
    InlineStack,
    Modal,
    Page,
    Tabs,
    Text,
    TextField
} from "@shopify/polaris";
import {
    PlusIcon,
    RefreshIcon,
    SearchIcon
} from "@shopify/polaris-icons";
import { useCallback, useMemo, useState } from "react";
import prisma from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

// Types for serialized data
interface TierData {
  id: string;
  minQty: number;
  maxQty: number | null;
  discountType: string;
  discountValue: number;
  sortOrder: number;
}

interface SizePremiumData {
  id: string;
  sizePattern: string;
  premiumType: string;
  premiumValue: number;
  sortOrder: number;
}

interface ProductData {
  id: string;
  shopifyProductId: string;
  ssStyleId: string;
  basePrice: number;
  styleName: string | null;
  lastPriceSync: string | null;
}

interface RuleData {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  syncEnabled: boolean;
  syncIntervalDays: number;
  lastSyncAt: string | null;
  tiers: TierData[];
  sizePremiums: SizePremiumData[];
  products: ProductData[];
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const ruleId = params.id;

  const rule = await prisma.volumePriceRule.findUnique({
    where: { id: ruleId },
    include: {
      tiers: { orderBy: { sortOrder: "asc" } },
      sizePremiums: { orderBy: { sortOrder: "asc" } },
      products: { orderBy: { styleName: "asc" } },
    },
  });

  if (!rule || rule.shop !== shop) {
    throw new Response("Not Found", { status: 404 });
  }

  // Get imported products for product picker
  const importedProducts = await prisma.productMap.findMany({
    where: { shop },
    select: {
      shopifyProductId: true,
      ssStyleId: true,
    },
  });

  return json({ rule, importedProducts });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const ruleId = params.id!;
  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  // Update rule settings
  if (actionType === "updateSettings") {
    const name = formData.get("name") as string;
    const description = formData.get("description") as string;
    const syncEnabled = formData.get("syncEnabled") === "true";
    const syncIntervalDays = parseInt(formData.get("syncIntervalDays") as string) || 3;

    await prisma.volumePriceRule.update({
      where: { id: ruleId },
      data: { name, description: description || null, syncEnabled, syncIntervalDays },
    });

    return json({ success: true, message: "Settings saved" });
  }

  // Save tiers (bulk replace)
  if (actionType === "saveTiers") {
    const tiersJson = formData.get("tiers") as string;
    const tiers = JSON.parse(tiersJson) as Array<{
      minQty: number;
      maxQty: number | null;
      discountType: string;
      discountValue: number;
    }>;

    // Delete existing tiers
    await prisma.volumeTier.deleteMany({ where: { ruleId } });

    // Create new tiers
    await prisma.volumeTier.createMany({
      data: tiers.map((t, i) => ({
        ruleId,
        minQty: t.minQty,
        maxQty: t.maxQty,
        discountType: t.discountType,
        discountValue: t.discountValue,
        sortOrder: i,
      })),
    });

    return json({ success: true, message: "Tiers saved" });
  }

  // Save size premiums (bulk replace)
  if (actionType === "saveSizePremiums") {
    const premiumsJson = formData.get("premiums") as string;
    const premiums = JSON.parse(premiumsJson) as Array<{
      sizePattern: string;
      premiumType: string;
      premiumValue: number;
    }>;

    await prisma.volumeSizePremium.deleteMany({ where: { ruleId } });

    await prisma.volumeSizePremium.createMany({
      data: premiums.map((p, i) => ({
        ruleId,
        sizePattern: p.sizePattern,
        premiumType: p.premiumType,
        premiumValue: p.premiumValue,
        sortOrder: i,
      })),
    });

    return json({ success: true, message: "Size premiums saved" });
  }

  // Add product to rule
  if (actionType === "addProduct") {
    const shopifyProductId = formData.get("shopifyProductId") as string;
    const ssStyleId = formData.get("ssStyleId") as string;

    // Get style info from SS if possible
    let styleName = `Style #${ssStyleId}`;
    let basePrice = 0;

    try {
      const ssClient = new SSActiveWearClient();
      const products = await ssClient.getProducts(parseInt(ssStyleId));
      if (products && products.length > 0) {
        basePrice = products[0].piecePrice || 0;
      }
      const styleDetails = await ssClient.getStyleDetails(parseInt(ssStyleId));
      if (styleDetails && styleDetails.length > 0) {
        styleName = styleDetails[0].title || styleDetails[0].styleName || styleName;
      }
    } catch (e) {
      console.error("[VolumePricing] Could not fetch style info:", e);
    }

    // Check for duplicate
    const existing = await prisma.volumePriceProduct.findUnique({
      where: { ruleId_shopifyProductId: { ruleId, shopifyProductId } },
    });

    if (existing) {
      return json({ success: false, message: "Product already assigned to this rule" });
    }

    await prisma.volumePriceProduct.create({
      data: {
        ruleId,
        shopifyProductId,
        ssStyleId,
        basePrice,
        styleName,
        lastPriceSync: new Date(),
      },
    });

    // Update Shopify product metafield with volume pricing data
    try {
      const rule = await prisma.volumePriceRule.findUnique({
        where: { id: ruleId },
        include: { tiers: { orderBy: { sortOrder: "asc" } }, sizePremiums: true },
      });

      if (rule) {
        const metafieldData = {
          tiers: rule.tiers.map(t => ({
            minQty: t.minQty,
            maxQty: t.maxQty,
            discountType: t.discountType,
            discountValue: t.discountValue,
          })),
          sizePremiums: rule.sizePremiums.map(sp => ({
            sizePattern: sp.sizePattern,
            premiumType: sp.premiumType,
            premiumValue: sp.premiumValue,
          })),
          basePrice,
          ruleName: rule.name,
        };

        await admin.graphql(`
          mutation setVolumePricing($input: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $input) {
              metafields { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            input: [{
              ownerId: shopifyProductId,
              namespace: "ss_pricing",
              key: "volume_tiers",
              type: "json",
              value: JSON.stringify(metafieldData),
            }],
          },
        });
      }
    } catch (e) {
      console.error("[VolumePricing] Could not set metafield:", e);
    }

    return json({ success: true, message: "Product added" });
  }

  // Remove product from rule
  if (actionType === "removeProduct") {
    const productId = formData.get("productId") as string;

    // Get product info before deleting
    const product = await prisma.volumePriceProduct.findUnique({
      where: { id: productId },
    });

    await prisma.volumePriceProduct.delete({ where: { id: productId } });

    // Clean up metafield
    if (product) {
      try {
        await admin.graphql(`
          mutation removeVolumePricing($input: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $input) {
              metafields { id }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            input: [{
              ownerId: product.shopifyProductId,
              namespace: "ss_pricing",
              key: "volume_tiers",
              type: "json",
              value: JSON.stringify({ tiers: [], sizePremiums: [], basePrice: 0, ruleName: "" }),
            }],
          },
        });
      } catch (e) {
        console.error("[VolumePricing] Could not clear metafield:", e);
      }
    }

    return json({ success: true, message: "Product removed" });
  }

  // Sync prices for all products in this rule
  if (actionType === "syncPrices") {
    const rule = await prisma.volumePriceRule.findUnique({
      where: { id: ruleId },
      include: {
        tiers: { orderBy: { sortOrder: "asc" } },
        sizePremiums: true,
        products: true,
      },
    });

    if (!rule) return json({ success: false, message: "Rule not found" });

    const ssClient = new SSActiveWearClient();
    let synced = 0;
    const errors: string[] = [];

    for (const product of rule.products) {
      try {
        const ssProducts = await ssClient.getProducts(parseInt(product.ssStyleId));
        if (ssProducts && ssProducts.length > 0) {
          const newBasePrice = ssProducts[0].piecePrice || 0;

          await prisma.volumePriceProduct.update({
            where: { id: product.id },
            data: { basePrice: newBasePrice, lastPriceSync: new Date() },
          });

          // Update Shopify metafield
          const metafieldData = {
            tiers: rule.tiers.map(t => ({
              minQty: t.minQty,
              maxQty: t.maxQty,
              discountType: t.discountType,
              discountValue: t.discountValue,
            })),
            sizePremiums: rule.sizePremiums.map(sp => ({
              sizePattern: sp.sizePattern,
              premiumType: sp.premiumType,
              premiumValue: sp.premiumValue,
            })),
            basePrice: newBasePrice,
            ruleName: rule.name,
          };

          await admin.graphql(`
            mutation setVolumePricing($input: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $input) {
                metafields { id }
                userErrors { field message }
              }
            }
          `, {
            variables: {
              input: [{
                ownerId: product.shopifyProductId,
                namespace: "ss_pricing",
                key: "volume_tiers",
                type: "json",
                value: JSON.stringify(metafieldData),
              }],
            },
          });

          synced++;
        }
      } catch (e: any) {
        errors.push(`Style ${product.ssStyleId}: ${e.message}`);
      }
    }

    await prisma.volumePriceRule.update({
      where: { id: ruleId },
      data: { lastSyncAt: new Date() },
    });

    return json({
      success: true,
      message: `Synced ${synced}/${rule.products.length} products. ${errors.length > 0 ? `Errors: ${errors.join(", ")}` : ""}`,
    });
  }

  return json({ success: false, message: "Unknown action" });
};

// ═══════════════════════════════════════════════════════
// UI Component
// ═══════════════════════════════════════════════════════

export default function VolumePricingDetailPage() {
  const { rule, importedProducts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const isSubmitting = navigation.state === "submitting";

  // Tab state
  const [selectedTab, setSelectedTab] = useState(0);
  const tabs = [
    { id: "tiers", content: "📊 Quantity Tiers" },
    { id: "sizes", content: "📏 Size Premiums" },
    { id: "products", content: `📦 Products (${rule.products.length})` },
    { id: "settings", content: "⚙️ Settings" },
    { id: "preview", content: "👁️ Preview" },
  ];

  // ─── Tiers State ─────────────────────────────────
  const [tiers, setTiers] = useState<Array<{
    minQty: string;
    maxQty: string;
    discountType: string;
    discountValue: string;
  }>>(
    rule.tiers.map(t => ({
      minQty: String(t.minQty),
      maxQty: t.maxQty ? String(t.maxQty) : "",
      discountType: t.discountType,
      discountValue: String(t.discountValue),
    }))
  );

  const addTier = useCallback(() => {
    const lastTier = tiers[tiers.length - 1];
    const nextMin = lastTier ? parseInt(lastTier.maxQty || "0") + 1 : 1;
    setTiers([...tiers, {
      minQty: String(nextMin),
      maxQty: "",
      discountType: "percentage",
      discountValue: "0",
    }]);
  }, [tiers]);

  const removeTier = useCallback((index: number) => {
    setTiers(tiers.filter((_, i) => i !== index));
  }, [tiers]);

  const updateTier = useCallback((index: number, field: string, value: string) => {
    setTiers(tiers.map((t, i) => i === index ? { ...t, [field]: value } : t));
  }, [tiers]);

  const saveTiers = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "saveTiers");
    formData.set("tiers", JSON.stringify(
      tiers.map(t => ({
        minQty: parseInt(t.minQty) || 1,
        maxQty: t.maxQty ? parseInt(t.maxQty) : null,
        discountType: t.discountType,
        discountValue: parseFloat(t.discountValue) || 0,
      }))
    ));
    submit(formData, { method: "POST" });
  }, [tiers, submit]);

  // ─── Size Premiums State ─────────────────────────
  const [sizePremiums, setSizePremiums] = useState<Array<{
    sizePattern: string;
    premiumType: string;
    premiumValue: string;
  }>>(
    rule.sizePremiums.map(sp => ({
      sizePattern: sp.sizePattern,
      premiumType: sp.premiumType,
      premiumValue: String(sp.premiumValue),
    }))
  );

  const addSizePremium = useCallback(() => {
    setSizePremiums([...sizePremiums, {
      sizePattern: "2XL",
      premiumType: "fixed",
      premiumValue: "1.71",
    }]);
  }, [sizePremiums]);

  const removeSizePremium = useCallback((index: number) => {
    setSizePremiums(sizePremiums.filter((_, i) => i !== index));
  }, [sizePremiums]);

  const updateSizePremium = useCallback((index: number, field: string, value: string) => {
    setSizePremiums(sizePremiums.map((sp, i) => i === index ? { ...sp, [field]: value } : sp));
  }, [sizePremiums]);

  const saveSizePremiums = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "saveSizePremiums");
    formData.set("premiums", JSON.stringify(
      sizePremiums.map(sp => ({
        sizePattern: sp.sizePattern,
        premiumType: sp.premiumType,
        premiumValue: parseFloat(sp.premiumValue) || 0,
      }))
    ));
    submit(formData, { method: "POST" });
  }, [sizePremiums, submit]);

  // ─── Product Picker State ────────────────────────
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [productSearch, setProductSearch] = useState("");

  // Already assigned product IDs
  const assignedProductIds = useMemo(() =>
    new Set(rule.products.map(p => p.shopifyProductId)),
    [rule.products]
  );

  // Available products (imported but not yet assigned)
  const availableProducts = useMemo(() =>
    importedProducts.filter(p => !assignedProductIds.has(p.shopifyProductId)),
    [importedProducts, assignedProductIds]
  );

  const filteredAvailable = useMemo(() => {
    if (!productSearch) return availableProducts;
    const q = productSearch.toLowerCase();
    return availableProducts.filter(p =>
      p.ssStyleId.toLowerCase().includes(q) ||
      p.shopifyProductId.toLowerCase().includes(q)
    );
  }, [availableProducts, productSearch]);

  const handleAddProduct = useCallback((shopifyProductId: string, ssStyleId: string) => {
    const formData = new FormData();
    formData.set("action", "addProduct");
    formData.set("shopifyProductId", shopifyProductId);
    formData.set("ssStyleId", ssStyleId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleRemoveProduct = useCallback((productId: string) => {
    const formData = new FormData();
    formData.set("action", "removeProduct");
    formData.set("productId", productId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleSyncPrices = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "syncPrices");
    submit(formData, { method: "POST" });
  }, [submit]);

  // ─── Settings State ──────────────────────────────
  const [settingsName, setSettingsName] = useState(rule.name);
  const [settingsDesc, setSettingsDesc] = useState(rule.description || "");
  const [settingsSyncEnabled, setSettingsSyncEnabled] = useState(rule.syncEnabled);
  const [settingsSyncDays, setSettingsSyncDays] = useState(String(rule.syncIntervalDays));

  const saveSettings = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "updateSettings");
    formData.set("name", settingsName);
    formData.set("description", settingsDesc);
    formData.set("syncEnabled", String(settingsSyncEnabled));
    formData.set("syncIntervalDays", settingsSyncDays);
    submit(formData, { method: "POST" });
  }, [settingsName, settingsDesc, settingsSyncEnabled, settingsSyncDays, submit]);

  // ─── Preview Computation ─────────────────────────
  const sampleBasePrice = rule.products.length > 0 ? rule.products[0].basePrice : 10;

  const previewRows = useMemo(() => {
    return tiers.map(tier => {
      const base = sampleBasePrice;
      const discType = tier.discountType;
      const discVal = parseFloat(tier.discountValue) || 0;

      let price: number;
      if (discType === "percentage") {
        price = base * (1 - discVal / 100);
      } else {
        price = base - discVal;
      }

      return [
        `${tier.minQty}${tier.maxQty ? `-${tier.maxQty}` : "+"}`,
        discType === "percentage" ? `${discVal}%` : `$${discVal.toFixed(2)}`,
        `$${Math.max(0, price).toFixed(2)}`,
      ];
    });
  }, [tiers, sampleBasePrice]);

  return (
    <Page
      backAction={{ url: "/app/volume-pricing" }}
      title={rule.name}
      subtitle={`Volume Pricing Rule • ${rule.products.length} products`}
      secondaryActions={[
        {
          content: "Sync Prices Now",
          icon: RefreshIcon,
          onAction: handleSyncPrices,
          loading: isSubmitting,
        },
      ]}
    >
      <TitleBar title={rule.name} />
      <BlockStack gap="400">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab}>
          <Box paddingBlockStart="400">
            {/* ═══ TAB 0: QUANTITY TIERS ═══ */}
            {selectedTab === 0 && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Quantity Tiers</Text>
                    <InlineStack gap="200">
                      <Button icon={PlusIcon} onClick={addTier}>Add Tier</Button>
                      <Button variant="primary" onClick={saveTiers} loading={isSubmitting}>
                        Save Tiers
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  <Divider />

                  {/* Excel-like Grid */}
                  <div style={{ overflowX: "auto" }}>
                    <table style={{
                      width: "100%",
                      borderCollapse: "collapse",
                      border: "1px solid #c4cdd5",
                      borderRadius: "8px",
                      overflow: "hidden",
                    }}>
                      <thead>
                        <tr style={{ background: "#f6f6f7" }}>
                          <th style={thStyle}>#</th>
                          <th style={thStyle}>Min Qty</th>
                          <th style={thStyle}>Max Qty</th>
                          <th style={thStyle}>Discount Type</th>
                          <th style={thStyle}>Discount Value</th>
                          <th style={thStyle}>Example ($10 base)</th>
                          <th style={{ ...thStyle, width: "40px" }}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {tiers.map((tier, index) => {
                          const base = 10;
                          const discVal = parseFloat(tier.discountValue) || 0;
                          const examplePrice = tier.discountType === "percentage"
                            ? base * (1 - discVal / 100)
                            : base - discVal;

                          return (
                            <tr key={index} style={{ borderBottom: "1px solid #e1e3e5" }}>
                              <td style={tdStyle}>
                                <Text as="span" variant="bodySm" tone="subdued">{index + 1}</Text>
                              </td>
                              <td style={tdStyle}>
                                <input
                                  type="number"
                                  value={tier.minQty}
                                  onChange={(e) => updateTier(index, "minQty", e.target.value)}
                                  style={inputStyle}
                                  min="1"
                                />
                              </td>
                              <td style={tdStyle}>
                                <input
                                  type="number"
                                  value={tier.maxQty}
                                  onChange={(e) => updateTier(index, "maxQty", e.target.value)}
                                  placeholder="∞"
                                  style={inputStyle}
                                  min="1"
                                />
                              </td>
                              <td style={tdStyle}>
                                <select
                                  value={tier.discountType}
                                  onChange={(e) => updateTier(index, "discountType", e.target.value)}
                                  style={selectStyle}
                                >
                                  <option value="percentage">% Percentage</option>
                                  <option value="fixed">$ Fixed Amount</option>
                                </select>
                              </td>
                              <td style={tdStyle}>
                                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                  <span style={{ fontWeight: 600, color: "#637381" }}>
                                    {tier.discountType === "percentage" ? "%" : "$"}
                                  </span>
                                  <input
                                    type="number"
                                    value={tier.discountValue}
                                    onChange={(e) => updateTier(index, "discountValue", e.target.value)}
                                    style={inputStyle}
                                    step="0.01"
                                    min="0"
                                  />
                                </div>
                              </td>
                              <td style={{
                                ...tdStyle,
                                fontWeight: 700,
                                color: discVal > 0 ? "#008060" : "#637381",
                                background: discVal > 0 ? "#f1fcf8" : undefined,
                              }}>
                                ${Math.max(0, examplePrice).toFixed(2)}
                              </td>
                              <td style={tdStyle}>
                                {tiers.length > 1 && (
                                  <button
                                    type="button"
                                    onClick={() => removeTier(index)}
                                    style={{
                                      background: "none", border: "none", cursor: "pointer",
                                      color: "#d72c0d", fontSize: "16px", padding: "4px",
                                    }}
                                    title="Remove tier"
                                  >
                                    ✕
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <Banner tone="info">
                    Leave "Max Qty" empty for the last tier to apply to all quantities above the minimum.
                  </Banner>
                </BlockStack>
              </Card>
            )}

            {/* ═══ TAB 1: SIZE PREMIUMS ═══ */}
            {selectedTab === 1 && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Size Premiums</Text>
                    <InlineStack gap="200">
                      <Button icon={PlusIcon} onClick={addSizePremium}>Add Premium</Button>
                      <Button variant="primary" onClick={saveSizePremiums} loading={isSubmitting}>
                        Save Premiums
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  <Divider />

                  {sizePremiums.length === 0 ? (
                    <Banner tone="info">
                      No size premiums configured. All sizes use the same base price. Add premiums for larger sizes (e.g. 2XL, 3XL) that cost more.
                    </Banner>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        border: "1px solid #c4cdd5",
                      }}>
                        <thead>
                          <tr style={{ background: "#f6f6f7" }}>
                            <th style={thStyle}>Size Pattern</th>
                            <th style={thStyle}>Premium Type</th>
                            <th style={thStyle}>Premium Value</th>
                            <th style={thStyle}>Example (base $2.49)</th>
                            <th style={{ ...thStyle, width: "40px" }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {sizePremiums.map((sp, index) => {
                            const premVal = parseFloat(sp.premiumValue) || 0;
                            const exampleBase = 2.49;
                            const examplePrice = sp.premiumType === "fixed"
                              ? exampleBase + premVal
                              : exampleBase * (1 + premVal / 100);

                            return (
                              <tr key={index} style={{ borderBottom: "1px solid #e1e3e5" }}>
                                <td style={tdStyle}>
                                  <input
                                    type="text"
                                    value={sp.sizePattern}
                                    onChange={(e) => updateSizePremium(index, "sizePattern", e.target.value)}
                                    placeholder="e.g. 2XL"
                                    style={inputStyle}
                                  />
                                </td>
                                <td style={tdStyle}>
                                  <select
                                    value={sp.premiumType}
                                    onChange={(e) => updateSizePremium(index, "premiumType", e.target.value)}
                                    style={selectStyle}
                                  >
                                    <option value="fixed">$ Fixed Add</option>
                                    <option value="percentage">% Percentage Add</option>
                                  </select>
                                </td>
                                <td style={tdStyle}>
                                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                                    <span style={{ fontWeight: 600, color: "#637381" }}>
                                      {sp.premiumType === "fixed" ? "+$" : "+%"}
                                    </span>
                                    <input
                                      type="number"
                                      value={sp.premiumValue}
                                      onChange={(e) => updateSizePremium(index, "premiumValue", e.target.value)}
                                      style={inputStyle}
                                      step="0.01"
                                      min="0"
                                    />
                                  </div>
                                </td>
                                <td style={{
                                  ...tdStyle,
                                  fontWeight: 700,
                                  color: "#b98900",
                                }}>
                                  ${examplePrice.toFixed(2)}
                                </td>
                                <td style={tdStyle}>
                                  <button
                                    type="button"
                                    onClick={() => removeSizePremium(index)}
                                    style={{
                                      background: "none", border: "none", cursor: "pointer",
                                      color: "#d72c0d", fontSize: "16px", padding: "4px",
                                    }}
                                    title="Remove"
                                  >
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <Banner tone="info">
                    Size premiums add extra cost for specific sizes like 2XL, 3XL. The pattern matches the size name (e.g. "2XL" matches "2XL" size variants).
                  </Banner>
                </BlockStack>
              </Card>
            )}

            {/* ═══ TAB 2: PRODUCTS ═══ */}
            {selectedTab === 2 && (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">Assigned Products ({rule.products.length})</Text>
                    <InlineStack gap="200">
                      <Button onClick={handleSyncPrices} icon={RefreshIcon} loading={isSubmitting}>
                        Sync All Prices
                      </Button>
                      <Button icon={PlusIcon} variant="primary" onClick={() => setShowProductPicker(true)}>
                        Add Product
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  <Divider />

                  {rule.products.length === 0 ? (
                    <Banner tone="info">
                      No products assigned to this rule. Add imported products to apply volume pricing.
                    </Banner>
                  ) : (
                    <div style={{ overflowX: "auto" }}>
                      <table style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        border: "1px solid #c4cdd5",
                      }}>
                        <thead>
                          <tr style={{ background: "#f6f6f7" }}>
                            <th style={thStyle}>Style</th>
                            <th style={thStyle}>Style ID</th>
                            <th style={thStyle}>Base Cost</th>
                            {tiers.map((tier, i) => (
                              <th key={i} style={{
                                ...thStyle,
                                background: i % 2 === 0 ? "#eaf5ea" : "#f6f6f7",
                                fontSize: "11px",
                              }}>
                                {tier.minQty}-{tier.maxQty || "∞"}
                              </th>
                            ))}
                            <th style={thStyle}>Last Sync</th>
                            <th style={{ ...thStyle, width: "40px" }}></th>
                          </tr>
                        </thead>
                        <tbody>
                          {rule.products.map((product) => {
                            const tierPrices = tiers.map(tier => {
                              const base = product.basePrice;
                              const discVal = parseFloat(tier.discountValue) || 0;
                              if (tier.discountType === "percentage") {
                                return base * (1 - discVal / 100);
                              }
                              return base - discVal;
                            });

                            return (
                              <tr key={product.id} style={{ borderBottom: "1px solid #e1e3e5" }}>
                                <td style={{ ...tdStyle, fontWeight: 600 }}>
                                  {product.styleName || "Unknown"}
                                </td>
                                <td style={tdStyle}>
                                  <Badge>#{product.ssStyleId}</Badge>
                                </td>
                                <td style={{ ...tdStyle, fontWeight: 700 }}>
                                  ${product.basePrice.toFixed(2)}
                                </td>
                                {tierPrices.map((price, i) => (
                                  <td key={i} style={{
                                    ...tdStyle,
                                    fontWeight: 600,
                                    color: "#008060",
                                    background: i % 2 === 0 ? "#f1fcf8" : undefined,
                                    textAlign: "center",
                                  }}>
                                    ${Math.max(0, price).toFixed(2)}
                                  </td>
                                ))}
                                <td style={{ ...tdStyle, fontSize: "11px", color: "#637381" }}>
                                  {product.lastPriceSync
                                    ? new Date(product.lastPriceSync).toLocaleDateString()
                                    : "Never"}
                                </td>
                                <td style={tdStyle}>
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveProduct(product.id)}
                                    style={{
                                      background: "none", border: "none", cursor: "pointer",
                                      color: "#d72c0d", fontSize: "16px", padding: "4px",
                                    }}
                                    title="Remove product"
                                  >
                                    ✕
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </BlockStack>
              </Card>
            )}

            {/* ═══ TAB 3: SETTINGS ═══ */}
            {selectedTab === 3 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Rule Settings</Text>
                  <Divider />
                  <FormLayout>
                    <TextField
                      label="Rule Name"
                      value={settingsName}
                      onChange={setSettingsName}
                      autoComplete="off"
                    />
                    <TextField
                      label="Description"
                      value={settingsDesc}
                      onChange={setSettingsDesc}
                      multiline={3}
                      autoComplete="off"
                    />
                    <Checkbox
                      label="Enable automatic price sync from SSActiveWear"
                      checked={settingsSyncEnabled}
                      onChange={setSettingsSyncEnabled}
                    />
                    {settingsSyncEnabled && (
                      <TextField
                        label="Sync Interval (days)"
                        type="number"
                        value={settingsSyncDays}
                        onChange={setSettingsSyncDays}
                        helpText="How often to sync base prices from SSActiveWear"
                        autoComplete="off"
                      />
                    )}
                    <Button variant="primary" onClick={saveSettings} loading={isSubmitting}>
                      Save Settings
                    </Button>
                  </FormLayout>
                </BlockStack>
              </Card>
            )}

            {/* ═══ TAB 4: PREVIEW ═══ */}
            {selectedTab === 4 && (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Pricing Preview</Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    This is how extended pricing looks. (Base price: ${sampleBasePrice.toFixed(2)})
                  </Text>
                  <Divider />

                  {/* Preview Table - like SSActiveWear reference */}
                  <div style={{
                    border: "2px solid #e1e3e5",
                    borderRadius: "12px",
                    overflow: "hidden",
                    background: "#fff",
                  }}>
                    <table style={{
                      width: "100%",
                      borderCollapse: "collapse",
                    }}>
                      <thead>
                        <tr>
                          <th style={{
                            padding: "12px 16px",
                            background: "#f9fafb",
                            fontWeight: 700,
                            textAlign: "left",
                            borderBottom: "2px solid #e1e3e5",
                          }}>
                            Quantity
                          </th>
                          {tiers.map((tier, i) => (
                            <th key={i} style={{
                              padding: "12px 16px",
                              background: i === 0 ? "#f0f0f0" : `hsl(${140 + i * 20}, 60%, 95%)`,
                              fontWeight: 700,
                              textAlign: "center",
                              borderBottom: "2px solid #e1e3e5",
                            }}>
                              {tier.maxQty ? `${tier.minQty}-${tier.maxQty}` : `${tier.minQty}+`}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {/* XS-XL Row */}
                        <tr>
                          <td style={{
                            padding: "12px 16px",
                            fontWeight: 600,
                            borderBottom: "1px solid #e1e3e5",
                          }}>
                            XS-XL
                          </td>
                          {tiers.map((tier, i) => {
                            const base = sampleBasePrice;
                            const discVal = parseFloat(tier.discountValue) || 0;
                            const price = tier.discountType === "percentage"
                              ? base * (1 - discVal / 100)
                              : base - discVal;
                            return (
                              <td key={i} style={{
                                padding: "12px 16px",
                                textAlign: "center",
                                fontWeight: 700,
                                fontSize: "16px",
                                color: discVal > 0 ? "#008060" : "#1a1a1a",
                                borderBottom: "1px solid #e1e3e5",
                                background: i === 0 ? "#fafafa" : undefined,
                              }}>
                                ${Math.max(0, price).toFixed(2)}
                              </td>
                            );
                          })}
                        </tr>
                        {/* Size Premium Rows */}
                        {sizePremiums.map((sp, spIndex) => (
                          <tr key={spIndex}>
                            <td style={{
                              padding: "12px 16px",
                              fontWeight: 600,
                              borderBottom: "1px solid #e1e3e5",
                            }}>
                              {sp.sizePattern}
                            </td>
                            {tiers.map((tier, i) => {
                              const premVal = parseFloat(sp.premiumValue) || 0;
                              const basePlusPremium = sp.premiumType === "fixed"
                                ? sampleBasePrice + premVal
                                : sampleBasePrice * (1 + premVal / 100);
                              const discVal = parseFloat(tier.discountValue) || 0;
                              const finalPrice = tier.discountType === "percentage"
                                ? basePlusPremium * (1 - discVal / 100)
                                : basePlusPremium - discVal;
                              return (
                                <td key={i} style={{
                                  padding: "12px 16px",
                                  textAlign: "center",
                                  fontWeight: 600,
                                  color: "#b98900",
                                  borderBottom: "1px solid #e1e3e5",
                                }}>
                                  ${Math.max(0, finalPrice).toFixed(2)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Buy more, save more banner */}
                  <div style={{
                    background: "linear-gradient(135deg, #f0fdf4 0%, #ecfdf5 100%)",
                    border: "1px solid #bbf7d0",
                    borderRadius: "12px",
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                  }}>
                    <span style={{ fontSize: "24px" }}>💰</span>
                    <div>
                      <div style={{ fontWeight: 700, color: "#166534" }}>Buy more, save more!</div>
                      <div style={{ fontSize: "13px", color: "#15803d" }}>
                        Save $ on the price per item when you increase your order quantity.
                      </div>
                    </div>
                  </div>
                </BlockStack>
              </Card>
            )}
          </Box>
        </Tabs>
      </BlockStack>

      {/* Product Picker Modal */}
      <Modal
        open={showProductPicker}
        onClose={() => setShowProductPicker(false)}
        title="Add Products to Rule"
      >
        <Modal.Section>
          <BlockStack gap="400">
            <TextField
              label="Search by Style ID"
              value={productSearch}
              onChange={setProductSearch}
              placeholder="Search..."
              autoComplete="off"
              prefix={<Icon source={SearchIcon} />}
            />

            {filteredAvailable.length === 0 ? (
              <Banner tone="info">
                {availableProducts.length === 0
                  ? "All imported products are already assigned to this rule."
                  : "No products match your search."}
              </Banner>
            ) : (
              <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                <table style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  border: "1px solid #c4cdd5",
                }}>
                  <thead>
                    <tr style={{ background: "#f6f6f7" }}>
                      <th style={thStyle}>Style ID</th>
                      <th style={thStyle}>Shopify Product</th>
                      <th style={{ ...thStyle, width: "80px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAvailable.slice(0, 50).map((product) => (
                      <tr key={product.shopifyProductId} style={{ borderBottom: "1px solid #e1e3e5" }}>
                        <td style={tdStyle}>
                          <Badge>#{product.ssStyleId}</Badge>
                        </td>
                        <td style={{ ...tdStyle, fontSize: "12px", color: "#637381" }}>
                          {product.shopifyProductId.replace("gid://shopify/Product/", "#")}
                        </td>
                        <td style={tdStyle}>
                          <Button
                            size="slim"
                            onClick={() => handleAddProduct(product.shopifyProductId, product.ssStyleId)}
                            loading={isSubmitting}
                          >
                            Add
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredAvailable.length > 50 && (
                  <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                    Showing 50 of {filteredAvailable.length} products. Use search to narrow down.
                  </Text>
                )}
              </div>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

// ─── Styles ────────────────────────────────────────
const thStyle: React.CSSProperties = {
  padding: "10px 12px",
  textAlign: "left",
  fontWeight: 700,
  fontSize: "12px",
  color: "#637381",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  borderBottom: "2px solid #c4cdd5",
  whiteSpace: "nowrap",
};

const tdStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: "13px",
  verticalAlign: "middle",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "120px",
  padding: "6px 8px",
  border: "1px solid #c4cdd5",
  borderRadius: "6px",
  fontSize: "13px",
  outline: "none",
  background: "#fff",
  transition: "border-color 0.2s",
};

const selectStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: "160px",
  padding: "6px 8px",
  border: "1px solid #c4cdd5",
  borderRadius: "6px",
  fontSize: "13px",
  outline: "none",
  background: "#fff",
  cursor: "pointer",
};
