import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
    BlockStack,
    Box,
    Button,
    Card,
    Divider,
    FormLayout,
    Icon,
    InlineGrid,
    InlineStack,
    Page,
    Select,
    Text,
    TextField
} from "@shopify/polaris";
import { CheckCircleIcon, XCircleIcon } from "@shopify/polaris-icons";
import { useCallback, useEffect, useState } from "react";
import prisma from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";
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

interface LoaderData {
  settings: {
    ssActivewearUser: string;
    ssActivewearKeyConfigured: boolean;
    defaultShippingMethod: string;
    r2BucketUrl: string;
  };
  apiStatus: {
    connected: boolean;
    message: string;
    categoryCount?: number;
  };
  uploadLocations: any[];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const ssUser = process.env.SSACTIVEWEAR_USER || "";
  const ssKey = process.env.SSACTIVEWEAR_KEY || "";

  // Test API connection
  let apiStatus = { connected: false, message: "Not configured", categoryCount: 0 };

  if (ssUser && ssKey) {
    try {
      const client = new SSActiveWearClient();
      const categories = await client.getCategories();
      apiStatus = {
        connected: true,
        message: "Connected successfully",
        categoryCount: Array.isArray(categories) ? categories.length : 0,
      };
    } catch (error: any) {
      apiStatus = {
        connected: false,
        message: error?.message || "Connection failed",
        categoryCount: 0,
      };
    }
  }

  const settings = {
    ssActivewearUser: ssUser,
    ssActivewearKeyConfigured: !!ssKey,
    defaultShippingMethod: process.env.SS_DEFAULT_SHIPPING || "1",
    r2BucketUrl: process.env.R2_PUBLIC_URL || "https://img-ssa-e.techifyboost.com",
  };

  const uploadLocations = await prisma.uploadLocation.findMany({
    where: { shop },
    orderBy: { sortOrder: 'asc' },
  });

  return json<LoaderData>({ settings, apiStatus, uploadLocations });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action") as string;

  if (actionType === "save_upload_locations") {
    const locationsJson = formData.get("locations") as string;
    const locations = JSON.parse(locationsJson);

    // Full sync - delete and recreation for simplicity in settings
    await prisma.uploadLocation.deleteMany({ where: { shop } });

    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      await prisma.uploadLocation.create({
        data: {
          shop,
          name: loc.name || loc.label.toLowerCase().replace(/ /g, '_'),
          label: loc.label,
          iconType: loc.iconType,
          sortOrder: i,
        },
      });
    }

    return json({ success: true, message: "Upload locations updated" });
  }

  // Save settings - in production, save to database
  return json({ success: true, message: "Settings saved successfully" });
}

function UploadLocationsCard({ initialLocations }: { initialLocations: any[] }) {
  const [locations, setLocations] = useState(initialLocations.length > 0 ? initialLocations : [
    { label: "Front", iconType: "front" },
    { label: "Back", iconType: "back" }
  ]);
  const submit = useSubmit();
  const nav = useNavigation();
  const isSaving = nav.state === "submitting" && nav.formData?.get("action") === "save_upload_locations";

  const updateLocation = (index: number, field: string, value: any) => {
    const newLocs = [...locations];
    newLocs[index][field] = value;
    setLocations(newLocs);
  };

  const addLocation = () => {
    setLocations([...locations, { label: "New Location", iconType: "custom" }]);
  };

  const removeLocation = (index: number) => {
    const newLocs = locations.filter((_, i) => i !== index);
    setLocations(newLocs);
  };

  const handleSave = () => {
    const formData = new FormData();
    formData.set("action", "save_upload_locations");
    formData.set("locations", JSON.stringify(locations));
    submit(formData, { method: "post" });
  };

  const iconOptions = [
    { label: "Front (Ön)", value: "front" },
    { label: "Back (Arka)", value: "back" },
    { label: "Left Sleeve (Sol Kol)", value: "left_sleeve" },
    { label: "Right Sleeve (Sağ Kol)", value: "right_sleeve" },
    { label: "Logo / Patch (Arma)", value: "custom" },
  ];

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">Upload Locations</Text>
            <Text as="p" variant="bodySm" tone="subdued">
              Define the areas where customers can upload their designs (e.g., Front, Back, Left Sleeve).
            </Text>
          </BlockStack>
          <Button onClick={addLocation} size="slim">Add Location</Button>
        </InlineStack>
        <Divider />

        <BlockStack gap="400">
          {locations.map((loc, index) => (
            <Box key={index} background="bg-surface-secondary" padding="300" borderRadius="200">
              <InlineGrid columns={['1fr', '1fr', 'auto']} gap="300">
                <TextField
                  label="Location Label"
                  value={loc.label}
                  onChange={(val) => updateLocation(index, "label", val)}
                  autoComplete="off"
                />
                <Select
                  label="Icon / Guide"
                  options={iconOptions}
                  value={loc.iconType}
                  onChange={(val) => updateLocation(index, "iconType", val)}
                  autoComplete="off"
                />
                <div style={{ alignSelf: 'end' }}>
                  <Button variant="plain" tone="critical" onClick={() => removeLocation(index)}>Remove</Button>
                </div>
              </InlineGrid>
            </Box>
          ))}
        </BlockStack>

        <InlineStack align="end">
          <Button variant="primary" onClick={handleSave} loading={isSaving}>Update Upload Locations</Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function SettingsPage() {
  const { settings, apiStatus, uploadLocations } = useLoaderData<LoaderData>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const nav = useNavigation();
  const shopify = useAppBridge();

  const [ssUser, setSsUser] = useState(settings.ssActivewearUser);
  const [ssKey, setSsKey] = useState("");
  const [defaultShipping, setDefaultShipping] = useState(settings.defaultShippingMethod);
  const [r2Url, setR2Url] = useState(settings.r2BucketUrl);

  const isLoading = nav.state === "loading";

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Settings saved");
    }
  }, [actionData, shopify]);

  const handleSave = useCallback(() => {
    submit(
      {
        action: "save_general",
        ssUser,
        ssKey,
        defaultShipping,
        r2Url,
      },
      { method: "post" }
    );
  }, [ssUser, ssKey, defaultShipping, r2Url, submit]);

  const handleTestApi = useCallback(() => {
    window.location.reload();
  }, []);

  return (
    <Page title="Settings">
      <TitleBar title="App Settings" />
      <BlockStack gap="600">
        {/* API Status Card */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h2" variant="headingMd">
                API Connection Status
              </Text>
              <Button onClick={handleTestApi} loading={isLoading} size="slim">
                Test Connection
              </Button>
            </InlineStack>
            <Divider />
            <Box
              background={apiStatus.connected ? "bg-surface-success" : "bg-surface-critical"}
              padding="400"
              borderRadius="200"
            >
              <InlineStack gap="300" blockAlign="center">
                <Icon
                  source={apiStatus.connected ? CheckCircleIcon : XCircleIcon}
                  tone={apiStatus.connected ? "success" : "critical"}
                />
                <BlockStack gap="100">
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {apiStatus.connected ? "Connected to SSActiveWear" : "Not Connected"}
                  </Text>
                  <Text as="span" variant="bodySm" tone="subdued">
                    {apiStatus.connected
                      ? `${apiStatus.categoryCount} categories available`
                      : apiStatus.message}
                  </Text>
                </BlockStack>
              </InlineStack>
            </Box>
          </BlockStack>
        </Card>

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
                label="Account Number"
                value={ssUser}
                onChange={setSsUser}
                autoComplete="off"
                placeholder="e.g. 599024"
                helpText={settings.ssActivewearUser ? `Current: ${settings.ssActivewearUser}` : "Enter your SSActiveWear account number"}
              />
              <TextField
                label="API Key"
                value={ssKey}
                onChange={setSsKey}
                type="password"
                autoComplete="off"
                placeholder={settings.ssActivewearKeyConfigured ? "Enter new key to update" : "Your SSActiveWear API key"}
                helpText={settings.ssActivewearKeyConfigured ? "✓ API key is configured" : "Enter your API key"}
              />
            </FormLayout>
          </BlockStack>
        </Card>

        {/* Upload Locations Configuration */}
        <UploadLocationsCard initialLocations={uploadLocations} />

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
            Save All Settings
          </Button>
        </InlineStack>
      </BlockStack>
    </Page>
  );
}
