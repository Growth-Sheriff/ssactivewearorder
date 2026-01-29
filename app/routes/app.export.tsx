import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    BlockStack,
    Button,
    Card,
    Divider,
    Icon,
    InlineGrid,
    InlineStack,
    Page,
    Select,
    Text
} from "@shopify/polaris";
import {
    ExportIcon,
    OrderIcon,
    ProductIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get counts for each exportable data type
  const [
    productsCount,
    ordersCount,
    favoritesCount,
    priceRulesCount,
    alertsCount,
    templatesCount,
    activityCount,
    webhookCount,
  ] = await Promise.all([
    prisma.productMap.count({ where: { shop } }),
    prisma.orderJob.count({ where: { shop } }),
    prisma.favorite.count({ where: { shop } }),
    prisma.priceRule.count({ where: { shop } }),
    prisma.stockAlert.count({ where: { shop } }),
    prisma.reorderTemplate.count({ where: { shop } }),
    prisma.activityLog.count({ where: { shop } }),
    prisma.webhookLog.count({ where: { shop } }),
  ]);

  return json({
    counts: {
      products: productsCount,
      orders: ordersCount,
      favorites: favoritesCount,
      priceRules: priceRulesCount,
      alerts: alertsCount,
      templates: templatesCount,
      activity: activityCount,
      webhooks: webhookCount,
    },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const exportType = formData.get("exportType") as string;
  const format = formData.get("format") as string || "json";

  let data: unknown[] = [];
  let filename = "";

  switch (exportType) {
    case "products": {
      const products = await prisma.productMap.findMany({
        where: { shop },
        include: {
          style: {
            select: {
              styleName: true,
              brandName: true,
              basePrice: true,
            },
          },
        },
      });
      data = products.map(p => ({
        id: p.id,
        ssStyleId: p.ssStyleId,
        shopifyProductId: p.shopifyProductId,
        styleName: p.style?.styleName,
        brandName: p.style?.brandName,
        basePrice: p.style?.basePrice,
        createdAt: p.createdAt.toISOString(),
      }));
      filename = `products_export_${Date.now()}`;
      break;
    }

    case "orders": {
      const orders = await prisma.orderJob.findMany({
        where: { shop },
        include: {
          items: true,
        },
      });
      data = orders.map(o => ({
        id: o.id,
        shopifyOrderId: o.shopifyOrderId,
        shopifyOrderNumber: o.shopifyOrderNumber,
        ssOrderId: o.ssOrderId,
        status: o.status,
        totalItems: o.items.length,
        items: o.items.map(i => ({
          sku: i.sku,
          qty: i.qty,
          price: i.price,
        })),
        shippingMethod: o.shippingMethod,
        createdAt: o.createdAt.toISOString(),
        submittedAt: o.submittedAt?.toISOString(),
      }));
      filename = `orders_export_${Date.now()}`;
      break;
    }

    case "favorites": {
      const favorites = await prisma.favorite.findMany({
        where: { shop },
      });
      data = favorites.map(f => ({
        id: f.id,
        styleId: f.styleId,
        styleName: f.styleName,
        brandName: f.brandName,
        notes: f.notes,
        tags: f.tags,
        createdAt: f.createdAt.toISOString(),
      }));
      filename = `favorites_export_${Date.now()}`;
      break;
    }

    case "priceRules": {
      const rules = await prisma.priceRule.findMany({
        where: { shop },
      });
      data = rules.map(r => ({
        id: r.id,
        name: r.name,
        type: r.type,
        value: r.value,
        applyTo: r.applyTo,
        brandFilter: r.brandFilter,
        categoryFilter: r.categoryFilter,
        isActive: r.isActive,
        priority: r.priority,
        createdAt: r.createdAt.toISOString(),
      }));
      filename = `price_rules_export_${Date.now()}`;
      break;
    }

    case "alerts": {
      const alerts = await prisma.stockAlert.findMany({
        where: { shop },
      });
      data = alerts.map(a => ({
        id: a.id,
        styleId: a.styleId,
        styleName: a.styleName,
        sku: a.sku,
        threshold: a.threshold,
        currentStock: a.currentStock,
        isActive: a.isActive,
        createdAt: a.createdAt.toISOString(),
      }));
      filename = `stock_alerts_export_${Date.now()}`;
      break;
    }

    case "activity": {
      const activities = await prisma.activityLog.findMany({
        where: { shop },
        orderBy: { createdAt: 'desc' },
        take: 1000, // Limit to last 1000 entries
      });
      data = activities.map(a => ({
        id: a.id,
        action: a.action,
        resource: a.resource,
        resourceId: a.resourceId,
        userEmail: a.userEmail,
        details: a.details,
        ipAddress: a.ipAddress,
        createdAt: a.createdAt.toISOString(),
      }));
      filename = `activity_log_export_${Date.now()}`;
      break;
    }

    case "all": {
      // Export all data
      const [products, orders, favorites, priceRules, alerts] = await Promise.all([
        prisma.productMap.findMany({ where: { shop } }),
        prisma.orderJob.findMany({ where: { shop }, include: { items: true } }),
        prisma.favorite.findMany({ where: { shop } }),
        prisma.priceRule.findMany({ where: { shop } }),
        prisma.stockAlert.findMany({ where: { shop } }),
      ]);

      data = [{
        exportDate: new Date().toISOString(),
        shop,
        products: products.map(p => ({
          ssStyleId: p.ssStyleId,
          shopifyProductId: p.shopifyProductId,
          createdAt: p.createdAt.toISOString(),
        })),
        orders: orders.map(o => ({
          shopifyOrderId: o.shopifyOrderId,
          status: o.status,
          items: o.items.map(i => ({ sku: i.sku, qty: i.qty })),
        })),
        favorites: favorites.map(f => ({
          styleId: f.styleId,
          styleName: f.styleName,
        })),
        priceRules: priceRules.map(r => ({
          name: r.name,
          type: r.type,
          value: r.value,
        })),
        alerts: alerts.map(a => ({
          styleId: a.styleId,
          threshold: a.threshold,
        })),
      }];
      filename = `full_backup_${Date.now()}`;
      break;
    }

    default:
      return json({ success: false, message: "Unknown export type" });
  }

  // Convert to requested format
  let content: string;
  let mimeType: string;
  let extension: string;

  if (format === "csv" && exportType !== "all") {
    // Convert to CSV
    if (data.length === 0) {
      content = "";
    } else {
      const headers = Object.keys(data[0] as object);
      const rows = data.map(row => {
        const r = row as Record<string, unknown>;
        return headers.map(h => {
          const val = r[h];
          if (typeof val === 'object') return JSON.stringify(val);
          return String(val ?? '');
        }).join(',');
      });
      content = [headers.join(','), ...rows].join('\n');
    }
    mimeType = "text/csv";
    extension = "csv";
  } else {
    // JSON format
    content = JSON.stringify(data, null, 2);
    mimeType = "application/json";
    extension = "json";
  }

  // Return as downloadable response
  return new Response(content, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `attachment; filename="${filename}.${extension}"`,
    },
  });
};

export default function BackupExportPage() {
  const { counts } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [selectedFormat, setSelectedFormat] = useState("json");
  const isLoading = navigation.state === "submitting";

  const handleExport = useCallback((exportType: string) => {
    const formData = new FormData();
    formData.set("exportType", exportType);
    formData.set("format", selectedFormat);
    submit(formData, { method: "POST" });
  }, [selectedFormat, submit]);

  const exportOptions = [
    {
      type: "products",
      title: "Products",
      icon: ProductIcon,
      count: counts.products,
      description: "Export all imported products with style details",
    },
    {
      type: "orders",
      title: "Orders",
      icon: OrderIcon,
      count: counts.orders,
      description: "Export order history with line items",
    },
    {
      type: "favorites",
      title: "Favorites",
      icon: ProductIcon,
      count: counts.favorites,
      description: "Export saved favorite products",
    },
    {
      type: "priceRules",
      title: "Price Rules",
      icon: ProductIcon,
      count: counts.priceRules,
      description: "Export pricing markup rules",
    },
    {
      type: "alerts",
      title: "Stock Alerts",
      icon: ProductIcon,
      count: counts.alerts,
      description: "Export stock alert configurations",
    },
    {
      type: "activity",
      title: "Activity Log",
      icon: ProductIcon,
      count: counts.activity,
      description: "Export activity audit trail (last 1000)",
    },
  ];

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Backup & Export"
      subtitle="Download your data in various formats"
    >
      <TitleBar title="Export" />
      <BlockStack gap="600">
        {/* Format Selection */}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <BlockStack gap="100">
              <Text as="h2" variant="headingMd">Export Format</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Choose the format for your exported data
              </Text>
            </BlockStack>
            <div style={{ width: "200px" }}>
              <Select
                label=""
                options={[
                  { label: "JSON (recommended)", value: "json" },
                  { label: "CSV", value: "csv" },
                ]}
                value={selectedFormat}
                onChange={setSelectedFormat}
              />
            </div>
          </InlineStack>
        </Card>

        {/* Full Backup */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="100">
                <InlineStack gap="200">
                  <Icon source={ExportIcon} />
                  <Text as="h2" variant="headingMd">Full Backup</Text>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">
                  Download a complete backup of all your data in a single file
                </Text>
              </BlockStack>
              <Button
                variant="primary"
                onClick={() => handleExport("all")}
                loading={isLoading}
                icon={ExportIcon}
              >
                Download Full Backup
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        <Divider />

        {/* Individual Exports */}
        <Text as="h2" variant="headingMd">Export Individual Data</Text>
        <InlineGrid columns={{ xs: 1, sm: 2, md: 3 }} gap="400">
          {exportOptions.map(opt => (
            <Card key={opt.type}>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <InlineStack gap="200">
                    <Icon source={opt.icon} />
                    <Text as="h3" variant="headingSm">{opt.title}</Text>
                  </InlineStack>
                  <Badge>{opt.count.toLocaleString()}</Badge>
                </InlineStack>
                <Text as="p" variant="bodySm" tone="subdued">{opt.description}</Text>
                <Button
                  fullWidth
                  onClick={() => handleExport(opt.type)}
                  loading={isLoading}
                  disabled={opt.count === 0}
                >
                  Export {opt.title}
                </Button>
              </BlockStack>
            </Card>
          ))}
        </InlineGrid>

        {/* Info */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">💡 About Exports</Text>
            <Divider />
            <BlockStack gap="200">
              <Text as="p" variant="bodySm" tone="subdued">
                • <strong>JSON format</strong> is recommended for complete data preservation and backup restoration
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • <strong>CSV format</strong> is useful for importing into spreadsheet applications like Excel or Google Sheets
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • Exports include all data visible in each section; sensitive data like API keys is never exported
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                • Activity logs are limited to the last 1000 entries for performance reasons
              </Text>
            </BlockStack>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
