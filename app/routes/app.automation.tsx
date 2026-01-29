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
    Checkbox,
    Divider,
    Icon,
    InlineStack,
    Layout,
    Page,
    Select,
    Text,
    TextField,
} from "@shopify/polaris";
import {
    ClockIcon,
    PlayIcon,
    SettingsIcon
} from "@shopify/polaris-icons";
import { useCallback, useEffect, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  let settings = await prisma.autoOrderSettings.findUnique({
    where: { shop },
  });

  // Create default settings if not exists
  if (!settings) {
    settings = await prisma.autoOrderSettings.create({
      data: {
        shop,
        isEnabled: false,
        autoSubmit: false,
        defaultShippingMethod: "FXG",
      },
    });
  }

  // Get recent auto-processed orders
  const recentOrders = await prisma.orderJob.findMany({
    where: { shop },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return json({ settings, recentOrders });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "saveSettings") {
    const isEnabled = formData.get("isEnabled") === "true";
    const autoSubmit = formData.get("autoSubmit") === "true";
    const defaultShippingMethod = formData.get("defaultShippingMethod") as string;
    const notifyEmail = formData.get("notifyEmail") as string || null;
    const minOrderValue = parseFloat(formData.get("minOrderValue") as string) || 0;
    const excludeTags = formData.get("excludeTags") as string || null;

    await prisma.autoOrderSettings.upsert({
      where: { shop },
      update: {
        isEnabled,
        autoSubmit,
        defaultShippingMethod,
        notifyEmail,
        minOrderValue,
        excludeTags,
      },
      create: {
        shop,
        isEnabled,
        autoSubmit,
        defaultShippingMethod,
        notifyEmail,
        minOrderValue,
        excludeTags,
      },
    });

    return json({ success: true, message: "Settings saved successfully" });
  }

  if (action === "toggleEnabled") {
    const settings = await prisma.autoOrderSettings.findUnique({ where: { shop } });
    if (settings) {
      await prisma.autoOrderSettings.update({
        where: { shop },
        data: { isEnabled: !settings.isEnabled },
      });
    }
    return json({ success: true, message: settings?.isEnabled ? "Automation disabled" : "Automation enabled" });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function AutomationPage() {
  const { settings, recentOrders } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [isEnabled, setIsEnabled] = useState(settings.isEnabled);
  const [autoSubmit, setAutoSubmit] = useState(settings.autoSubmit);
  const [defaultShippingMethod, setDefaultShippingMethod] = useState(settings.defaultShippingMethod);
  const [notifyEmail, setNotifyEmail] = useState(settings.notifyEmail || "");
  const [minOrderValue, setMinOrderValue] = useState(settings.minOrderValue.toString());
  const [excludeTags, setExcludeTags] = useState(settings.excludeTags || "");

  const isLoading = navigation.state === "submitting";

  // Sync state with loaded settings
  useEffect(() => {
    setIsEnabled(settings.isEnabled);
    setAutoSubmit(settings.autoSubmit);
    setDefaultShippingMethod(settings.defaultShippingMethod);
    setNotifyEmail(settings.notifyEmail || "");
    setMinOrderValue(settings.minOrderValue.toString());
    setExcludeTags(settings.excludeTags || "");
  }, [settings]);

  const handleSave = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "saveSettings");
    formData.set("isEnabled", isEnabled.toString());
    formData.set("autoSubmit", autoSubmit.toString());
    formData.set("defaultShippingMethod", defaultShippingMethod);
    formData.set("notifyEmail", notifyEmail);
    formData.set("minOrderValue", minOrderValue);
    formData.set("excludeTags", excludeTags);
    submit(formData, { method: "POST" });
  }, [isEnabled, autoSubmit, defaultShippingMethod, notifyEmail, minOrderValue, excludeTags, submit]);

  const handleToggle = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "toggleEnabled");
    submit(formData, { method: "POST" });
  }, [submit]);

  const shippingOptions = [
    { label: "FedEx Ground (FXG)", value: "FXG" },
    { label: "FedEx Express Saver (FXE)", value: "FXE" },
    { label: "FedEx 2Day (FX2)", value: "FX2" },
    { label: "FedEx Overnight (FXO)", value: "FXO" },
    { label: "UPS Ground (UPG)", value: "UPG" },
    { label: "UPS 3-Day Select (UP3)", value: "UP3" },
    { label: "USPS Priority Mail (USP)", value: "USP" },
  ];

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING_APPROVAL':
        return <Badge tone="attention">Pending</Badge>;
      case 'SUBMITTED':
        return <Badge tone="success">Submitted</Badge>;
      case 'SHIPPED':
        return <Badge tone="info">Shipped</Badge>;
      case 'ERROR':
        return <Badge tone="critical">Error</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Order Automation"
      subtitle="Configure automatic order processing to SSActiveWear"
      primaryAction={{
        content: settings.isEnabled ? "Disable Automation" : "Enable Automation",
        onAction: handleToggle,
        loading: isLoading,
        tone: settings.isEnabled ? "critical" : undefined,
      }}
    >
      <TitleBar title="Automation" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Status Card */}
        <Card>
          <InlineStack align="space-between" blockAlign="center">
            <InlineStack gap="400">
              <Box
                background={settings.isEnabled ? "bg-fill-success" : "bg-fill-secondary"}
                padding="300"
                borderRadius="full"
              >
                <Icon source={settings.isEnabled ? PlayIcon : ClockIcon} tone={settings.isEnabled ? "success" : "subdued"} />
              </Box>
              <BlockStack gap="100">
                <Text as="h2" variant="headingMd">
                  Automation is {settings.isEnabled ? "Active" : "Inactive"}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  {settings.isEnabled
                    ? "New orders are being processed automatically"
                    : "Orders require manual approval before being sent to SSActiveWear"}
                </Text>
              </BlockStack>
            </InlineStack>
            <Badge tone={settings.isEnabled ? "success" : "subdued"} size="large">
              {settings.isEnabled ? "ON" : "OFF"}
            </Badge>
          </InlineStack>
        </Card>

        <Layout>
          {/* Settings */}
          <Layout.Section>
            <Card>
              <BlockStack gap="500">
                <InlineStack gap="200">
                  <Icon source={SettingsIcon} />
                  <Text as="h2" variant="headingMd">Automation Settings</Text>
                </InlineStack>
                <Divider />

                <Checkbox
                  label="Enable Order Automation"
                  helpText="Automatically process incoming Shopify orders that contain SSActiveWear products"
                  checked={isEnabled}
                  onChange={setIsEnabled}
                />

                <Checkbox
                  label="Auto-submit to SSActiveWear"
                  helpText="If enabled, orders are sent directly to SSActiveWear without manual approval. If disabled, orders are queued for your review."
                  checked={autoSubmit}
                  onChange={setAutoSubmit}
                  disabled={!isEnabled}
                />

                <Select
                  label="Default Shipping Method"
                  options={shippingOptions}
                  value={defaultShippingMethod}
                  onChange={setDefaultShippingMethod}
                  disabled={!isEnabled}
                  helpText="Shipping method used when not specified in the order"
                />

                <TextField
                  label="Notification Email"
                  type="email"
                  value={notifyEmail}
                  onChange={setNotifyEmail}
                  autoComplete="email"
                  placeholder="you@example.com"
                  helpText="Receive notifications when orders are processed or errors occur"
                  disabled={!isEnabled}
                />

                <TextField
                  label="Minimum Order Value"
                  type="number"
                  value={minOrderValue}
                  onChange={setMinOrderValue}
                  autoComplete="off"
                  prefix="$"
                  helpText="Only auto-process orders above this value (0 = no minimum)"
                  disabled={!isEnabled}
                />

                <TextField
                  label="Exclude Order Tags"
                  value={excludeTags}
                  onChange={setExcludeTags}
                  autoComplete="off"
                  placeholder="wholesale, manual-review, custom"
                  helpText="Orders with these tags will not be auto-processed (comma-separated)"
                  disabled={!isEnabled}
                />

                <Divider />

                <InlineStack align="end" gap="200">
                  <Button onClick={() => {
                    setIsEnabled(settings.isEnabled);
                    setAutoSubmit(settings.autoSubmit);
                    setDefaultShippingMethod(settings.defaultShippingMethod);
                    setNotifyEmail(settings.notifyEmail || "");
                    setMinOrderValue(settings.minOrderValue.toString());
                    setExcludeTags(settings.excludeTags || "");
                  }}>
                    Reset
                  </Button>
                  <Button variant="primary" onClick={handleSave} loading={isLoading}>
                    Save Settings
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* How It Works & Recent Activity */}
          <Layout.Section variant="oneThird">
            {/* How It Works */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">How It Works</Text>
                <Divider />
                <BlockStack gap="300">
                  <InlineStack gap="200">
                    <Badge tone="info">1</Badge>
                    <Text as="p" variant="bodySm">Customer places an order on your Shopify store</Text>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Badge tone="info">2</Badge>
                    <Text as="p" variant="bodySm">Webhook captures orders with SSActiveWear products</Text>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Badge tone="info">3</Badge>
                    <Text as="p" variant="bodySm">Order is queued or auto-submitted based on settings</Text>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Badge tone="info">4</Badge>
                    <Text as="p" variant="bodySm">SSActiveWear fulfills and ships the order</Text>
                  </InlineStack>
                  <InlineStack gap="200">
                    <Badge tone="info">5</Badge>
                    <Text as="p" variant="bodySm">Tracking info is synced back to Shopify</Text>
                  </InlineStack>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Recent Orders */}
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">Recent Orders</Text>
                    <Button url="/app/orders" size="slim" variant="plain">View All</Button>
                  </InlineStack>
                  <Divider />
                  {recentOrders.length === 0 ? (
                    <Text as="p" tone="subdued">No orders yet</Text>
                  ) : (
                    <BlockStack gap="200">
                      {recentOrders.slice(0, 5).map((order) => (
                        <Box key={order.id} padding="200" background="bg-surface-secondary" borderRadius="100">
                          <InlineStack align="space-between">
                            <BlockStack gap="050">
                              <Text as="span" variant="bodySm" fontWeight="semibold">
                                #{order.shopifyOrderNumber || 'N/A'}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {new Date(order.createdAt).toLocaleDateString()}
                              </Text>
                            </BlockStack>
                            {getStatusBadge(order.status)}
                          </InlineStack>
                        </Box>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Box>

            {/* Tips */}
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">💡 Tips</Text>
                  <Divider />
                  <Text as="p" variant="bodySm" tone="subdued">
                    • Start with auto-submit OFF to review orders first
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    • Set a minimum order value to avoid processing small test orders
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    • Use exclude tags for wholesale or custom orders
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    • Check your SSActiveWear credentials in Settings
                  </Text>
                </BlockStack>
              </Card>
            </Box>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
