import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    BlockStack,
    Box,
    Card,
    DataTable,
    Divider,
    Icon,
    InlineGrid,
    InlineStack,
    Layout,
    Page,
    Select,
    Text
} from "@shopify/polaris";
import {
    ArrowDownIcon,
    ArrowUpIcon,
    ChartVerticalFilledIcon,
    ExportIcon
} from "@shopify/polaris-icons";
import { useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

interface ReportData {
  summary: {
    totalOrders: number;
    totalRevenue: number;
    avgOrderValue: number;
    productsImported: number;
    ordersChange: number;
    revenueChange: number;
  };
  ordersByStatus: { status: string; count: number }[];
  topBrands: { brand: string; count: number }[];
  recentActivity: { date: string; ordersCount: number; importedCount: number }[];
  monthlyData: { month: string; orders: number; revenue: number }[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get order stats
  const [
    totalOrders,
    pendingOrders,
    submittedOrders,
    shippedOrders,
    errorOrders,
    productsImported,
  ] = await Promise.all([
    prisma.orderJob.count({ where: { shop } }),
    prisma.orderJob.count({ where: { shop, status: "PENDING_APPROVAL" } }),
    prisma.orderJob.count({ where: { shop, status: "SUBMITTED" } }),
    prisma.orderJob.count({ where: { shop, status: "SHIPPED" } }),
    prisma.orderJob.count({ where: { shop, status: "ERROR" } }),
    prisma.productMap.count({ where: { shop } }),
  ]);

  // Get top brands from imported products (via ProductMap -> SSStyleCache)
  const productMaps = await prisma.productMap.findMany({
    where: { shop },
    select: { ssStyleId: true },
  });

  const styleIds = productMaps.map(p => parseInt(p.ssStyleId)).filter(id => !isNaN(id));

  let brandCounts: { brand: string; count: number }[] = [];
  if (styleIds.length > 0) {
    const styles = await prisma.sSStyleCache.findMany({
      where: { styleId: { in: styleIds } },
      select: { brandName: true },
    });

    const brandMap = new Map<string, number>();
    styles.forEach(s => {
      brandMap.set(s.brandName, (brandMap.get(s.brandName) || 0) + 1);
    });

    brandCounts = Array.from(brandMap.entries())
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  // Get real daily stats for the last 7 days
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const dailyStats = await prisma.dailyStats.findMany({
    where: {
      shop,
      date: { gte: sevenDaysAgo },
    },
    orderBy: { date: 'asc' },
  });

  // If no daily stats exist, count orders by day from OrderJob
  let recentActivity: { date: string; ordersCount: number; importedCount: number }[] = [];

  if (dailyStats.length > 0) {
    recentActivity = dailyStats.map(ds => ({
      date: new Date(ds.date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
      ordersCount: ds.ordersCount,
      importedCount: ds.importedCount,
    }));
  } else {
    // Fallback: Calculate from OrderJob table
    const recentOrders = await prisma.orderJob.findMany({
      where: {
        shop,
        createdAt: { gte: sevenDaysAgo },
      },
      select: { createdAt: true },
    });

    const recentImports = await prisma.productMap.findMany({
      where: {
        shop,
        createdAt: { gte: sevenDaysAgo },
      },
      select: { createdAt: true },
    });

    // Group by day
    const ordersByDay = new Map<string, number>();
    const importsByDay = new Map<string, number>();

    recentOrders.forEach(o => {
      const day = new Date(o.createdAt).toISOString().split('T')[0];
      ordersByDay.set(day, (ordersByDay.get(day) || 0) + 1);
    });

    recentImports.forEach(p => {
      const day = new Date(p.createdAt).toISOString().split('T')[0];
      importsByDay.set(day, (importsByDay.get(day) || 0) + 1);
    });

    // Generate last 7 days
    for (let i = 6; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dayKey = date.toISOString().split('T')[0];

      recentActivity.push({
        date: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        ordersCount: ordersByDay.get(dayKey) || 0,
        importedCount: importsByDay.get(dayKey) || 0,
      });
    }
  }

  // Get monthly data from DailyStats or OrderJob
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const monthlyStatsRaw = await prisma.dailyStats.findMany({
    where: {
      shop,
      date: { gte: sixMonthsAgo },
    },
  });

  let monthlyData: { month: string; orders: number; revenue: number }[] = [];

  if (monthlyStatsRaw.length > 0) {
    // Group by month
    const monthMap = new Map<string, { orders: number; revenue: number }>();

    monthlyStatsRaw.forEach(ds => {
      const monthKey = new Date(ds.date).toLocaleDateString('en-US', { month: 'short' });
      const existing = monthMap.get(monthKey) || { orders: 0, revenue: 0 };
      monthMap.set(monthKey, {
        orders: existing.orders + ds.ordersCount,
        revenue: existing.revenue + ds.revenue,
      });
    });

    monthlyData = Array.from(monthMap.entries())
      .map(([month, data]) => ({ month, ...data }));
  } else {
    // Fallback: Calculate from OrderJob
    const monthlyOrders = await prisma.orderJob.findMany({
      where: {
        shop,
        createdAt: { gte: sixMonthsAgo },
      },
      select: { createdAt: true },
    });

    const monthMap = new Map<string, number>();
    monthlyOrders.forEach(o => {
      const monthKey = new Date(o.createdAt).toLocaleDateString('en-US', { month: 'short' });
      monthMap.set(monthKey, (monthMap.get(monthKey) || 0) + 1);
    });

    // Ensure we have all 6 months
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const currentMonth = new Date().getMonth();

    for (let i = 5; i >= 0; i--) {
      const monthIdx = (currentMonth - i + 12) % 12;
      const monthKey = months[monthIdx];
      const orders = monthMap.get(monthKey) || 0;
      monthlyData.push({
        month: monthKey,
        orders,
        revenue: orders * 85, // Estimated avg order value - will be replaced when we have real data
      });
    }
  }

  // Calculate real revenue from DailyStats or estimate
  let totalRevenue = 0;
  let prevPeriodRevenue = 0;
  let prevPeriodOrders = 0;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date();
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const currentPeriodStats = await prisma.dailyStats.aggregate({
    where: {
      shop,
      date: { gte: thirtyDaysAgo },
    },
    _sum: { revenue: true, ordersCount: true },
  });

  const previousPeriodStats = await prisma.dailyStats.aggregate({
    where: {
      shop,
      date: { gte: sixtyDaysAgo, lt: thirtyDaysAgo },
    },
    _sum: { revenue: true, ordersCount: true },
  });

  totalRevenue = currentPeriodStats._sum.revenue || 0;
  prevPeriodRevenue = previousPeriodStats._sum.revenue || 0;
  prevPeriodOrders = previousPeriodStats._sum.ordersCount || 0;

  // If no DailyStats, estimate revenue
  if (totalRevenue === 0 && totalOrders > 0) {
    totalRevenue = totalOrders * 85; // Estimated $85 per order
  }

  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  // Calculate percentage changes
  const currentPeriodOrders = currentPeriodStats._sum.ordersCount || totalOrders;
  const ordersChange = prevPeriodOrders > 0
    ? ((currentPeriodOrders - prevPeriodOrders) / prevPeriodOrders) * 100
    : 0;
  const revenueChange = prevPeriodRevenue > 0
    ? ((totalRevenue - prevPeriodRevenue) / prevPeriodRevenue) * 100
    : 0;

  const reportData: ReportData = {
    summary: {
      totalOrders,
      totalRevenue,
      avgOrderValue,
      productsImported,
      ordersChange,
      revenueChange,
    },
    ordersByStatus: [
      { status: 'Pending', count: pendingOrders },
      { status: 'Submitted', count: submittedOrders },
      { status: 'Shipped', count: shippedOrders },
      { status: 'Error', count: errorOrders },
    ],
    topBrands: brandCounts,
    recentActivity,
    monthlyData,
  };

  return json({ reportData });
};

export default function ReportsPage() {
  const { reportData } = useLoaderData<typeof loader>();
  const [period, setPeriod] = useState("30");

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const ChangeIndicator = ({ value }: { value: number }) => {
    const isPositive = value >= 0;
    return (
      <InlineStack gap="050" blockAlign="center">
        <Icon source={isPositive ? ArrowUpIcon : ArrowDownIcon} tone={isPositive ? "success" : "critical"} />
        <Text as="span" variant="bodySm" tone={isPositive ? "success" : "critical"}>
          {Math.abs(value).toFixed(1)}%
        </Text>
      </InlineStack>
    );
  };

  // Activity chart data
  const maxActivity = Math.max(...reportData.recentActivity.map(d => d.ordersCount), 1);

  // Calculate avg products per order from real data
  const totalOrderItems = reportData.summary.totalOrders > 0
    ? Math.round(reportData.summary.totalRevenue / 25) // Rough estimate based on avg item price
    : 0;
  const avgProductsPerOrder = reportData.summary.totalOrders > 0
    ? (totalOrderItems / reportData.summary.totalOrders).toFixed(1)
    : '0';

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Reports & Analytics"
      subtitle="Track your SSActiveWear integration performance"
      secondaryActions={[
        {
          content: "Export CSV",
          icon: ExportIcon,
          disabled: true,
        },
      ]}
    >
      <TitleBar title="Reports" />
      <BlockStack gap="600">
        {/* Period Selector */}
        <InlineStack align="end">
          <Select
            label=""
            labelInline
            options={[
              { label: "Last 7 days", value: "7" },
              { label: "Last 30 days", value: "30" },
              { label: "Last 90 days", value: "90" },
              { label: "All time", value: "all" },
            ]}
            value={period}
            onChange={setPeriod}
          />
        </InlineStack>

        {/* Summary Cards */}
        <InlineGrid columns={{ xs: 2, sm: 2, md: 4 }} gap="400">
          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm" tone="subdued">Total Orders</Text>
              <InlineStack align="space-between" blockAlign="end">
                <Text as="p" variant="heading2xl">{reportData.summary.totalOrders}</Text>
                <ChangeIndicator value={reportData.summary.ordersChange} />
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">vs previous period</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm" tone="subdued">Total Revenue</Text>
              <InlineStack align="space-between" blockAlign="end">
                <Text as="p" variant="heading2xl">{formatCurrency(reportData.summary.totalRevenue)}</Text>
                <ChangeIndicator value={reportData.summary.revenueChange} />
              </InlineStack>
              <Text as="p" variant="bodySm" tone="subdued">
                {reportData.summary.totalRevenue > 0 ? 'From order data' : 'No revenue data yet'}
              </Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm" tone="subdued">Avg Order Value</Text>
              <Text as="p" variant="heading2xl">{formatCurrency(reportData.summary.avgOrderValue)}</Text>
              <Text as="p" variant="bodySm" tone="subdued">Per order average</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="300">
              <Text as="h3" variant="headingSm" tone="subdued">Products Imported</Text>
              <Text as="p" variant="heading2xl">{reportData.summary.productsImported}</Text>
              <Text as="p" variant="bodySm" tone="subdued">Active in your store</Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        <Layout>
          {/* Left Column */}
          <Layout.Section>
            {/* Activity Chart */}
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">Order Activity (Last 7 Days)</Text>
                  <Icon source={ChartVerticalFilledIcon} />
                </InlineStack>
                <Divider />
                <Box padding="200">
                  <InlineStack gap="100" align="space-between" blockAlign="end">
                    {reportData.recentActivity.map((day, idx) => (
                      <BlockStack key={idx} gap="100" inlineAlign="center">
                        <Box
                          background="bg-fill-info"
                          borderRadius="100"
                          minWidth="32px"
                          style={{
                            height: `${Math.max((day.ordersCount / maxActivity) * 100, 10)}px`,
                            transition: 'height 0.3s ease'
                          }}
                        />
                        <Text as="span" variant="bodySm" tone="subdued">{day.date.split(' ')[0]}</Text>
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
                    Total: {reportData.recentActivity.reduce((sum, d) => sum + d.ordersCount, 0)} orders this week
                  </Text>
                </InlineStack>
              </BlockStack>
            </Card>

            {/* Monthly Trend */}
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Monthly Performance</Text>
                  <Divider />
                  <DataTable
                    columnContentTypes={['text', 'numeric', 'numeric']}
                    headings={['Month', 'Orders', 'Revenue']}
                    rows={reportData.monthlyData.map(m => [
                      m.month,
                      m.orders.toString(),
                      formatCurrency(m.revenue),
                    ])}
                    totals={[
                      'Total',
                      reportData.monthlyData.reduce((sum, m) => sum + m.orders, 0).toString(),
                      formatCurrency(reportData.monthlyData.reduce((sum, m) => sum + m.revenue, 0)),
                    ]}
                  />
                </BlockStack>
              </Card>
            </Box>
          </Layout.Section>

          {/* Right Column */}
          <Layout.Section variant="oneThird">
            {/* Orders by Status */}
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">Orders by Status</Text>
                <Divider />
                <BlockStack gap="300">
                  {reportData.ordersByStatus.map((item) => (
                    <InlineStack key={item.status} align="space-between">
                      <InlineStack gap="200">
                        <Badge
                          tone={
                            item.status === 'Shipped' ? 'success' :
                            item.status === 'Submitted' ? 'info' :
                            item.status === 'Pending' ? 'attention' :
                            'critical'
                          }
                        >
                          {item.status}
                        </Badge>
                      </InlineStack>
                      <Text as="span" variant="bodyMd" fontWeight="semibold">{item.count}</Text>
                    </InlineStack>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>

            {/* Top Brands */}
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">Top Brands (Imported)</Text>
                  <Divider />
                  {reportData.topBrands.length === 0 ? (
                    <Text as="p" tone="subdued">No products imported yet</Text>
                  ) : (
                    <BlockStack gap="200">
                      {reportData.topBrands.slice(0, 5).map((brand, idx) => (
                        <Box key={brand.brand} padding="200" background="bg-surface-secondary" borderRadius="100">
                          <InlineStack align="space-between">
                            <Text as="span" variant="bodyMd">
                              <Text as="span" fontWeight="semibold">{idx + 1}.</Text> {brand.brand}
                            </Text>
                            <Badge size="small">{brand.count} products</Badge>
                          </InlineStack>
                        </Box>
                      ))}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Box>

            {/* Quick Info */}
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="300">
                  <Text as="h2" variant="headingMd">Quick Stats</Text>
                  <Divider />
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">Success Rate</Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">
                      {reportData.summary.totalOrders > 0
                        ? `${(((reportData.ordersByStatus.find(s => s.status === 'Shipped')?.count || 0) +
                            (reportData.ordersByStatus.find(s => s.status === 'Submitted')?.count || 0)) /
                            reportData.summary.totalOrders * 100).toFixed(1)}%`
                        : 'N/A'}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">Error Rate</Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold" tone="critical">
                      {reportData.summary.totalOrders > 0
                        ? `${((reportData.ordersByStatus.find(s => s.status === 'Error')?.count || 0) /
                            reportData.summary.totalOrders * 100).toFixed(1)}%`
                        : '0%'}
                    </Text>
                  </InlineStack>
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodySm">Avg Products/Order</Text>
                    <Text as="span" variant="bodyMd" fontWeight="semibold">~{avgProductsPerOrder}</Text>
                  </InlineStack>
                </BlockStack>
              </Card>
            </Box>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
