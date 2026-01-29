import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    BlockStack,
    Button,
    Card,
    DataTable,
    EmptyState,
    Layout,
    Page,
    Text
} from "@shopify/polaris";
import { useState } from "react";
import db from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

interface SyncStatus {
  brands: { count: number; lastSync: string | null };
  categories: { count: number; lastSync: string | null };
  styles: { count: number; lastSync: string | null };
  isRunning: boolean;
  currentTask: string | null;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  // Get current sync status
  const [brandsCount, categoriesCount, stylesCount] = await Promise.all([
    db.sSBrand.count(),
    db.sSCategory.count(),
    db.sSStyleCache.count(),
  ]);

  const [latestBrandSync, latestCategorySync, latestStyleSync] = await Promise.all([
    db.sSBrand.findFirst({ orderBy: { updatedAt: 'desc' } }),
    db.sSCategory.findFirst({ orderBy: { updatedAt: 'desc' } }),
    db.sSStyleCache.findFirst({ orderBy: { updatedAt: 'desc' } }),
  ]);

  // Check for running sync
  const runningSync = await db.catalogSyncLog.findFirst({
    where: { status: 'running' },
    orderBy: { startedAt: 'desc' },
  });

  return json({
    syncStatus: {
      brands: {
        count: brandsCount,
        lastSync: latestBrandSync?.updatedAt?.toISOString() || null
      },
      categories: {
        count: categoriesCount,
        lastSync: latestCategorySync?.updatedAt?.toISOString() || null
      },
      styles: {
        count: stylesCount,
        lastSync: latestStyleSync?.updatedAt?.toISOString() || null
      },
      isRunning: !!runningSync,
      currentTask: runningSync?.syncType || null,
    } as SyncStatus,
  });
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const formData = await request.formData();
  const action = formData.get("action");

  const client = new SSActiveWearClient();

  if (action === "sync-brands") {
    const log = await db.catalogSyncLog.create({
      data: { syncType: 'brands', status: 'running' },
    });

    try {
      const brands = await client.getBrands();

      for (const brand of brands) {
        await db.sSBrand.upsert({
          where: { brandId: brand.brandID },
          create: {
            brandId: brand.brandID,
            name: brand.name,
            image: brand.image || null,
            noeRetailing: brand.noeRetailing || false,
          },
          update: {
            name: brand.name,
            image: brand.image || null,
            noeRetailing: brand.noeRetailing || false,
          },
        });
      }

      await db.catalogSyncLog.update({
        where: { id: log.id },
        data: { status: 'completed', itemsCount: brands.length, completedAt: new Date() },
      });

      return json({ success: true, message: `Synced ${brands.length} brands` });
    } catch (error: any) {
      await db.catalogSyncLog.update({
        where: { id: log.id },
        data: { status: 'failed', error: error.message, completedAt: new Date() },
      });
      return json({ success: false, error: error.message });
    }
  }

  if (action === "sync-categories") {
    const log = await db.catalogSyncLog.create({
      data: { syncType: 'categories', status: 'running' },
    });

    try {
      const categories = await client.getCategories();

      for (const category of categories) {
        await db.sSCategory.upsert({
          where: { categoryId: category.categoryID },
          create: {
            categoryId: category.categoryID,
            name: category.name,
          },
          update: {
            name: category.name,
          },
        });
      }

      await db.catalogSyncLog.update({
        where: { id: log.id },
        data: { status: 'completed', itemsCount: categories.length, completedAt: new Date() },
      });

      return json({ success: true, message: `Synced ${categories.length} categories` });
    } catch (error: any) {
      await db.catalogSyncLog.update({
        where: { id: log.id },
        data: { status: 'failed', error: error.message, completedAt: new Date() },
      });
      return json({ success: false, error: error.message });
    }
  }

  if (action === "sync-styles") {
    const log = await db.catalogSyncLog.create({
      data: { syncType: 'styles', status: 'running' },
    });

    try {
      const styles = await client.getAllStyles();
      let count = 0;

      for (const style of styles) {
        await db.sSStyleCache.upsert({
          where: { styleId: style.styleID },
          create: {
            styleId: style.styleID,
            partNumber: style.partNumber,
            brandId: parseInt(style.brandName) || 0, // Will be string, need brand lookup
            brandName: style.brandName,
            styleName: style.styleName,
            title: style.title,
            description: style.description || null,
            baseCategory: style.baseCategory,
            categories: style.categories,
            styleImage: style.styleImage || null,
            sustainableStyle: style.sustainableStyle || false,
          },
          update: {
            partNumber: style.partNumber,
            brandName: style.brandName,
            styleName: style.styleName,
            title: style.title,
            description: style.description || null,
            baseCategory: style.baseCategory,
            categories: style.categories,
            styleImage: style.styleImage || null,
            sustainableStyle: style.sustainableStyle || false,
          },
        });
        count++;
      }

      await db.catalogSyncLog.update({
        where: { id: log.id },
        data: { status: 'completed', itemsCount: count, completedAt: new Date() },
      });

      return json({ success: true, message: `Synced ${count} styles` });
    } catch (error: any) {
      await db.catalogSyncLog.update({
        where: { id: log.id },
        data: { status: 'failed', error: error.message, completedAt: new Date() },
      });
      return json({ success: false, error: error.message });
    }
  }

  return json({ success: false, error: "Unknown action" });
}

export default function CatalogSyncPage() {
  const { syncStatus } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(false);

  const isSyncing = fetcher.state !== "idle" || syncStatus.isRunning;

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  return (
    <Page
      title="Catalog Sync"
      subtitle="Manage your SSActiveWear product catalog cache"
      backAction={{ content: "Settings", url: "/app/settings" }}
    >
      <TitleBar title="Catalog Sync" />
      <Layout>
        <Layout.Section>
          <BlockStack gap="600">
            {/* Sync Status Cards */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Catalog Cache Status</Text>
                <DataTable
                  columnContentTypes={["text", "numeric", "text", "text"]}
                  headings={["Data Type", "Cached Items", "Last Updated", "Action"]}
                  rows={[
                    [
                      "Brands",
                      syncStatus.brands.count.toString(),
                      formatDate(syncStatus.brands.lastSync),
                      <fetcher.Form method="post" style={{ display: "inline" }} key="brands">
                        <input type="hidden" name="action" value="sync-brands" />
                        <Button submit size="slim" loading={isSyncing && fetcher.formData?.get("action") === "sync-brands"}>
                          Sync Brands
                        </Button>
                      </fetcher.Form>,
                    ],
                    [
                      "Categories",
                      syncStatus.categories.count.toString(),
                      formatDate(syncStatus.categories.lastSync),
                      <fetcher.Form method="post" style={{ display: "inline" }} key="categories">
                        <input type="hidden" name="action" value="sync-categories" />
                        <Button submit size="slim" loading={isSyncing && fetcher.formData?.get("action") === "sync-categories"}>
                          Sync Categories
                        </Button>
                      </fetcher.Form>,
                    ],
                    [
                      "Styles",
                      syncStatus.styles.count.toString(),
                      formatDate(syncStatus.styles.lastSync),
                      <fetcher.Form method="post" style={{ display: "inline" }} key="styles">
                        <input type="hidden" name="action" value="sync-styles" />
                        <Button submit size="slim" loading={isSyncing && fetcher.formData?.get("action") === "sync-styles"}>
                          Sync All Styles
                        </Button>
                      </fetcher.Form>,
                    ],
                  ]}
                />
              </BlockStack>
            </Card>

            {/* Benefits */}
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">Why Cache the Catalog?</Text>
                <BlockStack gap="100">
                  <Text as="p" variant="bodyMd">
                    • <strong>Faster searches</strong> - Search from local database instead of API calls
                  </Text>
                  <Text as="p" variant="bodyMd">
                    • <strong>Browse by brand</strong> - Quickly filter by brand without waiting
                  </Text>
                  <Text as="p" variant="bodyMd">
                    • <strong>Offline availability</strong> - View products even if SSActiveWear API is slow
                  </Text>
                  <Text as="p" variant="bodyMd">
                    • <strong>API rate limits</strong> - Reduce API calls to stay within limits
                  </Text>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Empty State */}
            {syncStatus.brands.count === 0 && syncStatus.styles.count === 0 && (
              <Card>
                <EmptyState
                  heading="No catalog data cached yet"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>Click "Sync Brands" to start caching the SSActiveWear catalog locally.</p>
                </EmptyState>
              </Card>
            )}
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
