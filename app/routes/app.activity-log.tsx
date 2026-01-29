import type { LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData, useSearchParams } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    BlockStack,
    Box,
    Button,
    Card,
    Divider,
    EmptyState,
    Icon,
    InlineStack,
    Layout,
    Page,
    Pagination,
    Select,
    Text,
    TextField,
} from "@shopify/polaris";
import {
    ClockIcon,
    ImportIcon,
    OrderIcon,
    PersonIcon,
    RefreshIcon,
    SettingsIcon,
} from "@shopify/polaris-icons";
import { useCallback } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const ITEMS_PER_PAGE = 25;

interface ActivityItem {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  resource: string;
  resourceId: string | null;
  details: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const action = url.searchParams.get("action") || "";
  const resource = url.searchParams.get("resource") || "";

  const where: Record<string, unknown> = { shop };
  if (action) where.action = { contains: action };
  if (resource) where.resource = resource;

  const [activities, totalCount, actionStats] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: ITEMS_PER_PAGE,
      skip: (page - 1) * ITEMS_PER_PAGE,
    }),
    prisma.activityLog.count({ where }),
    prisma.activityLog.groupBy({
      by: ['action'],
      where: { shop },
      _count: true,
      orderBy: { _count: { action: 'desc' } },
      take: 10,
    }),
  ]);

  // Get stats
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const [todayCount, uniqueUsers] = await Promise.all([
    prisma.activityLog.count({
      where: { shop, createdAt: { gte: todayStart } },
    }),
    prisma.activityLog.findMany({
      where: { shop, userEmail: { not: null } },
      distinct: ['userEmail'],
      select: { userEmail: true },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return json({
    activities: activities.map((a): ActivityItem => ({
      ...a,
      createdAt: a.createdAt.toISOString(),
    })),
    pagination: { page, totalPages, totalCount },
    stats: {
      todayCount,
      totalCount,
      uniqueUsers: uniqueUsers.length,
    },
    actionStats: actionStats.map(a => ({ action: a.action, count: a._count })),
    filters: { action, resource },
  });
};

export default function ActivityLogPage() {
  const { activities, pagination, stats, actionStats, filters } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleFilter = useCallback((key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    params.set("page", "1");
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const handlePageChange = useCallback((newPage: number) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", newPage.toString());
    setSearchParams(params);
  }, [searchParams, setSearchParams]);

  const getActionIcon = (action: string) => {
    if (action.includes("import")) return ImportIcon;
    if (action.includes("order")) return OrderIcon;
    if (action.includes("setting")) return SettingsIcon;
    if (action.includes("login") || action.includes("user")) return PersonIcon;
    return ClockIcon;
  };

  const getActionBadgeTone = (action: string): "success" | "info" | "warning" | "critical" | undefined => {
    if (action.includes("create") || action.includes("import")) return "success";
    if (action.includes("update") || action.includes("change")) return "info";
    if (action.includes("delete") || action.includes("remove")) return "critical";
    if (action.includes("error") || action.includes("fail")) return "critical";
    return undefined;
  };

  const formatAction = (action: string) => {
    return action.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const parseDetails = (details: string | null): Record<string, unknown> | null => {
    if (!details) return null;
    try {
      return JSON.parse(details);
    } catch {
      return null;
    }
  };

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Activity Log"
      subtitle="Track all actions and changes in your account"
      secondaryActions={[
        {
          content: "Refresh",
          icon: RefreshIcon,
          onAction: () => window.location.reload(),
        },
      ]}
    >
      <TitleBar title="Activity Log" />
      <BlockStack gap="600">
        {/* Stats */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Today</Text>
                <Text as="p" variant="heading2xl">{stats.todayCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Total Activities</Text>
                <Text as="p" variant="heading2xl">{stats.totalCount.toLocaleString()}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h3" variant="headingSm" tone="subdued">Users</Text>
                <Text as="p" variant="heading2xl">{stats.uniqueUsers}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Filters */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Filters</Text>
            <InlineStack gap="400">
              <div style={{ width: "200px" }}>
                <TextField
                  label="Action"
                  value={filters.action}
                  onChange={(v) => handleFilter("action", v)}
                  autoComplete="off"
                  placeholder="product_imported"
                />
              </div>
              <div style={{ width: "200px" }}>
                <Select
                  label="Resource"
                  options={[
                    { label: "All", value: "" },
                    { label: "Product", value: "product" },
                    { label: "Order", value: "order" },
                    { label: "Setting", value: "setting" },
                    { label: "User", value: "user" },
                  ]}
                  value={filters.resource}
                  onChange={(v) => handleFilter("resource", v)}
                />
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Quick Action Filters */}
        {actionStats.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Top Actions</Text>
              <InlineStack gap="200" wrap>
                {actionStats.map(a => (
                  <Button
                    key={a.action}
                    size="slim"
                    variant={filters.action === a.action ? "primary" : "tertiary"}
                    onClick={() => handleFilter("action", filters.action === a.action ? "" : a.action)}
                  >
                    {formatAction(a.action)} ({a.count})
                  </Button>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Activity Timeline */}
        {activities.length === 0 ? (
          <Card>
            <EmptyState
              heading="No activity yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Actions like importing products and submitting orders will appear here.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <BlockStack gap="400">
              {activities.map((activity, idx) => {
                const details = parseDetails(activity.details);
                return (
                  <Box key={activity.id}>
                    {idx > 0 && <Divider />}
                    <Box paddingBlockStart={idx > 0 ? "400" : "0"}>
                      <InlineStack gap="400" blockAlign="start">
                        <Box
                          background="bg-fill-secondary"
                          padding="200"
                          borderRadius="full"
                        >
                          <Icon source={getActionIcon(activity.action)} />
                        </Box>
                        <BlockStack gap="100">
                          <InlineStack gap="200" wrap>
                            <Badge tone={getActionBadgeTone(activity.action)}>
                              {formatAction(activity.action)}
                            </Badge>
                            <Text as="span" variant="bodySm" tone="subdued">
                              on {activity.resource}
                            </Text>
                            {activity.resourceId && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                #{activity.resourceId}
                              </Text>
                            )}
                          </InlineStack>
                          {activity.userEmail && (
                            <Text as="span" variant="bodySm">
                              by {activity.userEmail}
                            </Text>
                          )}
                          {details && Object.keys(details).length > 0 && (
                            <Box background="bg-surface-secondary" padding="200" borderRadius="100">
                              <Text as="span" variant="bodySm" tone="subdued">
                                {Object.entries(details).map(([k, v]) => `${k}: ${v}`).join(', ')}
                              </Text>
                            </Box>
                          )}
                          <InlineStack gap="200">
                            <Text as="span" variant="bodySm" tone="subdued">
                              {formatDate(activity.createdAt)}
                            </Text>
                            {activity.ipAddress && (
                              <Text as="span" variant="bodySm" tone="subdued">
                                • IP: {activity.ipAddress}
                              </Text>
                            )}
                          </InlineStack>
                        </BlockStack>
                      </InlineStack>
                    </Box>
                  </Box>
                );
              })}

              <Divider />
              <InlineStack align="center" gap="400">
                <Pagination
                  hasPrevious={pagination.page > 1}
                  hasNext={pagination.page < pagination.totalPages}
                  onPrevious={() => handlePageChange(pagination.page - 1)}
                  onNext={() => handlePageChange(pagination.page + 1)}
                />
                <Text as="span" variant="bodySm" tone="subdued">
                  Page {pagination.page} of {pagination.totalPages}
                </Text>
              </InlineStack>
            </BlockStack>
          </Card>
        )}
      </BlockStack>
    </Page>
  );
}
