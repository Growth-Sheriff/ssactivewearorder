import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useLoaderData, useNavigation, useSearchParams, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Box,
    Button,
    Card,
    DataTable,
    Divider,
    EmptyState,
    Icon,
    InlineStack,
    Layout,
    Modal,
    Page,
    Pagination,
    Select,
    Text,
    TextField,
} from "@shopify/polaris";
import {
    CheckCircleIcon,
    RefreshIcon,
    XCircleIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

const ITEMS_PER_PAGE = 20;

interface WebhookLogItem {
  id: string;
  topic: string;
  direction: string;
  endpoint: string | null;
  method: string;
  statusCode: number | null;
  duration: number | null;
  success: boolean;
  errorMessage: string | null;
  requestBody: string | null;
  responseBody: string | null;
  createdAt: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const topic = url.searchParams.get("topic") || "";
  const direction = url.searchParams.get("direction") || "";
  const success = url.searchParams.get("success");

  // Build where clause
  const where: Record<string, unknown> = { shop };
  if (topic) where.topic = { contains: topic };
  if (direction) where.direction = direction;
  if (success === "true") where.success = true;
  if (success === "false") where.success = false;

  const [logs, totalCount, topicStats] = await Promise.all([
    prisma.webhookLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: ITEMS_PER_PAGE,
      skip: (page - 1) * ITEMS_PER_PAGE,
    }),
    prisma.webhookLog.count({ where }),
    prisma.webhookLog.groupBy({
      by: ['topic'],
      where: { shop },
      _count: true,
      orderBy: { _count: { topic: 'desc' } },
      take: 10,
    }),
  ]);

  // Get success/failure stats
  const [successCount, failureCount, todayCount] = await Promise.all([
    prisma.webhookLog.count({ where: { shop, success: true } }),
    prisma.webhookLog.count({ where: { shop, success: false } }),
    prisma.webhookLog.count({
      where: {
        shop,
        createdAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
      },
    }),
  ]);

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  return json({
    logs: logs.map((l): WebhookLogItem => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
    })),
    pagination: { page, totalPages, totalCount },
    stats: {
      successCount,
      failureCount,
      todayCount,
      successRate: successCount + failureCount > 0
        ? ((successCount / (successCount + failureCount)) * 100).toFixed(1)
        : "0",
    },
    topicStats: topicStats.map(t => ({ topic: t.topic, count: t._count })),
    filters: { topic, direction, success },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "clearOld") {
    const daysToKeep = parseInt(formData.get("days") as string) || 7;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    const result = await prisma.webhookLog.deleteMany({
      where: {
        shop,
        createdAt: { lt: cutoffDate },
      },
    });

    return json({ success: true, message: `Deleted ${result.count} old logs` });
  }

  if (action === "clearAll") {
    const result = await prisma.webhookLog.deleteMany({ where: { shop } });
    return json({ success: true, message: `Deleted ${result.count} logs` });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function WebhookLogsPage() {
  const { logs, pagination, stats, topicStats, filters } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const submit = useSubmit();
  const [searchParams, setSearchParams] = useSearchParams();

  const [selectedLog, setSelectedLog] = useState<WebhookLogItem | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [clearDays, setClearDays] = useState("7");

  const isLoading = navigation.state === "loading" || navigation.state === "submitting";

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

  const handleClearOld = useCallback(() => {
    if (!confirm(`Delete logs older than ${clearDays} days?`)) return;
    const formData = new FormData();
    formData.set("action", "clearOld");
    formData.set("days", clearDays);
    submit(formData, { method: "POST" });
  }, [clearDays, submit]);

  const viewDetails = useCallback((log: WebhookLogItem) => {
    setSelectedLog(log);
    setDetailModalOpen(true);
  }, []);

  const formatDuration = (ms: number | null) => {
    if (!ms) return "—";
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const rows = logs.map(log => [
    <Badge key={log.id} tone={log.direction === "incoming" ? "info" : "attention"}>
      {log.direction}
    </Badge>,
    log.topic,
    log.method,
    log.statusCode?.toString() || "—",
    formatDuration(log.duration),
    <Badge key={`status-${log.id}`} tone={log.success ? "success" : "critical"}>
      {log.success ? "Success" : "Failed"}
    </Badge>,
    formatDate(log.createdAt),
    <Button key={`view-${log.id}`} size="slim" variant="plain" onClick={() => viewDetails(log)}>
      View
    </Button>,
  ]);

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Webhook Logs"
      subtitle="Monitor all incoming and outgoing webhook activity"
      secondaryActions={[
        {
          content: "Refresh",
          icon: RefreshIcon,
          onAction: () => window.location.reload(),
        },
      ]}
    >
      <TitleBar title="Webhook Logs" />
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
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm" tone="subdued">Success Rate</Text>
                  <Icon source={CheckCircleIcon} tone="success" />
                </InlineStack>
                <Text as="p" variant="heading2xl" tone="success">{stats.successRate}%</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm" tone="subdued">Failed</Text>
                  <Icon source={XCircleIcon} tone="critical" />
                </InlineStack>
                <Text as="p" variant="heading2xl" tone="critical">{stats.failureCount}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Filters */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">Filters</Text>
            <InlineStack gap="400" wrap>
              <div style={{ width: "200px" }}>
                <TextField
                  label="Topic"
                  value={filters.topic}
                  onChange={(v) => handleFilter("topic", v)}
                  autoComplete="off"
                  placeholder="orders/create"
                />
              </div>
              <div style={{ width: "150px" }}>
                <Select
                  label="Direction"
                  options={[
                    { label: "All", value: "" },
                    { label: "Incoming", value: "incoming" },
                    { label: "Outgoing", value: "outgoing" },
                  ]}
                  value={filters.direction}
                  onChange={(v) => handleFilter("direction", v)}
                />
              </div>
              <div style={{ width: "150px" }}>
                <Select
                  label="Status"
                  options={[
                    { label: "All", value: "" },
                    { label: "Success", value: "true" },
                    { label: "Failed", value: "false" },
                  ]}
                  value={filters.success || ""}
                  onChange={(v) => handleFilter("success", v)}
                />
              </div>
              <div style={{ width: "200px" }}>
                <InlineStack gap="200" blockAlign="end">
                  <TextField
                    label="Clear older than"
                    type="number"
                    value={clearDays}
                    onChange={setClearDays}
                    autoComplete="off"
                    suffix="days"
                  />
                  <Button onClick={handleClearOld} tone="critical">Clear</Button>
                </InlineStack>
              </div>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Top Topics */}
        {topicStats.length > 0 && (
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Top Topics</Text>
              <InlineStack gap="200" wrap>
                {topicStats.map(t => (
                  <Button
                    key={t.topic}
                    size="slim"
                    variant={filters.topic === t.topic ? "primary" : "tertiary"}
                    onClick={() => handleFilter("topic", filters.topic === t.topic ? "" : t.topic)}
                  >
                    {t.topic} ({t.count})
                  </Button>
                ))}
              </InlineStack>
            </BlockStack>
          </Card>
        )}

        {/* Logs Table */}
        <Card>
          {logs.length === 0 ? (
            <EmptyState
              heading="No webhook logs"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>Webhook activity will appear here as it happens.</p>
            </EmptyState>
          ) : (
            <BlockStack gap="400">
              <DataTable
                columnContentTypes={['text', 'text', 'text', 'text', 'text', 'text', 'text', 'text']}
                headings={['Direction', 'Topic', 'Method', 'Status', 'Duration', 'Result', 'Time', 'Actions']}
                rows={rows}
              />
              <InlineStack align="center">
                <Pagination
                  hasPrevious={pagination.page > 1}
                  hasNext={pagination.page < pagination.totalPages}
                  onPrevious={() => handlePageChange(pagination.page - 1)}
                  onNext={() => handlePageChange(pagination.page + 1)}
                />
                <Text as="span" variant="bodySm" tone="subdued">
                  Page {pagination.page} of {pagination.totalPages} ({pagination.totalCount} total)
                </Text>
              </InlineStack>
            </BlockStack>
          )}
        </Card>

        {/* Detail Modal */}
        <Modal
          open={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          title={`Webhook: ${selectedLog?.topic}`}
          size="large"
        >
          <Modal.Section>
            {selectedLog && (
              <BlockStack gap="400">
                <Layout>
                  <Layout.Section variant="oneHalf">
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Details</Text>
                        <Divider />
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Topic</Text>
                          <Text as="span" variant="bodyMd">{selectedLog.topic}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Direction</Text>
                          <Badge tone={selectedLog.direction === "incoming" ? "info" : "attention"}>
                            {selectedLog.direction}
                          </Badge>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Method</Text>
                          <Text as="span" variant="bodyMd">{selectedLog.method}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Status Code</Text>
                          <Text as="span" variant="bodyMd">{selectedLog.statusCode || "—"}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Duration</Text>
                          <Text as="span" variant="bodyMd">{formatDuration(selectedLog.duration)}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Result</Text>
                          <Badge tone={selectedLog.success ? "success" : "critical"}>
                            {selectedLog.success ? "Success" : "Failed"}
                          </Badge>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                  <Layout.Section variant="oneHalf">
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Metadata</Text>
                        <Divider />
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Endpoint</Text>
                          <Text as="span" variant="bodySm" breakWord>{selectedLog.endpoint || "—"}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Time</Text>
                          <Text as="span" variant="bodyMd">{formatDate(selectedLog.createdAt)}</Text>
                        </InlineStack>
                        {selectedLog.errorMessage && (
                          <Banner tone="critical">
                            {selectedLog.errorMessage}
                          </Banner>
                        )}
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                </Layout>

                {selectedLog.requestBody && (
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Request Body</Text>
                      <Divider />
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: "12px" }}>
                          {(() => {
                            try {
                              return JSON.stringify(JSON.parse(selectedLog.requestBody), null, 2);
                            } catch {
                              return selectedLog.requestBody;
                            }
                          })()}
                        </pre>
                      </Box>
                    </BlockStack>
                  </Card>
                )}

                {selectedLog.responseBody && (
                  <Card>
                    <BlockStack gap="200">
                      <Text as="h3" variant="headingSm">Response Body</Text>
                      <Divider />
                      <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0, fontSize: "12px" }}>
                          {(() => {
                            try {
                              return JSON.stringify(JSON.parse(selectedLog.responseBody), null, 2);
                            } catch {
                              return selectedLog.responseBody;
                            }
                          })()}
                        </pre>
                      </Box>
                    </BlockStack>
                  </Card>
                )}
              </BlockStack>
            )}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
