import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    BlockStack,
    Box,
    Card,
    Divider,
    Icon,
    InlineGrid,
    InlineStack,
    Page,
    ProgressBar,
    Text
} from "@shopify/polaris";
import {
    AlertCircleIcon,
    CheckCircleIcon,
    ClockIcon,
    RefreshIcon,
} from "@shopify/polaris-icons";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

interface RateLimitStats {
  apiName: string;
  totalRequests: number;
  endpoints: {
    endpoint: string;
    requestCount: number;
    limitMax: number;
    percentUsed: number;
    isThrottled: boolean;
    lastRequest: string | null;
  }[];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get current rate limits (within last hour)
  const oneHourAgo = new Date();
  oneHourAgo.setHours(oneHourAgo.getHours() - 1);

  const rateLimits = await prisma.apiRateLimit.findMany({
    where: {
      shop,
      windowEnd: { gte: oneHourAgo },
    },
    orderBy: { lastRequest: 'desc' },
  });

  // Group by API
  const apiStats = new Map<string, RateLimitStats>();

  rateLimits.forEach(rl => {
    if (!apiStats.has(rl.apiName)) {
      apiStats.set(rl.apiName, {
        apiName: rl.apiName,
        totalRequests: 0,
        endpoints: [],
      });
    }

    const stats = apiStats.get(rl.apiName)!;
    stats.totalRequests += rl.requestCount;
    stats.endpoints.push({
      endpoint: rl.endpoint,
      requestCount: rl.requestCount,
      limitMax: rl.limitMax,
      percentUsed: Math.round((rl.requestCount / rl.limitMax) * 100),
      isThrottled: rl.isThrottled,
      lastRequest: rl.lastRequest?.toISOString() || null,
    });
  });

  // Get historical stats (last 24 hours)
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

  const historicalData = await prisma.apiRateLimit.findMany({
    where: {
      shop,
      windowStart: { gte: twentyFourHoursAgo },
    },
    orderBy: { windowStart: 'asc' },
  });

  // Calculate hourly totals
  const hourlyStats: { hour: string; requests: number }[] = [];
  const hourMap = new Map<string, number>();

  historicalData.forEach(rl => {
    const hour = new Date(rl.windowStart).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    hourMap.set(hour, (hourMap.get(hour) || 0) + rl.requestCount);
  });

  hourMap.forEach((requests, hour) => {
    hourlyStats.push({ hour, requests });
  });

  // Overall stats
  const totalRequestsToday = await prisma.apiRateLimit.aggregate({
    where: {
      shop,
      windowStart: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    },
    _sum: { requestCount: true },
  });

  const throttledCount = await prisma.apiRateLimit.count({
    where: {
      shop,
      windowEnd: { gte: oneHourAgo },
      isThrottled: true,
    },
  });

  return json({
    apiStats: Array.from(apiStats.values()),
    hourlyStats: hourlyStats.slice(-12), // Last 12 data points
    summary: {
      totalRequestsToday: totalRequestsToday._sum.requestCount || 0,
      activeApis: apiStats.size,
      throttledEndpoints: throttledCount,
    },
  });
};

export default function ApiRateLimitPage() {
  const { apiStats, hourlyStats, summary } = useLoaderData<typeof loader>();

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
  };

  const getUsageColor = (percent: number) => {
    if (percent >= 90) return "critical";
    if (percent >= 70) return "warning";
    return "success";
  };

  // Calculate max for chart
  const maxRequests = Math.max(...hourlyStats.map(h => h.requests), 1);

  return (
    <Page
      backAction={{ url: "/app" }}
      title="API Rate Limits"
      subtitle="Monitor API usage and rate limits"
      secondaryActions={[
        {
          content: "Refresh",
          icon: RefreshIcon,
          onAction: () => window.location.reload(),
        },
      ]}
    >
      <TitleBar title="Rate Limits" />
      <BlockStack gap="600">
        {/* Summary Stats */}
        <InlineGrid columns={{ xs: 1, sm: 3 }} gap="400">
          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingSm" tone="subdued">Requests Today</Text>
                <Icon source={ClockIcon} />
              </InlineStack>
              <Text as="p" variant="heading2xl">{summary.totalRequestsToday.toLocaleString()}</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingSm" tone="subdued">Active APIs</Text>
                <Icon source={CheckCircleIcon} tone="success" />
              </InlineStack>
              <Text as="p" variant="heading2xl">{summary.activeApis}</Text>
            </BlockStack>
          </Card>

          <Card>
            <BlockStack gap="200">
              <InlineStack align="space-between">
                <Text as="h3" variant="headingSm" tone="subdued">Throttled</Text>
                <Icon source={AlertCircleIcon} tone={summary.throttledEndpoints > 0 ? "critical" : "success"} />
              </InlineStack>
              <Text as="p" variant="heading2xl" tone={summary.throttledEndpoints > 0 ? "critical" : undefined}>
                {summary.throttledEndpoints}
              </Text>
            </BlockStack>
          </Card>
        </InlineGrid>

        {/* Hourly Usage Chart */}
        {hourlyStats.length > 0 && (
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">Hourly Request Volume</Text>
              <Divider />
              <Box padding="200">
                <InlineStack gap="100" align="space-between" blockAlign="end">
                  {hourlyStats.map((stat, idx) => (
                    <BlockStack key={idx} gap="100" inlineAlign="center">
                      <Box
                        background="bg-fill-info"
                        borderRadius="100"
                        minWidth="24px"
                      >
                        <div style={{ height: `${Math.max((stat.requests / maxRequests) * 80, 8)}px` }} />
                      </Box>
                      <Text as="span" variant="bodySm" tone="subdued">{stat.hour}</Text>
                    </BlockStack>
                  ))}
                </InlineStack>
              </Box>
            </BlockStack>
          </Card>
        )}

        {/* API Usage Details */}
        {apiStats.length === 0 ? (
          <Card>
            <BlockStack gap="300" inlineAlign="center">
              <Icon source={CheckCircleIcon} tone="success" />
              <Text as="p" variant="bodyMd" tone="subdued">
                No API usage tracked yet. Rate limit data will appear as API calls are made.
              </Text>
            </BlockStack>
          </Card>
        ) : (
          apiStats.map(api => (
            <Card key={api.apiName}>
              <BlockStack gap="400">
                <InlineStack align="space-between">
                  <Text as="h2" variant="headingMd">{api.apiName.toUpperCase()}</Text>
                  <Badge>{api.totalRequests.toLocaleString()} requests</Badge>
                </InlineStack>
                <Divider />
                <BlockStack gap="300">
                  {api.endpoints.map((ep, idx) => (
                    <Box key={idx} padding="300" background="bg-surface-secondary" borderRadius="200">
                      <BlockStack gap="200">
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodyMd" fontWeight="semibold">{ep.endpoint}</Text>
                          <InlineStack gap="200">
                            {ep.isThrottled && (
                              <Badge tone="critical">Throttled</Badge>
                            )}
                            <Text as="span" variant="bodySm">
                              {ep.requestCount} / {ep.limitMax}
                            </Text>
                          </InlineStack>
                        </InlineStack>
                        <ProgressBar
                          progress={ep.percentUsed}
                          tone={getUsageColor(ep.percentUsed)}
                          size="small"
                        />
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm" tone="subdued">
                            {ep.percentUsed}% used
                          </Text>
                          <Text as="span" variant="bodySm" tone="subdued">
                            Last: {formatDate(ep.lastRequest)}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </Box>
                  ))}
                </BlockStack>
              </BlockStack>
            </Card>
          ))
        )}

        {/* Info Card */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">About Rate Limits</Text>
            <Divider />
            <BlockStack gap="200">
              <InlineStack gap="200">
                <Badge tone="success">Green</Badge>
                <Text as="span" variant="bodySm">Under 70% - Normal operation</Text>
              </InlineStack>
              <InlineStack gap="200">
                <Badge tone="warning">Yellow</Badge>
                <Text as="span" variant="bodySm">70-90% - Approaching limit</Text>
              </InlineStack>
              <InlineStack gap="200">
                <Badge tone="critical">Red</Badge>
                <Text as="span" variant="bodySm">Over 90% - Near or at limit</Text>
              </InlineStack>
            </BlockStack>
            <Text as="p" variant="bodySm" tone="subdued">
              SSActiveWear API has a limit of 100 requests per minute. Shopify API limits vary by plan.
              The system automatically tracks and respects these limits.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
