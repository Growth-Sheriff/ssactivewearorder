import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
    Badge,
    BlockStack,
    Box,
    Button,
    Card,
    Checkbox,
    Divider,
    EmptyState,
    InlineGrid,
    InlineStack,
    Page,
    Text,
    TextField,
    Thumbnail
} from "@shopify/polaris";
import { useCallback, useEffect, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

/* ─── Upload location type definitions ─── */
const LOCATION_PRESETS = [
  { name: "full_front",    label: "Full Front",    iconType: "full_front" },
  { name: "full_back",     label: "Full Back",     iconType: "full_back" },
  { name: "left_chest",    label: "Left Chest",    iconType: "left_chest" },
  { name: "right_chest",   label: "Right Chest",   iconType: "right_chest" },
  { name: "left_sleeve",   label: "Left Sleeve",   iconType: "left_sleeve" },
  { name: "right_sleeve",  label: "Right Sleeve",  iconType: "right_sleeve" },
];

/* ─── SVG icon map – t-shirt visuals with highlighted print zones ─── */
function LocationIcon({ iconType, size = 64 }: { iconType: string; size?: number }) {
  const tee = (highlight: React.ReactNode) => (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* T-shirt body */}
      <path d="M30 25 L20 30 L10 45 L22 50 L25 40 L25 85 L75 85 L75 40 L78 50 L90 45 L80 30 L70 25 L62 20 L38 20 L30 25Z"
            fill="#f1f5f9" stroke="#64748b" strokeWidth="2" strokeLinejoin="round"/>
      {/* Collar */}
      <path d="M38 20 Q50 28 62 20" fill="none" stroke="#64748b" strokeWidth="2"/>
      {highlight}
    </svg>
  );

  switch (iconType) {
    case "full_front":
      return tee(<rect x="30" y="35" width="40" height="40" rx="4" fill="#5eead4" fillOpacity="0.5" stroke="#14b8a6" strokeWidth="1.5"/>);
    case "full_back":
      return tee(<>
        <rect x="30" y="35" width="40" height="40" rx="4" fill="#818cf8" fillOpacity="0.5" stroke="#6366f1" strokeWidth="1.5"/>
        <line x1="40" y1="45" x2="60" y2="45" stroke="#6366f1" strokeWidth="1" strokeDasharray="3 2"/>
        <line x1="40" y1="55" x2="60" y2="55" stroke="#6366f1" strokeWidth="1" strokeDasharray="3 2"/>
        <line x1="40" y1="65" x2="55" y2="65" stroke="#6366f1" strokeWidth="1" strokeDasharray="3 2"/>
      </>);
    case "left_chest":
      return tee(<rect x="30" y="35" width="16" height="14" rx="3" fill="#5eead4" fillOpacity="0.6" stroke="#14b8a6" strokeWidth="1.5"/>);
    case "right_chest":
      return tee(<rect x="54" y="35" width="16" height="14" rx="3" fill="#fb923c" fillOpacity="0.5" stroke="#f97316" strokeWidth="1.5"/>);
    case "left_sleeve":
      return tee(<rect x="12" y="32" width="14" height="12" rx="3" fill="#a78bfa" fillOpacity="0.5" stroke="#8b5cf6" strokeWidth="1.5" transform="rotate(-15 19 38)"/>);
    case "right_sleeve":
      return tee(<rect x="74" y="32" width="14" height="12" rx="3" fill="#f472b6" fillOpacity="0.5" stroke="#ec4899" strokeWidth="1.5" transform="rotate(15 81 38)"/>);
    default:
      return tee(<rect x="35" y="40" width="30" height="30" rx="4" fill="#94a3b8" fillOpacity="0.3" stroke="#94a3b8" strokeWidth="1.5"/>);
  }
}

/* ─── Loader: Fetch all imported products + their upload locations ─── */
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Ensure metafield definition exists for storefront access (idempotent)
  try {
    await admin.graphql(`
      mutation CreateMetafieldDefinition {
        metafieldDefinitionCreate(definition: {
          name: "Upload Locations"
          namespace: "ss_custom"
          key: "upload_locations"
          type: "json"
          ownerType: PRODUCT
          access: {
            storefront: PUBLIC_READ
          }
        }) {
          createdDefinition { id }
          userErrors { message }
        }
      }
    `);
  } catch (e) {
    // Definition likely already exists, ignore
  }

  // Fix any products with empty shop values (legacy data)
  try {
    await prisma.productMap.updateMany({
      where: { shop: "" },
      data: { shop },
    });
  } catch (e) {}

  const products = await prisma.productMap.findMany({
    where: { shop },
    select: {
      id: true,
      shopifyProductId: true,
      ssStyleId: true,
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch product details (title, image, vendor) from Shopify GraphQL in batches
  const productIds = products.map(p => p.shopifyProductId);
  const shopifyProducts = new Map<string, { title: string; image: string | null; vendor: string }>();

  // Batch fetch in groups of 50
  for (let i = 0; i < productIds.length; i += 50) {
    const batch = productIds.slice(i, i + 50);
    const idsQuery = batch.map(id => `"${id}"`).join(",");
    try {
      const response = await admin.graphql(`
        query getProducts {
          nodes(ids: [${idsQuery}]) {
            ... on Product {
              id
              title
              vendor
              featuredMedia {
                preview {
                  image {
                    url
                  }
                }
              }
            }
          }
        }
      `);
      const data = await response.json();
      if (data.data?.nodes) {
        for (const node of data.data.nodes) {
          if (node?.id) {
            shopifyProducts.set(node.id, {
              title: node.title || "Untitled",
              image: node.featuredMedia?.preview?.image?.url || null,
              vendor: node.vendor || "Unknown",
            });
          }
        }
      }
    } catch (e) {
      console.error("Shopify product fetch error:", e);
    }
  }

  // Get product-level upload locations
  let productLocations: any[] = [];
  try {
    productLocations = await (prisma as any).productUploadLocation.findMany({
      where: { shop },
      orderBy: { sortOrder: "asc" },
    });
  } catch (e) {}

  // Map locations by productId
  const locationsByProduct = new Map<string, any[]>();
  for (const loc of productLocations) {
    if (!locationsByProduct.has(loc.shopifyProductId)) {
      locationsByProduct.set(loc.shopifyProductId, []);
    }
    locationsByProduct.get(loc.shopifyProductId)!.push(loc);
  }

  const enrichedProducts = products
    .map(p => {
      const shopifyData = shopifyProducts.get(p.shopifyProductId);
      return {
        id: p.id,
        shopifyProductId: p.shopifyProductId,
        ssStyleId: p.ssStyleId,
        styleName: shopifyData?.title || `Style ${p.ssStyleId}`,
        brandName: shopifyData?.vendor || "Unknown",
        styleImage: shopifyData?.image || null,
        existsInShopify: !!shopifyData,
        uploadLocations: locationsByProduct.get(p.shopifyProductId) || [],
      };
    })
    // Active (existing in Shopify) products first, deleted ones at end
    .sort((a, b) => {
      if (a.existsInShopify && !b.existsInShopify) return -1;
      if (!a.existsInShopify && b.existsInShopify) return 1;
      return 0;
    });

  return json({ products: enrichedProducts, presets: LOCATION_PRESETS, shop });
}

/* ─── Action: Save/update upload locations per product ─── */
export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  if (actionType === "save_locations") {
    const shopifyProductId = formData.get("shopifyProductId") as string;
    const locations = JSON.parse(formData.get("locations") as string) as Array<{
      name: string; label: string; iconType: string;
    }>;

    try {
      // Delete existing locations for this product
      await (prisma as any).productUploadLocation.deleteMany({
        where: { shop, shopifyProductId },
      });

      // Create new locations
      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        await (prisma as any).productUploadLocation.create({
          data: {
            shop,
            shopifyProductId,
            name: loc.name,
            label: loc.label,
            iconType: loc.iconType,
            sortOrder: i,
          },
        });
      }

      // Sync to Shopify product metafield so extension can read it
      try {
        await admin.graphql(`
          mutation setProductUploadLocations($metafields: [MetafieldsSetInput!]!) {
            metafieldsSet(metafields: $metafields) {
              metafields { id key value }
              userErrors { field message }
            }
          }
        `, {
          variables: {
            metafields: [{
              ownerId: shopifyProductId,
              namespace: "ss_custom",
              key: "upload_locations",
              type: "json",
              value: JSON.stringify(locations.map(l => ({
                name: l.name,
                label: l.label,
                icon: l.iconType,
              }))),
            }],
          },
        });
      } catch (metaErr) {
        console.error("Metafield sync failed:", metaErr);
      }

      return json({ success: true, message: `${locations.length} upload locations saved for product`, productId: shopifyProductId });
    } catch (e: any) {
      return json({ success: false, message: e.message });
    }
  }

  if (actionType === "bulk_apply") {
    const productIds = JSON.parse(formData.get("productIds") as string) as string[];
    const locations = JSON.parse(formData.get("locations") as string) as Array<{
      name: string; label: string; iconType: string;
    }>;

    let updated = 0;
    for (const pid of productIds) {
      try {
        await (prisma as any).productUploadLocation.deleteMany({
          where: { shop, shopifyProductId: pid },
        });
        for (let i = 0; i < locations.length; i++) {
          await (prisma as any).productUploadLocation.create({
            data: {
              shop,
              shopifyProductId: pid,
              name: locations[i].name,
              label: locations[i].label,
              iconType: locations[i].iconType,
              sortOrder: i,
            },
          });
        }
        // Sync metafield
        try {
          await admin.graphql(`
            mutation setProductUploadLocations($metafields: [MetafieldsSetInput!]!) {
              metafieldsSet(metafields: $metafields) {
                metafields { id }
                userErrors { message }
              }
            }
          `, {
            variables: {
              metafields: [{
                ownerId: pid,
                namespace: "ss_custom",
                key: "upload_locations",
                type: "json",
                value: JSON.stringify(locations.map(l => ({
                  name: l.name, label: l.label, icon: l.iconType,
                }))),
              }],
            },
          });
        } catch (e) {}
        updated++;
      } catch (e) {}
    }

    return json({ success: true, message: `Upload locations applied to ${updated} products` });
  }

  if (actionType === "cleanup_deleted") {
    // Remove ProductMap entries that no longer exist in Shopify
    const deletedIds = JSON.parse(formData.get("deletedIds") as string) as string[];
    let removed = 0;
    for (const pid of deletedIds) {
      try {
        await (prisma as any).productUploadLocation.deleteMany({ where: { shop, shopifyProductId: pid } });
        await prisma.productMap.deleteMany({ where: { shop, shopifyProductId: pid } });
        removed++;
      } catch (e) {}
    }
    return json({ success: true, message: `Cleaned up ${removed} deleted products` });
  }

  return json({ success: false, message: "Unknown action" });
}

/* ─── Product Upload Location Editor Modal ─── */
function ProductLocationEditor({
  product,
  presets,
  onSave,
  isSaving,
}: {
  product: any;
  presets: typeof LOCATION_PRESETS;
  onSave: (productId: string, locations: any[]) => void;
  isSaving: boolean;
}) {
  const [selectedLocations, setSelectedLocations] = useState<Map<string, boolean>>(() => {
    const map = new Map<string, boolean>();
    for (const loc of product.uploadLocations) {
      map.set(loc.name, true);
    }
    return map;
  });
  const [isOpen, setIsOpen] = useState(false);

  const toggleLocation = (name: string) => {
    const newMap = new Map(selectedLocations);
    if (newMap.has(name)) newMap.delete(name);
    else newMap.set(name, true);
    setSelectedLocations(newMap);
  };

  const handleSave = () => {
    const locs = presets.filter(p => selectedLocations.has(p.name));
    onSave(product.shopifyProductId, locs);
    setIsOpen(false);
  };

  const activeCount = product.uploadLocations.length;

  return (
    <div style={{ opacity: product.existsInShopify ? 1 : 0.5 }}>
      <InlineStack gap="300" blockAlign="center" wrap={false}>
        <Thumbnail source={product.styleImage || ""} alt={product.styleName} size="small" />
        <BlockStack gap="100">
          <Text as="span" variant="bodyMd" fontWeight="bold">{product.styleName}</Text>
          <Text as="span" variant="bodySm" tone="subdued">{product.brandName} · {product.ssStyleId}</Text>
        </BlockStack>
        <div style={{ marginLeft: "auto" }}>
          <InlineStack gap="200" blockAlign="center">
            {!product.existsInShopify ? (
              <Badge tone="critical">Deleted from Shopify</Badge>
            ) : activeCount > 0 ? (
              <Badge tone="success">{`${activeCount} location${activeCount !== 1 ? "s" : ""}`}</Badge>
            ) : (
              <Badge tone="attention">No locations</Badge>
            )}
            {product.existsInShopify && (
              <Button size="slim" onClick={() => setIsOpen(!isOpen)}>
                {isOpen ? "Close" : "Configure"}
              </Button>
            )}
          </InlineStack>
        </div>
      </InlineStack>

      {isOpen && (
        <Box paddingBlockStart="400" paddingBlockEnd="200">
          <BlockStack gap="300">
            <Text as="p" variant="bodySm" tone="subdued">
              Select print areas for this product. These will appear on the product page for customers to upload their designs.
            </Text>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
              {presets.map((preset) => {
                const isActive = selectedLocations.has(preset.name);
                return (
                  <div
                    key={preset.name}
                    onClick={() => toggleLocation(preset.name)}
                    style={{
                      border: `2px solid ${isActive ? "#14b8a6" : "#e2e8f0"}`,
                      borderRadius: "12px",
                      padding: "16px",
                      textAlign: "center",
                      cursor: "pointer",
                      background: isActive ? "#f0fdfa" : "#ffffff",
                      transition: "all 0.2s ease",
                      boxShadow: isActive ? "0 0 0 3px rgba(20,184,166,0.15)" : "none",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px" }}>
                      <LocationIcon iconType={preset.iconType} size={56} />
                    </div>
                    <Text as="p" variant="bodySm" fontWeight={isActive ? "bold" : "regular"}>
                      {preset.label}
                    </Text>
                  </div>
                );
              })}
            </div>
            <InlineStack align="end">
              <Button variant="primary" onClick={handleSave} loading={isSaving}>
                Save Locations
              </Button>
            </InlineStack>
          </BlockStack>
        </Box>
      )}
    </div>
  );
}

/* ─── Main Page Component ─── */
export default function UploadLocationsPage() {
  const { products, presets, shop } = useLoaderData<typeof loader>();
  const actionData = useActionData<any>();
  const submit = useSubmit();
  const nav = useNavigation();
  const shopify = useAppBridge();
  const isSaving = nav.state === "submitting";

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSelections, setBulkSelections] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    if (actionData?.success) shopify.toast.show(actionData.message);
    else if (actionData?.success === false) shopify.toast.show(actionData.message, { isError: true });
  }, [actionData, shopify]);

  const handleSaveLocations = useCallback((productId: string, locations: any[]) => {
    const formData = new FormData();
    formData.set("action", "save_locations");
    formData.set("shopifyProductId", productId);
    formData.set("locations", JSON.stringify(locations));
    submit(formData, { method: "post" });
  }, [submit]);

  const handleBulkApply = useCallback(() => {
    const locs = presets.filter(p => bulkSelections.has(p.name));
    const formData = new FormData();
    formData.set("action", "bulk_apply");
    formData.set("productIds", JSON.stringify(selectedProducts));
    formData.set("locations", JSON.stringify(locs));
    submit(formData, { method: "post" });
    setBulkOpen(false);
    setSelectedProducts([]);
  }, [presets, bulkSelections, selectedProducts, submit]);

  const filteredProducts = products.filter((p: any) =>
    p.styleName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.brandName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    p.ssStyleId.includes(searchQuery)
  );

  const toggleBulkLoc = (name: string) => {
    const m = new Map(bulkSelections);
    if (m.has(name)) m.delete(name); else m.set(name, true);
    setBulkSelections(m);
  };

  const productsWithLocations = products.filter((p: any) => p.uploadLocations.length > 0).length;
  const totalLocations = products.reduce((sum: number, p: any) => sum + p.uploadLocations.length, 0);
  const deletedProducts = products.filter((p: any) => !p.existsInShopify);
  const activeProducts = products.filter((p: any) => p.existsInShopify);

  const handleCleanup = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "cleanup_deleted");
    formData.set("deletedIds", JSON.stringify(deletedProducts.map((p: any) => p.shopifyProductId)));
    submit(formData, { method: "post" });
  }, [deletedProducts, submit]);

  return (
    <Page title="Upload Locations" backAction={{ url: "/app" }}
      primaryAction={{ content: "Bulk Apply", disabled: selectedProducts.length === 0, onAction: () => setBulkOpen(true) }}
      secondaryActions={deletedProducts.length > 0 ? [{ content: `Clean Up ${deletedProducts.length} Deleted`, onAction: handleCleanup, destructive: true }] : []}>
      <TitleBar title="Upload Locations" />
      <BlockStack gap="600">
        {/* Stats */}
        <InlineGrid columns={3} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Active Products</Text>
              <Text as="p" variant="heading2xl">{String(activeProducts.length)}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">With Locations</Text>
              <Text as="p" variant="heading2xl">{String(productsWithLocations)}</Text>
            </BlockStack>
          </Card>
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Total Locations</Text>
              <Text as="p" variant="heading2xl">{String(totalLocations)}</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Bulk Apply Panel */}
        {bulkOpen && selectedProducts.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">
                  Bulk Apply to {selectedProducts.length} Products
                </Text>
                <Button variant="plain" onClick={() => setBulkOpen(false)}>Cancel</Button>
              </InlineStack>
              <Divider />
              <Text as="p" variant="bodySm" tone="subdued">
                Select the print areas you want to apply to all selected products:
              </Text>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px" }}>
                {presets.map(preset => {
                  const isActive = bulkSelections.has(preset.name);
                  return (
                    <div
                      key={preset.name}
                      onClick={() => toggleBulkLoc(preset.name)}
                      style={{
                        border: `2px solid ${isActive ? "#14b8a6" : "#e2e8f0"}`,
                        borderRadius: "12px",
                        padding: "16px",
                        textAlign: "center",
                        cursor: "pointer",
                        background: isActive ? "#f0fdfa" : "#ffffff",
                        transition: "all 0.2s ease",
                        boxShadow: isActive ? "0 0 0 3px rgba(20,184,166,0.15)" : "none",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "center", marginBottom: "8px" }}>
                        <LocationIcon iconType={preset.iconType} size={48} />
                      </div>
                      <Text as="p" variant="bodySm" fontWeight={isActive ? "bold" : "regular"}>
                        {preset.label}
                      </Text>
                    </div>
                  );
                })}
              </div>
              <InlineStack align="end">
                <Button variant="primary" tone="success" onClick={handleBulkApply} loading={isSaving}>
                  Apply to {String(selectedProducts.length)} Products
                </Button>
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Product List */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between">
              <Text as="h2" variant="headingMd">Imported Products</Text>
              <div style={{ width: "300px" }}>
                <TextField
                  label=""
                  labelHidden
                  placeholder="Search products..."
                  value={searchQuery}
                  onChange={setSearchQuery}
                  autoComplete="off"
                  clearButton
                  onClearButtonClick={() => setSearchQuery("")}
                />
              </div>
            </InlineStack>
            <Divider />

            {filteredProducts.length === 0 ? (
              <EmptyState heading="No products found" image="">
                <p>Import products from the catalog first, then configure upload locations here.</p>
              </EmptyState>
            ) : (
              <BlockStack gap="400">
                {/* Select All */}
                <Checkbox
                  label={`Select all ${filteredProducts.length} products`}
                  checked={selectedProducts.length === filteredProducts.length && filteredProducts.length > 0}
                  onChange={(checked) => {
                    if (checked) {
                      setSelectedProducts(filteredProducts.map((p: any) => p.shopifyProductId));
                    } else {
                      setSelectedProducts([]);
                    }
                  }}
                />
                <Divider />

                {filteredProducts.map((product: any) => (
                  <div key={product.id}>
                    <InlineStack gap="300" blockAlign="start" wrap={false}>
                      <Checkbox
                        label=""
                        labelHidden
                        checked={selectedProducts.includes(product.shopifyProductId)}
                        onChange={(checked) => {
                          if (checked) {
                            setSelectedProducts([...selectedProducts, product.shopifyProductId]);
                          } else {
                            setSelectedProducts(selectedProducts.filter(id => id !== product.shopifyProductId));
                          }
                        }}
                      />
                      <div style={{ flex: 1 }}>
                        <ProductLocationEditor
                          product={product}
                          presets={presets}
                          onSave={handleSaveLocations}
                          isSaving={isSaving}
                        />
                      </div>
                    </InlineStack>
                    <Box paddingBlockStart="300"><Divider /></Box>
                  </div>
                ))}
              </BlockStack>
            )}
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
