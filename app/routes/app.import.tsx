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
    Page,
    ProgressBar,
    Text,
    Thumbnail,
} from "@shopify/polaris";
import { useEffect } from "react";
import { ImporterService } from "../services/importer.server";
import { SSActiveWearClient, type SSStyle } from "../services/ssactivewear";
import { authenticate } from "../shopify.server";

const R2_IMAGE_BASE = "https://img-ssa-e.techifyboost.com";

interface LoaderData {
  style: SSStyle | null;
  products: any[];
  styleId: string | null;
  error?: string;
}

interface ActionData {
  success?: boolean;
  error?: string;
  message?: string;
  productId?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);

  const url = new URL(request.url);
  const styleId = url.searchParams.get("styleId");

  if (!styleId) {
    return json<LoaderData>({ style: null, products: [], styleId: null });
  }

  const client = new SSActiveWearClient();
  try {
    const styles = await client.getStyles();
    const style = styles.find((s: SSStyle) => s.styleID === Number(styleId)) || null;
    const products = await client.getProducts(Number(styleId));

    return json<LoaderData>({ style, products, styleId });
  } catch (error) {
    console.error("Failed to fetch style details:", error);
    return json<LoaderData>({ style: null, products: [], styleId, error: "Failed to fetch from SSActiveWear" });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const styleId = formData.get("styleId") as string;

  if (!styleId) {
    return json<ActionData>({ error: "Style ID required" });
  }

  const importer = new ImporterService();
  try {
    const result = await importer.importStyle(admin, Number(styleId));
    return json<ActionData>({
      success: true,
      message: result?.message || `Successfully imported style ${styleId}`,
      productId: result?.shopifyProduct?.id,
    });
  } catch (error) {
    console.error("Import failed:", error);
    return json<ActionData>({ error: "Import failed. Please try again." });
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

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show("Product imported successfully!");
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const handleImport = () => {
    submit({ styleId: styleId || "" }, { method: "post" });
  };

  // Group products by color
  const colorGroups: Record<string, any[]> = {};
  products.forEach((product: any) => {
    const colorName = product.colorName || "Unknown";
    if (!colorGroups[colorName]) {
      colorGroups[colorName] = [];
    }
    colorGroups[colorName].push(product);
  });

  const uniqueColors = Object.keys(colorGroups).length;
  const uniqueSizes = [...new Set(products.map((p: any) => p.sizeName))].length;

  if (!styleId) {
    return (
      <Page title="Import Products">
        <TitleBar title="Import Products" />
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              No Style Selected
            </Text>
            <Text as="p" variant="bodyMd" tone="subdued">
              Please browse the catalog and select a product to import.
            </Text>
            <Button url="/app/catalog" variant="primary">
              Browse Catalog
            </Button>
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
                <Box
                  background="bg-surface-secondary"
                  padding="600"
                  borderRadius="200"
                >
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
                  <Text as="h2" variant="headingLg">
                    {style?.title}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Style: {style?.partNumber}
                  </Text>
                </BlockStack>

                <Divider />

                {/* Stats */}
                <BlockStack gap="200">
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd">
                      Colors Available
                    </Text>
                    <Badge>{String(uniqueColors)}</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd">
                      Sizes Available
                    </Text>
                    <Badge>{String(uniqueSizes)}</Badge>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd">
                      Total SKUs
                    </Text>
                    <Badge>{String(products.length)}</Badge>
                  </InlineStack>
                </BlockStack>

                <Divider />

                {/* Import Button */}
                <Button
                  variant="primary"
                  fullWidth
                  size="large"
                  loading={isImporting}
                  onClick={handleImport}
                  disabled={actionData?.success}
                >
                  {isImporting ? "Importing..." : "Import to Shopify"}
                </Button>

                {isImporting && (
                  <BlockStack gap="200">
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                      Creating product and variants...
                    </Text>
                    <ProgressBar progress={75} size="small" />
                  </BlockStack>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Variants Preview */}
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Available Variants ({products.length} SKUs)
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  All variants will be imported with Color and Size options.
                </Text>
                <Divider />

                {/* Color Groups */}
                <BlockStack gap="400">
                  {Object.entries(colorGroups).slice(0, 8).map(([colorName, colorProducts]) => (
                    <Box
                      key={colorName}
                      background="bg-surface-secondary"
                      padding="300"
                      borderRadius="200"
                    >
                      <InlineStack gap="400" align="space-between" blockAlign="center">
                        <InlineStack gap="300" blockAlign="center">
                          <Thumbnail
                            source={SSActiveWearClient.buildImageUrl(colorProducts[0]?.colorSwatchImage || colorProducts[0]?.colorFrontImage, 'small')}
                            alt={colorName}
                            size="small"
                          />
                          <BlockStack gap="100">
                            <Text as="span" variant="bodyMd" fontWeight="semibold">
                              {colorName}
                            </Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {colorProducts.length} sizes available
                            </Text>
                          </BlockStack>
                        </InlineStack>
                        <InlineStack gap="100">
                          {colorProducts.slice(0, 6).map((p: any) => (
                            <Badge key={p.sku} size="small">
                              {p.sizeName}
                            </Badge>
                          ))}
                          {colorProducts.length > 6 && (
                            <Badge size="small" tone="info">{`+${colorProducts.length - 6}`}</Badge>
                          )}
                        </InlineStack>
                      </InlineStack>
                    </Box>
                  ))}

                  {Object.keys(colorGroups).length > 8 && (
                    <Text as="p" variant="bodySm" tone="subdued" alignment="center">
                      And {Object.keys(colorGroups).length - 8} more colors...
                    </Text>
                  )}
                </BlockStack>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
