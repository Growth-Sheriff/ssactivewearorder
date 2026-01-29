import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    BlockStack,
    Box,
    Button,
    Card,
    Divider,
    Icon,
    InlineStack,
    Layout,
    Page,
    Text,
} from "@shopify/polaris";
import {
    ImportIcon,
    OrderIcon,
    ProductIcon
} from "@shopify/polaris-icons";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // Get stats from database
  const [productCount, pendingOrders, submittedOrders] = await Promise.all([
    prisma.productMap.count(),
    prisma.orderJob.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.orderJob.count({ where: { status: "SUBMITTED" } }),
  ]);

  return json({
    stats: {
      importedProducts: productCount,
      pendingOrders,
      submittedOrders,
    },
  });
};

export default function Dashboard() {
  const { stats } = useLoaderData<typeof loader>();

  return (
    <Page>
      <TitleBar title="SSActiveWear Integration" />
      <BlockStack gap="600">
        {/* Welcome Banner */}
        <Card>
          <BlockStack gap="400">
            <Text as="h1" variant="headingXl">
              Welcome to SSActiveWear Integration 🎯
            </Text>
            <Text as="p" variant="bodyLg" tone="subdued">
              Import products from SSActiveWear's 250k+ SKU catalog, manage orders, and sync fulfillment automatically.
            </Text>
            <InlineStack gap="300">
              <Button url="/app/catalog" variant="primary">
                Browse Catalog
              </Button>
              <Button url="/app/orders">View Orders</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Stats Cards */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Imported Products
                  </Text>
                  <Icon source={ProductIcon} tone="base" />
                </InlineStack>
                <Text as="p" variant="heading2xl">
                  {stats.importedProducts}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Products synced from SSActiveWear
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Pending Orders
                  </Text>
                  <Badge tone="attention">{stats.pendingOrders}</Badge>
                </InlineStack>
                <Text as="p" variant="heading2xl">
                  {stats.pendingOrders}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Awaiting your approval
                </Text>
                {stats.pendingOrders > 0 && (
                  <Button url="/app/orders" size="slim">
                    Review Now
                  </Button>
                )}
              </BlockStack>
            </Card>
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="300">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">
                    Submitted Orders
                  </Text>
                  <Badge tone="success">{stats.submittedOrders}</Badge>
                </InlineStack>
                <Text as="p" variant="heading2xl">
                  {stats.submittedOrders}
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Sent to SSActiveWear
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Quick Actions */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              Quick Actions
            </Text>
            <Divider />
            <Layout>
              <Layout.Section variant="oneHalf">
                <Box
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <InlineStack gap="200">
                      <Icon source={ImportIcon} tone="primary" />
                      <Text as="h3" variant="headingMd">
                        Import Products
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Search SSActiveWear's catalog and import products to your store with one click.
                    </Text>
                    <Button url="/app/catalog">Browse Catalog →</Button>
                  </BlockStack>
                </Box>
              </Layout.Section>

              <Layout.Section variant="oneHalf">
                <Box
                  background="bg-surface-secondary"
                  padding="400"
                  borderRadius="200"
                >
                  <BlockStack gap="300">
                    <InlineStack gap="200">
                      <Icon source={OrderIcon} tone="primary" />
                      <Text as="h3" variant="headingMd">
                        Process Orders
                      </Text>
                    </InlineStack>
                    <Text as="p" variant="bodyMd" tone="subdued">
                      Review incoming orders and send them to SSActiveWear for fulfillment.
                    </Text>
                    <Button url="/app/orders">View Orders →</Button>
                  </BlockStack>
                </Box>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Card>

        {/* How It Works */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">
              How It Works
            </Text>
            <Divider />
            <Layout>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Badge tone="info">Step 1</Badge>
                  <Text as="h3" variant="headingMd">
                    Browse & Import
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Search SSActiveWear's catalog and import products directly to your Shopify store.
                  </Text>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Badge tone="info">Step 2</Badge>
                  <Text as="h3" variant="headingMd">
                    Receive Orders
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    When customers order, the system captures the order and queues it for your approval.
                  </Text>
                </BlockStack>
              </Layout.Section>
              <Layout.Section variant="oneThird">
                <BlockStack gap="200">
                  <Badge tone="info">Step 3</Badge>
                  <Text as="h3" variant="headingMd">
                    Approve & Ship
                  </Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Review orders, approve them, and SSActiveWear handles fulfillment automatically.
                  </Text>
                </BlockStack>
              </Layout.Section>
            </Layout>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
