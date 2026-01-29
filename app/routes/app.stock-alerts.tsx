import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Button,
    Card,
    EmptyState,
    Icon,
    IndexTable,
    InlineStack,
    Layout,
    Modal,
    Page,
    Text,
    TextField,
    useIndexResourceState
} from "@shopify/polaris";
import {
    AlertTriangleIcon,
    CheckIcon,
    PlusIcon,
    RefreshIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const alerts = await prisma.stockAlert.findMany({
    where: { shop },
    orderBy: [{ isTriggered: 'desc' }, { createdAt: 'desc' }],
  });

  // Get variants from imported products
  const variantMaps = await prisma.variantMap.findMany({
    take: 100,
    include: {
      product: {
        select: { shop: true }
      }
    }
  });

  const availableSkus = variantMaps
    .filter(v => v.product.shop === shop)
    .map(v => ({
      sku: v.ssSku,
      variantId: v.shopifyVariantId,
    }));

  return json({ alerts, availableSkus });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "create") {
    const sku = formData.get("sku") as string;
    const productTitle = formData.get("productTitle") as string;
    const variantTitle = formData.get("variantTitle") as string;
    const threshold = parseInt(formData.get("threshold") as string) || 10;

    // Check if already exists
    const existing = await prisma.stockAlert.findUnique({
      where: { shop_sku: { shop, sku } },
    });

    if (existing) {
      return json({ success: false, message: "Alert for this SKU already exists" });
    }

    await prisma.stockAlert.create({
      data: {
        shop,
        sku,
        productTitle,
        variantTitle,
        threshold,
        isActive: true,
      },
    });

    return json({ success: true, message: "Stock alert created" });
  }

  if (action === "delete") {
    const alertId = formData.get("alertId") as string;
    await prisma.stockAlert.delete({ where: { id: alertId } });
    return json({ success: true, message: "Alert deleted" });
  }

  if (action === "toggle") {
    const alertId = formData.get("alertId") as string;
    const alert = await prisma.stockAlert.findUnique({ where: { id: alertId } });
    if (alert) {
      await prisma.stockAlert.update({
        where: { id: alertId },
        data: { isActive: !alert.isActive },
      });
    }
    return json({ success: true, message: "Alert toggled" });
  }

  if (action === "checkStock") {
    // Get API settings
    const settings = await prisma.session.findFirst({
      where: { shop },
    });

    // Fetch alerts that need checking
    const alerts = await prisma.stockAlert.findMany({
      where: { shop, isActive: true },
    });

    if (alerts.length === 0) {
      return json({ success: true, message: "No active alerts to check" });
    }

    // Get SKUs to check
    const skus = alerts.map(a => a.sku);

    try {
      // Call SSActiveWear API to get inventory
      const client = new SSActiveWearClient(
        process.env.SSACTIVEWEAR_USERNAME || "",
        process.env.SSACTIVEWEAR_PASSWORD || ""
      );

      const inventoryData = await client.getInventory(skus);

      // Update alerts with current stock
      let triggeredCount = 0;
      for (const alert of alerts) {
        const stockInfo = inventoryData.find((i: { sku: string; qty: number }) => i.sku === alert.sku);
        const currentStock = stockInfo?.qty || 0;
        const isTriggered = currentStock <= alert.threshold;

        if (isTriggered && !alert.isTriggered) {
          triggeredCount++;
        }

        await prisma.stockAlert.update({
          where: { id: alert.id },
          data: {
            currentStock,
            lastChecked: new Date(),
            isTriggered,
            notifiedAt: isTriggered && !alert.isTriggered ? new Date() : alert.notifiedAt,
          },
        });
      }

      return json({
        success: true,
        message: `Stock checked! ${triggeredCount} new low stock alerts.`
      });
    } catch (error) {
      console.error("Stock check error:", error);
      return json({ success: false, message: "Failed to check stock. Check API settings." });
    }
  }

  if (action === "bulkDelete") {
    const ids = JSON.parse(formData.get("ids") as string);
    await prisma.stockAlert.deleteMany({
      where: { id: { in: ids }, shop },
    });
    return json({ success: true, message: `Deleted ${ids.length} alerts` });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function StockAlertsPage() {
  const { alerts, availableSkus } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [modalOpen, setModalOpen] = useState(false);
  const [sku, setSku] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [variantTitle, setVariantTitle] = useState("");
  const [threshold, setThreshold] = useState("10");

  const isLoading = navigation.state === "submitting";

  const resourceName = {
    singular: 'alert',
    plural: 'alerts',
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(alerts);

  const handleCreate = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "create");
    formData.set("sku", sku);
    formData.set("productTitle", productTitle);
    formData.set("variantTitle", variantTitle);
    formData.set("threshold", threshold);
    submit(formData, { method: "POST" });
    setModalOpen(false);
    setSku("");
    setProductTitle("");
    setVariantTitle("");
    setThreshold("10");
  }, [sku, productTitle, variantTitle, threshold, submit]);

  const handleDelete = useCallback((alertId: string) => {
    const formData = new FormData();
    formData.set("action", "delete");
    formData.set("alertId", alertId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleToggle = useCallback((alertId: string) => {
    const formData = new FormData();
    formData.set("action", "toggle");
    formData.set("alertId", alertId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleCheckStock = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "checkStock");
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleBulkDelete = useCallback(() => {
    if (!confirm(`Delete ${selectedResources.length} alerts?`)) return;
    const formData = new FormData();
    formData.set("action", "bulkDelete");
    formData.set("ids", JSON.stringify(selectedResources));
    submit(formData, { method: "POST" });
  }, [selectedResources, submit]);

  const promotedBulkActions = [
    {
      content: 'Delete Selected',
      destructive: true,
      onAction: handleBulkDelete,
    },
  ];

  const triggeredAlerts = alerts.filter(a => a.isTriggered);
  const normalAlerts = alerts.filter(a => !a.isTriggered);

  const rowMarkup = alerts.map((alert, index) => (
    <IndexTable.Row
      id={alert.id}
      key={alert.id}
      selected={selectedResources.includes(alert.id)}
      position={index}
    >
      <IndexTable.Cell>
        <BlockStack gap="050">
          <Text as="span" variant="bodyMd" fontWeight="semibold">{alert.productTitle}</Text>
          <Text as="span" variant="bodySm" tone="subdued">{alert.variantTitle}</Text>
        </BlockStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">{alert.sku}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodyMd">{alert.threshold}</Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="100" blockAlign="center">
          <Text as="span" variant="bodyMd">{alert.currentStock}</Text>
          {alert.isTriggered && (
            <Icon source={AlertTriangleIcon} tone="critical" />
          )}
        </InlineStack>
      </IndexTable.Cell>
      <IndexTable.Cell>
        {alert.isTriggered ? (
          <Badge tone="critical">Low Stock!</Badge>
        ) : alert.isActive ? (
          <Badge tone="success">Active</Badge>
        ) : (
          <Badge tone="subdued">Inactive</Badge>
        )}
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Text as="span" variant="bodySm" tone="subdued">
          {alert.lastChecked ? new Date(alert.lastChecked).toLocaleDateString() : "Never"}
        </Text>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <InlineStack gap="100">
          <Button size="slim" variant="plain" onClick={() => handleToggle(alert.id)}>
            {alert.isActive ? "Disable" : "Enable"}
          </Button>
          <Button size="slim" variant="plain" tone="critical" onClick={() => handleDelete(alert.id)}>
            Delete
          </Button>
        </InlineStack>
      </IndexTable.Cell>
    </IndexTable.Row>
  ));

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Stock Alerts"
      subtitle="Get notified when inventory levels drop below your threshold"
      primaryAction={{
        content: "Add Alert",
        icon: PlusIcon,
        onAction: () => setModalOpen(true),
      }}
      secondaryActions={[
        {
          content: "Check Stock Now",
          icon: RefreshIcon,
          onAction: handleCheckStock,
          loading: isLoading,
        },
      ]}
    >
      <TitleBar title="Stock Alerts" />
      <BlockStack gap="600">
        {actionData && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Summary Cards */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Total Alerts</Text>
                <Text as="p" variant="heading2xl">{alerts.length}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm" tone="subdued">Low Stock</Text>
                  <Icon source={AlertTriangleIcon} tone="critical" />
                </InlineStack>
                <Text as="p" variant="heading2xl" tone="critical">{triggeredAlerts.length}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm" tone="subdued">Normal Stock</Text>
                  <Icon source={CheckIcon} tone="success" />
                </InlineStack>
                <Text as="p" variant="heading2xl" tone="success">{normalAlerts.length}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Alerts Table */}
        {alerts.length === 0 ? (
          <Card>
            <EmptyState
              heading="No stock alerts"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Create Alert",
                onAction: () => setModalOpen(true),
              }}
            >
              <p>Set up alerts to monitor inventory levels for your imported products.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <IndexTable
              resourceName={resourceName}
              itemCount={alerts.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              promotedBulkActions={promotedBulkActions}
              headings={[
                { title: 'Product' },
                { title: 'SKU' },
                { title: 'Threshold' },
                { title: 'Current Stock' },
                { title: 'Status' },
                { title: 'Last Checked' },
                { title: 'Actions' },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        )}

        {/* Create Alert Modal */}
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Create Stock Alert"
          primaryAction={{
            content: "Create Alert",
            onAction: handleCreate,
            loading: isLoading,
            disabled: !sku || !productTitle,
          }}
          secondaryActions={[
            { content: "Cancel", onAction: () => setModalOpen(false) },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <TextField
                label="SKU"
                value={sku}
                onChange={setSku}
                autoComplete="off"
                placeholder="Enter SSActiveWear SKU"
              />
              <TextField
                label="Product Title"
                value={productTitle}
                onChange={setProductTitle}
                autoComplete="off"
                placeholder="e.g., Gildan 5000"
              />
              <TextField
                label="Variant Title"
                value={variantTitle}
                onChange={setVariantTitle}
                autoComplete="off"
                placeholder="e.g., Black / Large"
              />
              <TextField
                label="Low Stock Threshold"
                type="number"
                value={threshold}
                onChange={setThreshold}
                autoComplete="off"
                helpText="Alert triggers when stock falls at or below this number"
              />
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
