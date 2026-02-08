import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData, useNavigation } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    BlockStack,
    Box,
    Button,
    Card,
    Divider,
    Icon,
    InlineGrid,
    InlineStack,
    Layout,
    Page,
    Text
} from "@shopify/polaris";
import {
    ChartVerticalFilledIcon,
    ClockIcon,
    HeartIcon,
    ImportIcon,
    OrderIcon,
    ProductIcon,
    RefreshIcon,
    SettingsIcon,
    StarFilledIcon,
} from "@shopify/polaris-icons";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

interface DashboardStats {
  importedProducts: number;
  pendingOrders: number;
  submittedOrders: number;
  totalOrders: number;
  favoritesCount: number;
  alertsCount: number;
  recentImports: Array<{ id: string; title: string; brand: string; createdAt: string }>;
  recentOrders: Array<{ id: string; orderNumber: string; status: string; createdAt: string }>;
  syncStatus: { brands: number; categories: number; styles: number; lastSync: string | null };
  weeklyStats: Array<{ day: string; orders: number; revenue: number }>;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get all stats in parallel
  const [
    productCount,
    pendingOrders,
    submittedOrders,
    totalOrders,
    favoritesCount,
    alertsCount,
    recentProducts,
    recentOrderJobs,
    brandsCount,
    categoriesCount,
    stylesCount,
    lastSyncLog,
  ] = await Promise.all([
    prisma.productMap.count({ where: { shop } }),
    prisma.orderJob.count({ where: { shop, status: "pending" } }),
    prisma.orderJob.count({ where: { shop, status: "submitted" } }),
    prisma.orderJob.count({ where: { shop } }),
    prisma.favorite.count({ where: { shop } }),
    prisma.stockAlert.count({ where: { shop, isActive: true } }),
    prisma.productMap.findMany({
      where: { shop },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, ssStyleId: true, shopifyProductId: true, createdAt: true }
    }),
    prisma.orderJob.findMany({
      where: { shop },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { id: true, shopifyOrderNumber: true, status: true, createdAt: true }
    }),
    prisma.sSBrand.count(),
    prisma.sSCategory.count(),
    prisma.sSStyleCache.count(),
    prisma.catalogSyncLog.findFirst({
      where: { status: 'completed' },
      orderBy: { completedAt: 'desc' }
    }),
  ]);

  // Get real weekly stats from DailyStats or fallback to OrderJob grouping
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const dailyStats = await prisma.dailyStats.findMany({
    where: {
      shop,
      date: { gte: sevenDaysAgo },
    },
    orderBy: { date: 'asc' },
  });

  let weeklyStats: Array<{ day: string; orders: number; revenue: number }> = [];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  if (dailyStats.length > 0) {
    // Use real DailyStats data
    weeklyStats = dailyStats.map(ds => ({
      day: dayNames[new Date(ds.date).getDay()],
      orders: ds.ordersCount,
      revenue: ds.revenue,
    }));
  } else {
    // Fallback: Count orders from OrderJob table
    const recentOrdersForStats = await prisma.orderJob.findMany({
      where: {
        shop,
        createdAt: { gte: sevenDaysAgo },
      },
      select: { createdAt: true },
    });

    // Group by day
    const ordersByDay = new Map<string, number>();
    recentOrdersForStats.forEach(o => {
      const day = new Date(o.createdAt).toISOString().split('T')[0];
      ordersByDay.set(day, (ordersByDay.get(day) || 0) + 1);
    });

    // Generate last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayKey = date.toISOString().split('T')[0];
      const ordersCount = ordersByDay.get(dayKey) || 0;

      weeklyStats.push({
        day: dayNames[date.getDay()],
        orders: ordersCount,
        revenue: 0, // Real revenue requires DailyStats table (not yet populated)
      });
    }
  }

  // Get real product names from SSStyleCache
  const styleIds = recentProducts.map(p => parseInt(p.ssStyleId)).filter(id => !isNaN(id));
  const styleDetails = styleIds.length > 0 ? await prisma.sSStyleCache.findMany({
    where: { styleId: { in: styleIds } },
    select: { styleId: true, styleName: true, brandName: true },
  }) : [];

  const styleMap = new Map(styleDetails.map(s => [s.styleId.toString(), s]));

  return json<{ stats: DashboardStats }>({
    stats: {
      importedProducts: productCount,
      pendingOrders,
      submittedOrders,
      totalOrders,
      favoritesCount,
      alertsCount,
      recentImports: recentProducts.map(p => {
        const style = styleMap.get(p.ssStyleId);
        return {
          id: p.id,
          title: style?.styleName || `Style ${p.ssStyleId}`,
          brand: style?.brandName || 'SSActiveWear',
          createdAt: p.createdAt.toISOString()
        };
      }),
      recentOrders: recentOrderJobs.map(o => ({
        id: o.id,
        orderNumber: o.shopifyOrderNumber || 'N/A',
        status: o.status,
        createdAt: o.createdAt.toISOString()
      })),
      syncStatus: {
        brands: brandsCount,
        categories: categoriesCount,
        styles: stylesCount,
        lastSync: lastSyncLog?.completedAt?.toISOString() || null,
      },
      weeklyStats,
    },
  });
};

export default function Dashboard() {
  const { stats } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const maxOrders = Math.max(...stats.weeklyStats.map(d => d.orders), 1);

  return (
    <Page>
      <TitleBar title="Dashboard" />
      <BlockStack gap="600">
        {/* Welcome Banner */}
        <Card>
          <BlockStack gap="400">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="200">
                <Text as="h1" variant="headingXl">
                  Welcome to SSActiveWear Integration 🚀
                </Text>
                <Text as="p" variant="bodyLg" tone="subdued">
                  Import products, manage orders, and automate fulfillment with 250k+ SKUs
                </Text>
              </BlockStack>
              <Button url="/app/settings" icon={SettingsIcon}>Settings</Button>
            </InlineStack>
            <InlineStack gap="300">
              <Button url="/app/catalog" variant="primary">Browse Catalog</Button>
              <Button url="/app/orders">View Orders</Button>
              <Button url="/app/favorites">My Favorites</Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Main Stats Cards */}
        <InlineGrid columns={{ xs: 2, sm: 2, md: 4, lg: 4 }} gap="400">
          {/* Imported Products */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingSm" tone="subdued">Products</Text>
                <Box background="bg-fill-info" padding="100" borderRadius="full">
                  <Icon source={ProductIcon} tone="info" />
                </Box>
              </InlineStack>
              <Text as="p" variant="heading2xl">{stats.importedProducts}</Text>
              <Text as="p" variant="bodySm" tone="subdued">Imported from SSActiveWear</Text>
            </BlockStack>
          </Card>

          {/* Pending Orders */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingSm" tone="subdued">Pending</Text>
                <Box background="bg-fill-warning" padding="100" borderRadius="full">
                  <Icon source={ClockIcon} tone="caution" />
                </Box>
              </InlineStack>
              <Text as="p" variant="heading2xl">{stats.pendingOrders}</Text>
              <InlineStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">Awaiting approval</Text>
                {stats.pendingOrders > 0 && (
                  <Button url="/app/orders" size="slim" variant="plain">Review →</Button>
                )}
              </InlineStack>
            </BlockStack>
          </Card>

          {/* Submitted Orders */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingSm" tone="subdued">Submitted</Text>
                <Box background="bg-fill-success" padding="100" borderRadius="full">
                  <Icon source={OrderIcon} tone="success" />
                </Box>
              </InlineStack>
              <Text as="p" variant="heading2xl">{stats.submittedOrders}</Text>
              <Text as="p" variant="bodySm" tone="subdued">Sent to SSActiveWear</Text>
            </BlockStack>
          </Card>

          {/* Favorites */}
          <Card>
            <BlockStack gap="300">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingSm" tone="subdued">Favorites</Text>
                <Box background="bg-fill-magic" padding="100" borderRadius="full">
                  <Icon source={HeartIcon} tone="magic" />
                </Box>
              </InlineStack>
              <Text as="p" variant="heading2xl">{stats.favoritesCount}</Text>
              <InlineStack gap="200">
                <Text as="p" variant="bodySm" tone="subdued">Saved styles</Text>
                <Button url="/app/favorites" size="slim" variant="plain">View →</Button>
              </InlineStack>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Layout>
          {/* Left Column - Activity & Orders */}
          <Layout.Section>
            {/* Weekly Activity Chart */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Weekly Activity</Text>
                  <Icon source={ChartVerticalFilledIcon} />
                </InlineStack>
                <Divider />
                <Box padding="200">
                  <InlineStack gap="100" align="space-between" blockAlign="end">
                    {stats.weeklyStats.map((day, idx) => (
                      <BlockStack key={idx} gap="100" inlineAlign="center">
                        <Box
                          background="bg-fill-info"
                          borderRadius="100"
                          minWidth="24px"
                          style={{
                            height: `${Math.max((day.orders / maxOrders) * 80, 8)}px`,
                            transition: 'height 0.3s ease'
                          }}
                        />
                        <Text as="span" variant="bodySm" tone="subdued">{day.day}</Text>
                      </BlockStack>
                    ))}
                  </InlineStack>
                </Box>
                <InlineStack gap="400">
                  <InlineStack gap="100">
                    <Box background="bg-fill-info" padding="050" borderRadius="100" minWidth="8px" />
                    <Text as="span" variant="bodySm">Orders</Text>
                  </InlineStack>
                  <Text as="span" variant="bodySm" tone="subdued">
                    Total: {stats.weeklyStats.reduce((sum, d) => sum + d.orders, 0)} orders this week
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Recent Orders */}
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">Recent Orders</Text>
                    <Button url="/app/orders" size="slim" variant="plain">View All →</Button>
                  </InlineStack>
                  <Divider />
                  {stats.recentOrders.length === 0 ? (
                    <Box padding="400">
                      <Text as="p" tone="subdued">No orders yet. Orders will appear here when customers purchase imported products.</Text>
                    </Box>
                  ) : (
                    <BlockStack gap="200">
                      {stats.recentOrders.map((order) => (
                        <Box key={order.id} padding="200" background="bg-surface-secondary" borderRadius="200">
                          <InlineStack align="space-between" blockAlign="center">
                            <BlockStack gap="050">
                              <Text as="span" variant="bodyMd" fontWeight="semibold">
                                Order #{order.orderNumber}
                              </Text>
                              <Text as="span" variant="bodySm" tone="subdued">
                                {formatDate(order.createdAt)}
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
          </Layout.Section>

          {/* Right Column - Quick Actions & Sync Status */}
          <Layout.Section variant="oneThird">
            {/* Quick Actions */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Quick Actions</Text>
                <Divider />
                <BlockStack gap="200">
                  <Button url="/app/catalog" icon={ProductIcon} fullWidth textAlign="left">
                    Browse Catalog
                  </Button>
                  <Button url="/app/bulk-import" icon={ImportIcon} fullWidth textAlign="left">
                    Bulk Import
                  </Button>
                  <Button url="/app/price-rules" icon={StarFilledIcon} fullWidth textAlign="left">
                    Price Rules
                  </Button>
                  <Button url="/app/stock-alerts" icon={RefreshIcon} fullWidth textAlign="left">
                    Stock Alerts ({stats.alertsCount})
                  </Button>
                  <Button url="/app/reports" icon={ChartVerticalFilledIcon} fullWidth textAlign="left">
                    Sales Reports
                  </Button>
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Catalog Sync Status */}
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">Catalog Cache</Text>
                    <Button url="/app/sync" size="slim" variant="plain">Manage →</Button>
                  </InlineStack>
                  <Divider />
                  <BlockStack gap="300">
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">Brands</Text>
                      <Badge tone="success">{stats.syncStatus.brands}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">Categories</Text>
                      <Badge tone="success">{stats.syncStatus.categories}</Badge>
                    </InlineStack>
                    <InlineStack align="space-between">
                      <Text as="span" variant="bodySm">Styles</Text>
                      <Badge tone="success">{stats.syncStatus.styles}</Badge>
                    </InlineStack>
                    {stats.syncStatus.lastSync && (
                      <Text as="p" variant="bodySm" tone="subdued">
                        Last sync: {formatDate(stats.syncStatus.lastSync)}
                      </Text>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Box>

            {/* Recent Imports */}
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Recent Imports</Text>
                  <Divider />
                  {stats.recentImports.length === 0 ? (
                    <Box padding="200">
                      <Text as="p" tone="subdued">No products imported yet.</Text>
                      <Box paddingBlockStart="200">
                        <Button url="/app/catalog" size="slim">Import First Product</Button>
                      </Box>
                    </Box>
                  ) : (
                    <BlockStack gap="200">
                      {stats.recentImports.map((product) => (
                        <Box key={product.id} padding="200" background="bg-surface-secondary" borderRadius="200">
                          <BlockStack gap="050">
                            <Text as="span" variant="bodyMd">{product.title}</Text>
                            <Text as="span" variant="bodySm" tone="subdued">
                              {product.brand} • {formatDate(product.createdAt)}
                            </Text>
                          </BlockStack>
                        </Box>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Box>
          </Layout.Section>
        </Layout>

        {/* How It Works */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingLg">How It Works</Text>
            <Divider />
            <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="200">
                  <Badge tone="info">Step 1</Badge>
                  <Text as="h3" variant="headingMd">Browse & Import</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Search SSActiveWear's catalog and import products with custom pricing rules.
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="200">
                  <Badge tone="info">Step 2</Badge>
                  <Text as="h3" variant="headingMd">Receive Orders</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    When customers order, the system captures and queues orders for your review.
                  </Text>
                </BlockStack>
              </Box>
              <Box background="bg-surface-secondary" padding="400" borderRadius="200">
                <BlockStack gap="200">
                  <Badge tone="info">Step 3</Badge>
                  <Text as="h3" variant="headingMd">Approve & Ship</Text>
                  <Text as="p" variant="bodyMd" tone="subdued">
                    Review orders, approve them, and SSActiveWear handles fulfillment automatically.
                  </Text>
                </BlockStack>
              </Box>
            </InlineGrid>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
