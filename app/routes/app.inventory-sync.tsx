import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Box,
    Button,
    Card,
    DataTable,
    Divider,
    EmptyState,
    Icon,
    InlineGrid,
    InlineStack,
    Layout,
    Page,
    Text
} from "@shopify/polaris";
import {
    CheckCircleIcon,
    RefreshIcon,
    XCircleIcon
} from "@shopify/polaris-icons";
import { useCallback } from "react";
import prisma from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

interface SyncLog {
  id: string;
  syncType: string;
  status: string;
  productsTotal: number;
  productsUpdated: number;
  productsFailed: number;
  errors: string | null;
  startedAt: string;
  completedAt: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get sync logs
  const syncLogs = await prisma.inventorySyncLog.findMany({
    where: { shop },
    orderBy: { startedAt: 'desc' },
    take: 10,
  });

  // Get imported products count
  const productsCount = await prisma.productMap.count({ where: { shop } });

  // Get last sync info
  const lastSync = syncLogs[0];

  // Check if sync is currently running
  const runningSync = await prisma.inventorySyncLog.findFirst({
    where: { shop, status: 'running' },
  });

  // Get inventory stats from recent products
  const recentProducts = await prisma.productMap.findMany({
    where: { shop },
    take: 10,
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      ssStyleId: true,
      shopifyProductId: true,
      updatedAt: true,
    },
  });

  // Get style details for recent products
  const styleIds = recentProducts.map(p => parseInt(p.ssStyleId)).filter(id => !isNaN(id));
  const styleDetails = await prisma.sSStyleCache.findMany({
    where: { styleId: { in: styleIds } },
    select: { styleId: true, styleName: true, brandName: true },
  });
  const styleMap = new Map(styleDetails.map(s => [s.styleId.toString(), s]));

  return json({
    syncLogs: syncLogs.map((l): SyncLog => ({
      ...l,
      startedAt: l.startedAt.toISOString(),
      completedAt: l.completedAt?.toISOString() || null,
    })),
    productsCount,
    lastSync: lastSync ? {
      status: lastSync.status,
      productsUpdated: lastSync.productsUpdated,
      startedAt: lastSync.startedAt.toISOString(),
    } : null,
    isRunning: !!runningSync,
    recentProducts: recentProducts.map(p => {
      const style = styleMap.get(p.ssStyleId);
      return {
        id: p.id,
        ssStyleId: p.ssStyleId,
        shopifyProductId: p.shopifyProductId,
        styleName: style?.styleName || `Style ${p.ssStyleId}`,
        brandName: style?.brandName || 'Unknown',
        lastUpdated: p.updatedAt.toISOString(),
      };
    }),
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "syncAll" || action === "syncIncremental") {
    const syncType = action === "syncAll" ? "full" : "incremental";

    // Create sync log
    const syncLog = await prisma.inventorySyncLog.create({
      data: {
        shop,
        syncType,
        status: 'running',
      },
    });

    // Get products to sync
    const products = await prisma.productMap.findMany({
      where: { shop },
      select: {
        id: true,
        ssStyleId: true,
        shopifyProductId: true,
      },
    });

    if (products.length === 0) {
      await prisma.inventorySyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });
      return json({ success: true, message: "No products to sync" });
    }

    let updated = 0;
    let failed = 0;
    const errors: string[] = [];

    // Initialize SSActiveWear client
    const ssClient = new SSActiveWearClient();

    // Get first location once (for all products)
    let locationId: string | null = null;
    try {
      const locationsResponse = await admin.graphql(`
        query getLocations {
          locations(first: 1) {
            nodes { id }
          }
        }
      `);
      const locData = await locationsResponse.json();
      locationId = locData.data?.locations?.nodes?.[0]?.id;
    } catch (e) {
      console.error("[InventorySync] Failed to get location:", e);
    }

    if (!locationId) {
      await prisma.inventorySyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: 'failed',
          errors: "No location found in Shopify",
          completedAt: new Date(),
        },
      });
      return json({ success: false, message: "No location found in Shopify" });
    }

    // Sync each product
    for (const product of products) {
      try {
        const styleId = parseInt(product.ssStyleId);
        if (isNaN(styleId)) continue;

        // Get inventory from SSActiveWear
        const inventory = await ssClient.getInventoryByStyle(styleId);

        if (inventory && Array.isArray(inventory)) {
          // Build SKU -> quantity map from SS inventory
          const inventoryBySku = new Map<string, number>();
          for (const inv of inventory) {
            const totalQty = inv.warehouses?.reduce((sum, wh) => sum + (wh.qty || 0), 0) || 0;
            inventoryBySku.set(inv.sku, totalQty);
          }

          // Get Shopify variants directly (no need for VariantMap)
          const variantResponse = await admin.graphql(`
            query getProductVariants($productId: ID!) {
              product(id: $productId) {
                variants(first: 100) {
                  edges {
                    node {
                      id
                      sku
                      inventoryItem {
                        id
                      }
                    }
                  }
                }
              }
            }
          `, { variables: { productId: product.shopifyProductId } });

          const variantData = await variantResponse.json();
          const variants = variantData.data?.product?.variants?.edges || [];

          // Build quantities array
          const quantities: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = [];

          for (const edge of variants) {
            const variant = edge.node;
            const sku = variant.sku;
            const inventoryItemId = variant.inventoryItem?.id;

            if (sku && inventoryItemId && inventoryBySku.has(sku)) {
              quantities.push({
                inventoryItemId,
                locationId,
                quantity: inventoryBySku.get(sku)!,
              });
            }
          }

          // Update inventory in batches of 20
          if (quantities.length > 0) {
            for (let i = 0; i < quantities.length; i += 20) {
              const batch = quantities.slice(i, i + 20);
              const updateResponse = await admin.graphql(`
                mutation setInventory($input: InventorySetQuantitiesInput!) {
                  inventorySetQuantities(input: $input) {
                    userErrors { field message }
                  }
                }
              `, {
                variables: {
                  input: {
                    name: "available",
                    reason: "correction",
                    ignoreCompareQuantity: true,
                    quantities: batch,
                  }
                }
              });

              const updateData = await updateResponse.json();
              if (updateData.data?.inventorySetQuantities?.userErrors?.length > 0) {
                console.error(`[InventorySync] Batch errors:`, updateData.data.inventorySetQuantities.userErrors);
              }
            }
          }

          // Update ProductMap timestamp
          await prisma.productMap.update({
            where: { id: product.id },
            data: { updatedAt: new Date() },
          });

          updated++;
        }
      } catch (error) {
        failed++;
        errors.push(`Style ${product.ssStyleId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        console.error(`[InventorySync] Failed to sync style ${product.ssStyleId}:`, error);
      }
    }

    // Update sync log
    await prisma.inventorySyncLog.update({
      where: { id: syncLog.id },
      data: {
        status: 'completed',
        productsTotal: products.length,
        productsUpdated: updated,
        productsFailed: failed,
        errors: errors.length > 0 ? JSON.stringify(errors) : null,
        completedAt: new Date(),
      },
    });

    return json({
      success: true,
      message: `Sync completed: ${updated} updated, ${failed} failed`,
    });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function InventorySyncPage() {
  const { syncLogs, productsCount, lastSync, isRunning, recentProducts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const isLoading = navigation.state === "submitting";

  const handleSync = useCallback((type: 'syncAll' | 'syncIncremental') => {
    const formData = new FormData();
    formData.set("action", type);
    submit(formData, { method: "POST" });
  }, [submit]);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const getStatusBadge = (status: string): React.ReactNode => {
    switch (status) {
      case 'completed':
        return <Badge tone="success"><InlineStack gap="100"><Icon source={CheckCircleIcon} />Completed</InlineStack></Badge>;
      case 'running':
        return <Badge tone="info"><InlineStack gap="100"><Icon source={RefreshIcon} />Running</InlineStack></Badge>;
      case 'failed':
        return <Badge tone="critical"><InlineStack gap="100"><Icon source={XCircleIcon} />Failed</InlineStack></Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const logRows: React.ReactNode[][] = syncLogs.map(log => [
    log.syncType === 'full' ? 'Full Sync' : 'Incremental',
    getStatusBadge(log.status),
    `${log.productsUpdated}/${log.productsTotal}`,
    log.productsFailed > 0 ? <Badge tone="critical">{String(log.productsFailed)}</Badge> : '0',
    formatDate(log.startedAt),
    log.completedAt ? formatDate(log.completedAt) : '—',
    log.errors ? (
      <Text as="span" variant="bodySm" tone="critical" breakWord>
        {(() => {
          try {
            const parsed = JSON.parse(log.errors);
            return Array.isArray(parsed) ? parsed.slice(0, 3).join(', ') + (parsed.length > 3 ? '...' : '') : log.errors;
          } catch { return log.errors.slice(0, 100); }
        })()}
      </Text>
    ) : '—',
  ]);

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Inventory Sync"
      subtitle="Keep stock levels synchronized with SSActiveWear"
    >
      <TitleBar title="Inventory Sync" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Stats */}
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Products to Sync</Text>
              <Text as="p" variant="heading2xl">{productsCount}</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Last Sync</Text>
              <Text as="p" variant="headingLg">
                {lastSync ? formatDate(lastSync.startedAt) : 'Never'}
              </Text>
              {lastSync && getStatusBadge(lastSync.status)}
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <Text as="h3" variant="headingSm" tone="subdued">Last Updated</Text>
              <Text as="p" variant="headingLg">
                {lastSync ? `${lastSync.productsUpdated} products` : '0 products'}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Sync Actions */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Sync Options</Text>
            <Divider />
            <Layout>
              <Layout.Section variant="oneHalf">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Full Sync</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Update all imported products with current SSActiveWear inventory levels
                    </Text>
                    <Button
                      variant="primary"
                      onClick={() => handleSync('syncAll')}
                      loading={isLoading || isRunning}
                      disabled={productsCount === 0}
                      icon={RefreshIcon}
                    >
                      Start Full Sync
                    </Button>
                  </BlockStack>
                </Card>
              </Layout.Section>
              <Layout.Section variant="oneHalf">
                <Card>
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingSm">Incremental Sync</Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Only update products that have changed since the last sync
                    </Text>
                    <Button
                      onClick={() => handleSync('syncIncremental')}
                      loading={isLoading || isRunning}
                      disabled={productsCount === 0}
                      icon={RefreshIcon}
                    >
                      Start Incremental Sync
                    </Button>
                  </BlockStack>
                </Card>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Card>

        {/* Recent Products */}
        {recentProducts.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Recently Updated Products</Text>
              <Divider />
              <BlockStack gap="200">
                {recentProducts.map(p => (
                  <Box key={p.id} padding="200" background="bg-surface-secondary" borderRadius="100">
                    <InlineStack align="space-between">
                      <BlockStack gap="050">
                        <Text as="span" variant="bodyMd" fontWeight="semibold">{p.styleName}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">{p.brandName}</Text>
                      </BlockStack>
                      <BlockStack gap="050" inlineAlign="end">
                        <Text as="span" variant="bodySm" tone="subdued">
                          Updated: {formatDate(p.lastUpdated)}
                        </Text>
                        <Badge size="small">{`Style #${p.ssStyleId}`}</Badge>
                      </BlockStack>
                    </InlineStack>
                  </Box>
                ))}
              </BlockStack>
            </BlockStack>
          </Card>
        )}

        {/* Sync History */}
        {syncLogs.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Sync History</Text>
              <Divider />
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text']}
                headings={['Type', 'Status', 'Updated', 'Failed', 'Started', 'Completed', 'Errors']}
                rows={logRows}
              />
            </BlockStack>
          </Card>
        )}

        {productsCount === 0 && (
          <Card>
            <EmptyState
              heading="No products to sync"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Import Products",
                url: "/app/products",
              }}
            >
              <p>Import products from SSActiveWear first, then sync inventory.</p>
            </EmptyState>
          </Card>
        )}

        {/* Info */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">💡 How Inventory Sync Works</Text>
            <Divider />
            <Text as="p" variant="bodySm" tone="subdued">
              • <strong>Full Sync</strong> checks inventory levels for all imported products and updates Shopify
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              • <strong>Incremental Sync</strong> is faster as it only checks products that may have changed
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              • Set up automatic sync in the Scheduled Jobs page to keep inventory always current
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              • SSActiveWear inventory is updated in real-time; sync frequency depends on your needs
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
