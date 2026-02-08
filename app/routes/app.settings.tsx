import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
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
  TextField,
} from "@shopify/polaris";
import { CheckCircleIcon, XCircleIcon } from "@shopify/polaris-icons";
import { useEffect, useState } from "react";
import prisma from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

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
    categoryCount: number;
  };
  uploadLocations: any[];
}

const SS_SHIPPING_METHODS = [
  { label: "Standard Ground", value: "1" },
  { label: "UPS NEXT DAY AIR", value: "2" },
  { label: "UPS 2ND DAY AIR", value: "3" },
  { label: "UPS 3 DAY SELECT", value: "4" },
  { label: "PICK UP", value: "8" },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;

  // Ensure shop-level metafield definition exists for storefront access
  try {
    await admin.graphql(`
      mutation CreateShopMetafieldDefinition {
        metafieldDefinitionCreate(definition: {
          name: "Upload Locations"
          namespace: "ss_custom"
          key: "upload_locations"
          type: "json"
          ownerType: SHOP
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
    // Definition likely already exists
  }

  // Fetch API status - client reads from SSACTIVEWEAR_USER/KEY env vars
  const ssUser = process.env.SSACTIVEWEAR_USER || "";
  const ssKey = process.env.SSACTIVEWEAR_KEY || "";
  let apiStatus = { connected: false, message: "No credentials configured", categoryCount: 0 };

  try {
    const client = new SSActiveWearClient();
    const categories = await client.getCategories();
    apiStatus = {
      connected: true,
      message: "Successfully connected to SSActiveWear",
      categoryCount: categories.length,
    };
  } catch (e: any) {
    apiStatus = { connected: false, message: e.message || "Failed to connect", categoryCount: 0 };
  }

  const settings = {
    ssActivewearUser: ssUser,
    ssActivewearKeyConfigured: !!ssKey,
    defaultShippingMethod: process.env.SS_DEFAULT_SHIPPING || "1",
    r2BucketUrl: process.env.R2_PUBLIC_URL || "https://img-ssa-e.techifyboost.com",
  };

  let uploadLocations = [];
  try {
    uploadLocations = await (prisma as any).uploadLocation.findMany({
      where: { shop },
      orderBy: { sortOrder: 'asc' },
    });
  } catch (e) {
    console.error("UploadLocation query failed:", e);
  }

  return json<LoaderData>({ settings, apiStatus, uploadLocations });
}

export async function action({ request }: ActionFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const actionType = formData.get("action");

  if (actionType === "save_upload_locations") {
    const locations = JSON.parse(formData.get("locations") as string);

    try {
      // Clear existing and recreate (simple sync approach)
      await (prisma as any).uploadLocation.deleteMany({ where: { shop } });
      for (let i = 0; i < locations.length; i++) {
        const loc = locations[i];
        await (prisma as any).uploadLocation.create({
          data: {
            shop,
            name: loc.label.toLowerCase().replace(/ /g, '_'),
            label: loc.label,
            iconType: loc.iconType,
            sortOrder: i,
          }
        });
      }

      // Fetch the actual Shop GID for robust metafield sync
      const shopInfoResponse = await admin.graphql(`query { shop { id } }`);
      const shopInfo = await shopInfoResponse.json();
      const shopId = shopInfo.data?.shop?.id;

      // Sync to Shopify Metafields
      await admin.graphql(`
        mutation storefrontUpdate($input: MetafieldsSetInput!) {
          metafieldsSet(metafields: [$input]) {
            metafields { id key value }
          }
        }
      `, {
        variables: {
          input: {
            ownerId: shopId,
            namespace: "ss_custom",
            key: "upload_locations",
            type: "json",
            value: JSON.stringify(locations.map((l: any) => ({
              label: l.label,
              name: l.label.toLowerCase().replace(/ /g, '_'),
              icon: l.iconType
            })))
          }
        }
      });

      return json({ success: true, message: "Upload locations updated" });
    } catch (e: any) {
      return json({ success: false, message: e.message });
    }
  }

  return json({ success: true, message: "Settings saved successfully" });
}

function UploadLocationsCard({ initialLocations }: { initialLocations: any[] }) {
  const [locations, setLocations] = useState(initialLocations && initialLocations.length > 0 ? initialLocations : [
    { label: "Front", iconType: "front" },
    { label: "Back", iconType: "back" }
  ]);
  const submit = useSubmit();
  const nav = useNavigation();
  const isSaving = nav.state === "submitting" && nav.formData?.get("action") === "save_upload_locations";

  const updateLocation = (index: number, field: string, value: any) => {
    const newLocs = [...locations];
    newLocs[index] = { ...newLocs[index], [field]: value };
    setLocations(newLocs);
  };

  const addLocation = () => setLocations([...locations, { label: "New", iconType: "custom" }]);
  const removeLocation = (index: number) => setLocations(locations.filter((_, i) => i !== index));

  const handleSave = () => {
    const formData = new FormData();
    formData.set("action", "save_upload_locations");
    formData.set("locations", JSON.stringify(locations));
    submit(formData, { method: "post" });
  };

  return (
    <Card>
      <BlockStack gap="400">
        <InlineStack align="space-between">
          <Text as="h2" variant="headingMd">Upload Locations</Text>
          <Button onClick={addLocation} size="slim">Add Location</Button>
        </InlineStack>
        <Divider />
        <BlockStack gap="400">
          {locations.map((loc, index) => (
            <Box key={index} background="bg-surface-secondary" padding="300" borderRadius="200">
              <InlineGrid columns={3} gap="300">
                <TextField label="Label" value={loc.label} onChange={(v) => updateLocation(index, "label", v)} autoComplete="off" />
                <Select label="Icon" options={[
                  { label: "Full Front", value: "full_front" },
                  { label: "Full Back", value: "full_back" },
                  { label: "Left Chest", value: "left_chest" },
                  { label: "Right Chest", value: "right_chest" },
                  { label: "Left Sleeve", value: "left_sleeve" },
                  { label: "Right Sleeve", value: "right_sleeve" },
                  { label: "Custom", value: "custom" },
                ]} value={loc.iconType} onChange={(v) => updateLocation(index, "iconType", v)} />
                <div style={{ alignSelf: 'end' }}><Button variant="plain" tone="critical" onClick={() => removeLocation(index)}>×</Button></div>
              </InlineGrid>
            </Box>
          ))}
        </BlockStack>
        <InlineStack align="end"><Button variant="primary" onClick={handleSave} loading={isSaving}>Update Locations</Button></InlineStack>
      </BlockStack>
    </Card>
  );
}

export default function SettingsPage() {
  const { settings, apiStatus, uploadLocations } = useLoaderData<LoaderData>();
  const actionData = useActionData<any>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.success) shopify.toast.show(actionData.message);
    else if (actionData?.success === false) shopify.toast.show(actionData.message, { isError: true });
  }, [actionData, shopify]);

  return (
    <Page title="Settings">
      <TitleBar title="App Settings" />
      <BlockStack gap="600">
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">API Connection Status</Text>
            <Box padding="400" borderRadius="200" background={apiStatus.connected ? "bg-surface-success" : "bg-surface-critical"}>
              <InlineStack gap="300">
                <Icon source={apiStatus.connected ? CheckCircleIcon : XCircleIcon} tone={apiStatus.connected ? "success" : "critical"} />
                <Text as="span">{apiStatus.message}</Text>
              </InlineStack>
            </Box>
          </BlockStack>
        </Card>

        <UploadLocationsCard initialLocations={uploadLocations} />

        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">General Config</Text>
            <FormLayout>
              <TextField label="Account" value={settings.ssActivewearUser} disabled autoComplete="off" />
              <Select label="Shipping" options={SS_SHIPPING_METHODS} value={settings.defaultShippingMethod} disabled />
            </FormLayout>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
