import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Box,
    Button,
    Card,
    Divider,
    InlineStack,
    Layout,
    Modal,
    Page,
    ProgressBar,
    Select,
    Text,
    TextField,
    Thumbnail,
} from "@shopify/polaris";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ImporterService } from "../services/importer.server";
import { SSActiveWearClient, type SSStyle } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

const R2_IMAGE_BASE = "https://img-ssa-e.techifyboost.com";

interface LoaderData {
  style: SSStyle | null;
  products: any[];
  styleId: string | null;
  uploadLocations: Array<{ name: string; label: string; icon: string }>;
  error?: string;
}

interface ActionData {
  success?: boolean;
  error?: string;
  message?: string;
  productId?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);

  const url = new URL(request.url);
  const styleId = url.searchParams.get("styleId");

  if (!styleId) {
    return json<LoaderData>({ style: null, products: [], styleId: null, uploadLocations: [{ name: "full_front", label: "Front", icon: "full_front" }, { name: "full_back", label: "Back", icon: "full_back" }] });
  }

  const client = new SSActiveWearClient();
  try {
    const styles = await client.getStyles();
    const style = styles.find((s: SSStyle) => s.styleID === Number(styleId)) || null;
    const products = await client.getProducts(Number(styleId));

    // Fetch upload locations from DB — default to Front/Back if none configured
    const defaultLocations = [
      { name: "full_front", label: "Front", icon: "full_front" },
      { name: "full_back", label: "Back", icon: "full_back" },
    ];
    let uploadLocations = defaultLocations;
    try {
      const { default: prismaClient } = await import("../db.server");
      // Look for locations for any product matching this style
      const productMap = await prismaClient.productMap.findFirst({
        where: { shop: session.shop, ssStyleId: String(styleId) },
      });
      if (productMap) {
        const dbLocations = await prismaClient.productUploadLocation.findMany({
          where: { shop: session.shop, shopifyProductId: productMap.shopifyProductId },
          orderBy: { sortOrder: "asc" },
        });
        if (dbLocations.length > 0) {
          uploadLocations = dbLocations.map(l => ({ name: l.name, label: l.label, icon: l.iconType }));
        }
      }
    } catch (e) {
      // Use defaults
    }

    return json<LoaderData>({ style, products, styleId, uploadLocations });
  } catch (error) {
    console.error("Failed to fetch style details:", error);
    return json<LoaderData>({ style: null, products: [], styleId, uploadLocations: [{ name: "full_front", label: "Front", icon: "full_front" }, { name: "full_back", label: "Back", icon: "full_back" }], error: "Failed to fetch from SSActiveWear" });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const styleId = formData.get("styleId") as string;
  const markupData = formData.get("markupData") as string;

  if (!styleId) {
    return json<ActionData>({ error: "Style ID required" });
  }

  // Parse markup data
  let sizeMarkups: Record<string, { type: string; value: number }> = {};
  try {
    if (markupData) sizeMarkups = JSON.parse(markupData);
  } catch { /* ignore */ }

  const importer = new ImporterService();
  try {
    const result = await importer.importStyle(admin, Number(styleId), shop, sizeMarkups);
    return json<ActionData>({
      success: true,
      message: result?.message || `Successfully imported style ${styleId}`,
      productId: result?.shopifyProduct?.id,
    });
  } catch (error: any) {
    const errorMessage = error?.message || "Unknown error occurred";
    console.error("Import failed:", errorMessage);

    let userMessage = "Import failed. Please try again.";
    if (errorMessage.includes("timeout")) {
      userMessage = "Import timed out. The product may have too many variants. Please try again.";
    } else if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
      userMessage = "Rate limit reached. Please wait a moment and try again.";
    } else if (errorMessage.includes("not found")) {
      userMessage = "Product not found in SSActiveWear catalog.";
    } else if (errorMessage.includes("permission") || errorMessage.includes("Access denied")) {
      userMessage = "Permission error. Please check app permissions in Shopify.";
    }

    return json<ActionData>({ error: userMessage });
  }
}

export default function ImportPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const submit = useSubmit();
  const nav = useNavigation();
  const shopify = useAppBridge();

  const style = loaderData?.style;
  const products = loaderData?.products || [];
  const styleId = loaderData?.styleId;

  const isImporting = nav.state === "submitting";

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [expandedColors, setExpandedColors] = useState<Record<string, boolean>>({});

  // Markup state: per-size { type: 'percentage'|'fixed', value: number }
  const [sizeMarkups, setSizeMarkups] = useState<Record<string, { type: string; value: string }>>({});

  // Quick apply state
  const [quickType, setQuickType] = useState("percentage");
  const [quickValue, setQuickValue] = useState("");

  // Upload locations from DB
  const uploadLocations = loaderData?.uploadLocations || [{ name: "full_front", label: "Front", icon: "full_front" }, { name: "full_back", label: "Back", icon: "full_back" }];

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show("Product imported successfully!");
      setModalOpen(false);
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  // Group products by color
  const colorGroups: Record<string, any[]> = useMemo(() => {
    const groups: Record<string, any[]> = {};
    products.forEach((product: any) => {
      const colorName = product.colorName || "Unknown";
      if (!groups[colorName]) groups[colorName] = [];
      groups[colorName].push(product);
    });
    return groups;
  }, [products]);

  // Get unique sizes (sorted)
  const uniqueSizes = useMemo(() => {
    const sizeOrder = ['xxs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl', '4xl', '5xl'];
    const sizes = [...new Set(products.map((p: any) => p.sizeName))];
    return sizes.sort((a, b) => {
      const aIdx = sizeOrder.indexOf(a.toLowerCase().trim());
      const bIdx = sizeOrder.indexOf(b.toLowerCase().trim());
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a.localeCompare(b);
    });
  }, [products]);

  const uniqueColors = Object.keys(colorGroups).length;

  // Initialize markups for all sizes
  useEffect(() => {
    if (uniqueSizes.length > 0 && Object.keys(sizeMarkups).length === 0) {
      const initial: Record<string, { type: string; value: string }> = {};
      uniqueSizes.forEach(size => {
        initial[size] = { type: "percentage", value: "0" };
      });
      setSizeMarkups(initial);
    }
  }, [uniqueSizes, sizeMarkups]);

  // Calculate final price for a product with markup
  const getFinalPrice = useCallback((product: any) => {
    const basePrice = product.piecePrice || 0;
    const markup = sizeMarkups[product.sizeName];
    if (!markup || !markup.value || parseFloat(markup.value) === 0) return basePrice;

    const val = parseFloat(markup.value) || 0;
    if (markup.type === "percentage") {
      return basePrice + (basePrice * val / 100);
    }
    return basePrice + val;
  }, [sizeMarkups]);

  const handleMarkupChange = useCallback((size: string, field: "type" | "value", newValue: string) => {
    setSizeMarkups(prev => ({
      ...prev,
      [size]: { ...prev[size], [field]: newValue },
    }));
  }, []);

  const toggleColor = useCallback((colorName: string) => {
    setExpandedColors(prev => ({ ...prev, [colorName]: !prev[colorName] }));
  }, []);

  const handleImport = useCallback(() => {
    // Convert to numeric values for backend
    const markupPayload: Record<string, { type: string; value: number }> = {};
    Object.entries(sizeMarkups).forEach(([size, data]) => {
      markupPayload[size] = { type: data.type, value: parseFloat(data.value) || 0 };
    });

    submit(
      { styleId: styleId || "", markupData: JSON.stringify(markupPayload) },
      { method: "post" }
    );
  }, [sizeMarkups, styleId, submit]);

  if (!styleId) {
    return (
      <Page title="Import Products">
        <TitleBar title="Import Products" />
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">No Style Selected</Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Please browse the catalog and select a product to import.
            </Text>
            <Button url="/app/catalog" variant="primary">Browse Catalog</Button>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  return (
    <Page
      title={style?.title || "Import Product"}
      backAction={{ content: "Catalog", url: "/app/catalog" }}
    >
      <TitleBar title="Import Product" />
      <BlockStack gap="600">
        {/* Success Banner */}
        {actionData?.success && (
          <Banner title="Product imported successfully!" tone="success">
            <p>Your product has been created in Shopify.</p>
          </Banner>
        )}

        {/* Error Banner */}
        {actionData?.error && (
          <Banner title="Import failed" tone="critical">
            <p>{actionData.error}</p>
          </Banner>
        )}

        <Layout>
          {/* Product Preview */}
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="400">
                {/* Image */}
                <Box background="bg-surface-secondary" padding="600" borderRadius="200">
                  <div style={{ display: "flex", justifyContent: "center" }}>
                    <Thumbnail
                      source={style?.styleImage ? SSActiveWearClient.buildImageUrl(style.styleImage, 'medium') : `${R2_IMAGE_BASE}/placeholder.jpg`}
                      alt={style?.title || "Product"}
                      size="large"
                    />
                  </div>
                </Box>

                {/* Info */}
                <BlockStack gap="200">
                  <Badge tone="info">{style?.brandName}</Badge>
                  <Text as="h2" variant="headingLg">{style?.title}</Text>
                  <Text as="p" variant="bodySm" tone="subdued">Style: {style?.partNumber}</Text>
                </BlockStack>

                <Divider />

                {/* Stats */}
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd">Colors</Text>
                    <Badge>{String(uniqueColors)}</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd">Sizes</Text>
                    <Badge>{String(uniqueSizes.length)}</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd">Total SKUs</Text>
                    <Badge>{String(products.length)}</Badge>
                  </InlineStack>
                </BlockStack>

                <Divider />

                {/* Upload Locations */}
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm">Upload Locations</Text>
                  <InlineStack gap="200">
                    {uploadLocations.map(loc => (
                      <Badge key={loc.name} tone="success">{loc.label}</Badge>
                    ))}
                  </InlineStack>
                </BlockStack>

                <Divider />

                {/* Import Button - Opens Modal */}
                <Button
                  variant="primary"
                  fullWidth
                  size="large"
                  onClick={() => setModalOpen(true)}
                  disabled={actionData?.success}
                >
                  Import to Shopify
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* ALL Variants Preview - No limit */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  All Variants ({products.length} SKUs across {uniqueColors} colors)
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Every color and size variant is shown below. Click a color to expand sizes.
                </Text>
                <Divider />

                {/* ALL Color Groups - No slicing */}
                <BlockStack gap="300">
                  {Object.entries(colorGroups).map(([colorName, colorProducts]) => (
                    <Box
                      key={colorName}
                      background="bg-surface-secondary"
                      padding="300"
                      borderRadius="200"
                    >
                      <BlockStack gap="200">
                        <div
                          style={{ cursor: "pointer" }}
                          onClick={() => toggleColor(colorName)}
                          role="button"
                          tabIndex={0}
                        >
                          <InlineStack gap="400" align="space-between" blockAlign="center">
                            <InlineStack gap="300" blockAlign="center">
                              <Thumbnail
                                source={SSActiveWearClient.buildImageUrl(
                                  colorProducts[0]?.colorSwatchImage || colorProducts[0]?.colorFrontImage,
                                  'small'
                                )}
                                alt={colorName}
                                size="small"
                              />
                              <BlockStack gap="050">
                                <Text as="span" variant="bodyMd" fontWeight="semibold">
                                  {colorName}
                                </Text>
                                <Text as="span" variant="bodySm" tone="subdued">
                                  {colorProducts.length} sizes · Click to {expandedColors[colorName] ? "collapse" : "expand"}
                                </Text>
                              </BlockStack>
                            </InlineStack>
                            <InlineStack gap="100" wrap={true}>
                              {colorProducts.map((p: any) => (
                                <Badge key={p.sku} size="small">
                                  {p.sizeName}
                                </Badge>
                              ))}
                            </InlineStack>
                          </InlineStack>
                        </div>

                        {/* Expanded: Show prices per size */}
                        {expandedColors[colorName] && (
                          <Box padding="200">
                            <BlockStack gap="100">
                              {colorProducts.map((p: any) => (
                                <InlineStack key={p.sku} align="space-between" blockAlign="center">
                                  <InlineStack gap="200">
                                    <Badge size="small">{p.sizeName}</Badge>
                                    <Text as="span" variant="bodySm">SKU: {p.sku}</Text>
                                  </InlineStack>
                                  <InlineStack gap="200">
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      SSA: ${(p.piecePrice || 0).toFixed(2)}
                                    </Text>
                                    {getFinalPrice(p) !== p.piecePrice && (
                                      <Badge tone="success">
                                        {`→ $${getFinalPrice(p).toFixed(2)}`}
                                      </Badge>
                                    )}
                                    <Text as="span" variant="bodySm" tone="subdued">
                                      Stock: {p.qty || 0}
                                    </Text>
                                  </InlineStack>
                                </InlineStack>
                              ))}
                            </BlockStack>
                          </Box>
                        )}
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>

      {/* ═══ IMPORT MODAL ═══ */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={`Import: ${style?.title || "Product"}`}
        primaryAction={{
          content: isImporting ? "Importing..." : "Confirm Import",
          loading: isImporting,
          onAction: handleImport,
          disabled: actionData?.success,
        }}
        secondaryActions={[
          { content: "Cancel", onAction: () => setModalOpen(false) },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="600">
            {/* Summary */}
            <Banner tone="info">
              <p>
                <strong>{products.length}</strong> variants across{" "}
                <strong>{uniqueColors}</strong> colors and{" "}
                <strong>{uniqueSizes.length}</strong> sizes will be imported.
                Configure per-size markup below before importing.
              </p>
            </Banner>

            {isImporting && (
              <BlockStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                  Creating product and all variants... This may take a few minutes.
                </Text>
                <ProgressBar progress={75} size="small" />
              </BlockStack>
            )}

            {/* Per-Size Markup Configuration */}
            <Card>
              <BlockStack gap="400">
                <Text as="h3" variant="headingMd">
                  📊 Price Markup by Size
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Set a percentage or fixed amount markup for each size. The SSActiveWear base cost and final Shopify price are shown.
                </Text>
                <Divider />

                {/* Size Markup Table */}
                <div style={{ overflowX: "auto" }}>
                  <table style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "13px",
                  }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                        <th style={{ padding: "8px 12px", textAlign: "left", fontWeight: 600 }}>Size</th>
                        <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600 }}>SSA Cost</th>
                        <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600 }}>Markup Type</th>
                        <th style={{ padding: "8px 12px", textAlign: "center", fontWeight: 600 }}>Markup Value</th>
                        <th style={{ padding: "8px 12px", textAlign: "right", fontWeight: 600, color: "#16a34a" }}>Final Price</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uniqueSizes.map((size, idx) => {
                        const sampleProduct = products.find((p: any) => p.sizeName === size);
                        const basePrice = sampleProduct?.piecePrice || 0;
                        const markup = sizeMarkups[size] || { type: "percentage", value: "0" };
                        const val = parseFloat(markup.value) || 0;
                        const finalPrice = markup.type === "percentage"
                          ? basePrice + (basePrice * val / 100)
                          : basePrice + val;

                        return (
                          <tr
                            key={size}
                            style={{
                              borderBottom: "1px solid #f3f4f6",
                              backgroundColor: idx % 2 === 0 ? "#fafafa" : "#fff",
                            }}
                          >
                            <td style={{ padding: "10px 12px" }}>
                              <Badge size="small" tone="info">{size}</Badge>
                            </td>
                            <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "monospace" }}>
                              ${basePrice.toFixed(2)}
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "center", width: "140px" }}>
                              <Select
                                label=""
                                labelHidden
                                options={[
                                  { label: "%", value: "percentage" },
                                  { label: "$", value: "fixed" },
                                ]}
                                value={markup.type}
                                onChange={(val) => handleMarkupChange(size, "type", val)}
                              />
                            </td>
                            <td style={{ padding: "6px 8px", textAlign: "center", width: "100px" }}>
                              <TextField
                                label=""
                                labelHidden
                                type="number"
                                value={markup.value}
                                onChange={(val) => handleMarkupChange(size, "value", val)}
                                autoComplete="off"
                                min={0}
                              />
                            </td>
                            <td style={{
                              padding: "10px 12px",
                              textAlign: "right",
                              fontFamily: "monospace",
                              fontWeight: 700,
                              color: val > 0 ? "#16a34a" : "#6b7280",
                            }}>
                              ${finalPrice.toFixed(2)}
                              {val > 0 && (
                                <span style={{ fontSize: "10px", color: "#f59e0b", marginLeft: "4px" }}>
                                  (+{markup.type === "percentage" ? `${val}%` : `$${val}`})
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </BlockStack>
            </Card>

            {/* Quick Apply All */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">⚡ Quick Apply to All Sizes</Text>
                <InlineStack gap="300" blockAlign="end">
                  <div style={{ width: "120px" }}>
                    <Select
                      label="Type"
                      options={[
                        { label: "Percentage %", value: "percentage" },
                        { label: "Fixed $", value: "fixed" },
                      ]}
                      value={quickType}
                      onChange={(val) => setQuickType(val)}
                    />
                  </div>
                  <div style={{ width: "100px" }}>
                    <TextField
                      label="Value"
                      type="number"
                      value={quickValue}
                      placeholder="e.g. 15"
                      onChange={(val) => setQuickValue(val)}
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    onClick={() => {
                      const newMarkups: Record<string, { type: string; value: string }> = {};
                      uniqueSizes.forEach(size => {
                        newMarkups[size] = { type: quickType, value: quickValue || "0" };
                      });
                      setSizeMarkups(newMarkups);
                    }}
                  >
                    Apply to All
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Full Variant Preview in Modal */}
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingSm">
                  📋 All {products.length} Variants Preview
                </Text>
                <div style={{ maxHeight: "300px", overflowY: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ borderBottom: "2px solid #e5e7eb", position: "sticky", top: 0, background: "#fff" }}>
                        <th style={{ padding: "6px 8px", textAlign: "left" }}>Color</th>
                        <th style={{ padding: "6px 8px", textAlign: "left" }}>Size</th>
                        <th style={{ padding: "6px 8px", textAlign: "left" }}>SKU</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>SSA Cost</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Shopify Price</th>
                        <th style={{ padding: "6px 8px", textAlign: "right" }}>Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {products.map((p: any, idx: number) => {
                        const final = getFinalPrice(p);
                        return (
                          <tr key={p.sku || idx} style={{
                            borderBottom: "1px solid #f3f4f6",
                            backgroundColor: idx % 2 === 0 ? "#fafafa" : "#fff",
                          }}>
                            <td style={{ padding: "5px 8px" }}>{p.colorName}</td>
                            <td style={{ padding: "5px 8px" }}>
                              <Badge size="small">{p.sizeName}</Badge>
                            </td>
                            <td style={{ padding: "5px 8px", fontFamily: "monospace", fontSize: "11px" }}>
                              {p.sku}
                            </td>
                            <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "monospace" }}>
                              ${(p.piecePrice || 0).toFixed(2)}
                            </td>
                            <td style={{
                              padding: "5px 8px",
                              textAlign: "right",
                              fontFamily: "monospace",
                              fontWeight: final !== p.piecePrice ? 700 : 400,
                              color: final !== p.piecePrice ? "#16a34a" : "#6b7280",
                            }}>
                              ${final.toFixed(2)}
                            </td>
                            <td style={{ padding: "5px 8px", textAlign: "right" }}>
                              {p.qty || 0}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </BlockStack>
            </Card>

            {/* Upload Locations Section */}
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">🎨 Upload Locations (for custom artwork)</Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  These locations will be available for customers to upload designs when ordering this product.
                </Text>
                <InlineStack gap="200">
                  {uploadLocations.map(loc => (
                    <Badge key={loc.name} tone="success">{loc.label}</Badge>
                  ))}
                </InlineStack>
              </BlockStack>
            </Card>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}
