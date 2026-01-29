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

  // Get top brands (from imported products)
  const brandCounts = await prisma.sSStyleCache.groupBy({
    by: ['brandName'],
    _count: true,
    orderBy: { _count: { brandName: 'desc' } },
    take: 10,
  });

  // Generate mock monthly data (would come from DailyStats in production)
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const monthlyData = months.map(month => ({
    month,
    orders: Math.floor(Math.random() * 50) + 10,
    revenue: Math.floor(Math.random() * 5000) + 500,
  }));

  // Mock revenue (would come from actual order data in production)
  const totalRevenue = totalOrders * 85; // Assume $85 avg
  const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

  const reportData: ReportData = {
    summary: {
      totalOrders,
      totalRevenue,
      avgOrderValue,
      productsImported,
      ordersChange: 12.5, // Mock percentage change
      revenueChange: 8.3,
    },
    ordersByStatus: [
      { status: 'Pending', count: pendingOrders },
      { status: 'Submitted', count: submittedOrders },
      { status: 'Shipped', count: shippedOrders },
      { status: 'Error', count: errorOrders },
    ],
    topBrands: brandCounts.map(b => ({
      brand: b.brandName,
      count: b._count,
    })),
    recentActivity: Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      return {
        date: date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }),
        ordersCount: Math.floor(Math.random() * 10),
        importedCount: Math.floor(Math.random() * 5),
      };
    }).reverse(),
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

  // DataTable rows for orders by status
  const statusRows = reportData.ordersByStatus.map(item => [
    item.status,
    item.count.toString(),
    `${((item.count / (reportData.summary.totalOrders || 1)) * 100).toFixed(1)}%`,
  ]);

  // DataTable rows for top brands
  const brandRows = reportData.topBrands.slice(0, 5).map((item, idx) => [
    `${idx + 1}. ${item.brand}`,
    item.count.toString(),
  ]);

  // Activity chart data
  const maxActivity = Math.max(...reportData.recentActivity.map(d => d.ordersCount), 1);

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
              <Text as="p" variant="bodySm" tone="subdued">Estimated from orders</Text>
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
                  <Text as="h2" variant="headingMd">Order Activity</Text>
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
                  <Text as="h2" variant="headingMd">Top Brands</Text>
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
                            <Badge size="small">{brand.count} styles</Badge>
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
                    <Text as="span" variant="bodyMd" fontWeight="semibold">~3.2</Text>
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
