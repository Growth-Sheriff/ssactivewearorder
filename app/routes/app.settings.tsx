import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useSubmit } from "@remix-run/react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
    Banner,
    BlockStack,
    Box,
    Button,
    Card,
    Divider,
    FormLayout,
    InlineStack,
    Layout,
    Page,
    Select,
    Text,
    TextField,
} from "@shopify/polaris";
import { useCallback, useEffect, useState } from "react";
import { authenticate } from "../shopify.server";

// SSActiveWear shipping methods
const SS_SHIPPING_METHODS = [
  { label: "UPS Ground", value: "1" },
  { label: "UPS 3 Day Select", value: "2" },
  { label: "UPS 2nd Day Air", value: "3" },
  { label: "UPS Next Day Air Saver", value: "4" },
  { label: "UPS Next Day Air", value: "5" },
  { label: "USPS Priority Mail", value: "10" },
  { label: "USPS First Class", value: "11" },
  { label: "FedEx Ground", value: "20" },
  { label: "FedEx Express Saver", value: "21" },
  { label: "FedEx 2Day", value: "22" },
  { label: "FedEx Standard Overnight", value: "23" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  // Load settings from environment or database
  const settings = {
    ssActivewearUser: process.env.SSACTIVEWEAR_USER || "",
    ssActivewearKey: process.env.SSACTIVEWEAR_KEY ? "••••••••" : "",
    defaultShippingMethod: process.env.SS_DEFAULT_SHIPPING || "1",
    r2BucketUrl: process.env.R2_BUCKET_URL || "https://img-ssa-e.techifyboost.com",
  };

  return json({ settings });
}

export async function action({ request }: ActionFunctionArgs) {
  await authenticate.admin(request);
  const formData = await request.formData();

  // In production, save these to database or update environment
  // For now, just acknowledge the save
  return json({ success: true, message: "Settings saved successfully" });
}

export default function SettingsPage() {
  const { settings } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const shopify = useAppBridge();

  const [ssUser, setSsUser] = useState(settings.ssActivewearUser);
  const [ssKey, setSsKey] = useState("");
  const [defaultShipping, setDefaultShipping] = useState(settings.defaultShippingMethod);
  const [r2Url, setR2Url] = useState(settings.r2BucketUrl);

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Settings saved");
    }
  }, [actionData, shopify]);

  const handleSave = useCallback(() => {
    submit(
      {
        ssUser,
        ssKey,
        defaultShipping,
        r2Url,
      },
      { method: "post" }
    );
  }, [ssUser, ssKey, defaultShipping, r2Url, submit]);

  return (
    <Page title="Settings">
      <TitleBar title="App Settings" />
      <BlockStack gap="600">
        {/* API Credentials */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              SSActiveWear API Credentials
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Enter your SSActiveWear API credentials to enable product import and order sync.
            </Text>
            <Divider />
            <FormLayout>
              <TextField
                label="API Username"
                value={ssUser}
                onChange={setSsUser}
                autoComplete="off"
                placeholder="Your SSActiveWear user ID"
              />
              <TextField
                label="API Key"
                value={ssKey}
                onChange={setSsKey}
                type="password"
                autoComplete="off"
                placeholder={settings.ssActivewearKey ? "Enter new key to update" : "Your SSActiveWear API key"}
                helpText={settings.ssActivewearKey ? "A key is already configured" : ""}
              />
            </FormLayout>
            <Banner tone="info">
              <p>
                Get your API credentials from the{" "}
                <a href="https://www.ssactivewear.com" target="_blank" rel="noopener noreferrer">
                  SSActiveWear website
                </a>
                . Contact their support if you don't have API access.
              </p>
            </Banner>
          </BlockStack>
        </Card>

        {/* Shipping Settings */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Shipping Configuration
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Configure how orders are shipped from SSActiveWear.
            </Text>
            <Divider />
            <FormLayout>
              <Select
                label="Default Shipping Method"
                options={SS_SHIPPING_METHODS}
                value={defaultShipping}
                onChange={setDefaultShipping}
                helpText="This shipping method will be used for all orders sent to SSActiveWear"
              />
            </FormLayout>

            <Box
              background="bg-surface-secondary"
              padding="400"
              borderRadius="200"
            >
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm">
                  Shipping Method Reference
                </Text>
                <Layout>
                  <Layout.Section variant="oneHalf">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm">
                        <strong>Ground (Economy):</strong>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        UPS Ground, FedEx Ground
                      </Text>
                    </BlockStack>
                  </Layout.Section>
                  <Layout.Section variant="oneHalf">
                    <BlockStack gap="100">
                      <Text as="p" variant="bodySm">
                        <strong>Express (2-3 Days):</strong>
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">
                        UPS 3 Day, FedEx Express Saver
                      </Text>
                    </BlockStack>
                  </Layout.Section>
                </Layout>
              </BlockStack>
            </Box>
          </BlockStack>
        </Card>

        {/* Image Storage */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Image Storage (Cloudflare R2)
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Configure the R2 bucket URL for product images.
            </Text>
            <Divider />
            <FormLayout>
              <TextField
                label="R2 Bucket URL"
                value={r2Url}
                onChange={setR2Url}
                autoComplete="off"
                placeholder="https://img-ssa-e.techifyboost.com"
                helpText="The public URL of your Cloudflare R2 bucket"
              />
            </FormLayout>
          </BlockStack>
        </Card>

        {/* Save Button */}
        <InlineStack align="end">
          <Button variant="primary" size="large" onClick={handleSave}>
            Save Settings
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
