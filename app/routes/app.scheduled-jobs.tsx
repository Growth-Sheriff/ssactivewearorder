import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Button,
    Card,
    Divider,
    EmptyState,
    Icon,
    InlineStack,
    Layout,
    Modal,
    Page,
    Select,
    Text
} from "@shopify/polaris";
import {
    CalendarIcon,
    CheckCircleIcon,
    PlayIcon,
    RefreshIcon,
    XCircleIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

interface ScheduledJobItem {
  id: string;
  jobType: string;
  schedule: string;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  runCount: number;
  config: string | null;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const jobs = await prisma.scheduledJob.findMany({
    where: { shop },
    orderBy: { jobType: 'asc' },
  });

  // Define available job types
  const availableJobTypes = [
    { type: "catalog_sync", name: "Catalog Sync", description: "Sync brands, categories, and styles from SSActiveWear" },
    { type: "inventory_sync", name: "Inventory Sync", description: "Update stock levels for imported products" },
    { type: "price_update", name: "Price Update", description: "Apply price rules to products" },
    { type: "order_status", name: "Order Status Check", description: "Check SSActiveWear order statuses and tracking" },
    { type: "cleanup", name: "Data Cleanup", description: "Clean up old logs and temporary data" },
  ];

  // Check which job types are not created yet
  const existingTypes = new Set(jobs.map(j => j.jobType));
  const missingJobTypes = availableJobTypes.filter(jt => !existingTypes.has(jt.type));

  return json({
    jobs: jobs.map((j): ScheduledJobItem => ({
      ...j,
      lastRunAt: j.lastRunAt?.toISOString() || null,
      nextRunAt: j.nextRunAt?.toISOString() || null,
    })),
    availableJobTypes,
    missingJobTypes,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "create") {
    const jobType = formData.get("jobType") as string;
    const schedule = formData.get("schedule") as string;

    // Calculate next run time based on schedule
    const now = new Date();
    let nextRunAt = new Date(now);

    switch (schedule) {
      case "hourly":
        nextRunAt.setHours(nextRunAt.getHours() + 1, 0, 0, 0);
        break;
      case "daily":
        nextRunAt.setDate(nextRunAt.getDate() + 1);
        nextRunAt.setHours(3, 0, 0, 0); // 3 AM
        break;
      case "weekly":
        nextRunAt.setDate(nextRunAt.getDate() + (7 - nextRunAt.getDay()));
        nextRunAt.setHours(3, 0, 0, 0);
        break;
      default:
        nextRunAt.setHours(nextRunAt.getHours() + 1);
    }

    await prisma.scheduledJob.create({
      data: {
        shop,
        jobType,
        schedule,
        isEnabled: true,
        nextRunAt,
      },
    });

    return json({ success: true, message: "Job created successfully" });
  }

  if (action === "toggle") {
    const jobId = formData.get("jobId") as string;
    const job = await prisma.scheduledJob.findUnique({ where: { id: jobId } });

    if (job) {
      await prisma.scheduledJob.update({
        where: { id: jobId },
        data: { isEnabled: !job.isEnabled },
      });
    }

    return json({ success: true, message: job?.isEnabled ? "Job disabled" : "Job enabled" });
  }

  if (action === "updateSchedule") {
    const jobId = formData.get("jobId") as string;
    const schedule = formData.get("schedule") as string;

    const now = new Date();
    let nextRunAt = new Date(now);

    switch (schedule) {
      case "hourly":
        nextRunAt.setHours(nextRunAt.getHours() + 1, 0, 0, 0);
        break;
      case "daily":
        nextRunAt.setDate(nextRunAt.getDate() + 1);
        nextRunAt.setHours(3, 0, 0, 0);
        break;
      case "weekly":
        nextRunAt.setDate(nextRunAt.getDate() + (7 - nextRunAt.getDay()));
        nextRunAt.setHours(3, 0, 0, 0);
        break;
    }

    await prisma.scheduledJob.update({
      where: { id: jobId },
      data: { schedule, nextRunAt },
    });

    return json({ success: true, message: "Schedule updated" });
  }

  if (action === "runNow") {
    const jobId = formData.get("jobId") as string;

    // Update job to show it's running
    await prisma.scheduledJob.update({
      where: { id: jobId },
      data: {
        lastStatus: "running",
        lastRunAt: new Date(),
      },
    });

    // In production, this would trigger the actual job
    // For now, simulate completion after a short delay
    setTimeout(async () => {
      await prisma.scheduledJob.update({
        where: { id: jobId },
        data: {
          lastStatus: "success",
          runCount: { increment: 1 },
          nextRunAt: new Date(Date.now() + 3600000), // +1 hour
        },
      });
    }, 2000);

    return json({ success: true, message: "Job started!" });
  }

  if (action === "delete") {
    const jobId = formData.get("jobId") as string;
    await prisma.scheduledJob.delete({ where: { id: jobId } });
    return json({ success: true, message: "Job deleted" });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function ScheduledJobsPage() {
  const { jobs, availableJobTypes, missingJobTypes } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [selectedJobType, setSelectedJobType] = useState("");
  const [selectedSchedule, setSelectedSchedule] = useState("daily");

  const isLoading = navigation.state === "submitting";

  const handleCreate = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "create");
    formData.set("jobType", selectedJobType);
    formData.set("schedule", selectedSchedule);
    submit(formData, { method: "POST" });
    setCreateModalOpen(false);
  }, [selectedJobType, selectedSchedule, submit]);

  const handleToggle = useCallback((jobId: string) => {
    const formData = new FormData();
    formData.set("action", "toggle");
    formData.set("jobId", jobId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleRunNow = useCallback((jobId: string) => {
    const formData = new FormData();
    formData.set("action", "runNow");
    formData.set("jobId", jobId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleDelete = useCallback((jobId: string) => {
    if (!confirm("Delete this scheduled job?")) return;
    const formData = new FormData();
    formData.set("action", "delete");
    formData.set("jobId", jobId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleUpdateSchedule = useCallback((jobId: string, schedule: string) => {
    const formData = new FormData();
    formData.set("action", "updateSchedule");
    formData.set("jobId", jobId);
    formData.set("schedule", schedule);
    submit(formData, { method: "POST" });
  }, [submit]);

  const getJobTypeName = (type: string) => {
    return availableJobTypes.find(jt => jt.type === type)?.name || type;
  };

  const getStatusBadge = (status: string | null) => {
    switch (status) {
      case "success":
        return <Badge tone="success"><InlineStack gap="100"><Icon source={CheckCircleIcon} />Success</InlineStack></Badge>;
      case "running":
        return <Badge tone="info"><InlineStack gap="100"><Icon source={RefreshIcon} />Running</InlineStack></Badge>;
      case "failed":
        return <Badge tone="critical"><InlineStack gap="100"><Icon source={XCircleIcon} />Failed</InlineStack></Badge>;
      default:
        return <Badge tone="subdued">Never run</Badge>;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString();
  };

  const scheduleOptions = [
    { label: "Every hour", value: "hourly" },
    { label: "Daily (3 AM)", value: "daily" },
    { label: "Weekly (Sunday 3 AM)", value: "weekly" },
  ];

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Scheduled Jobs"
      subtitle="Configure automatic background tasks"
      primaryAction={missingJobTypes.length > 0 ? {
        content: "Add Job",
        icon: CalendarIcon,
        onAction: () => {
          setSelectedJobType(missingJobTypes[0]?.type || "");
          setCreateModalOpen(true);
        },
      } : undefined}
    >
      <TitleBar title="Scheduled Jobs" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Jobs List */}
        {jobs.length === 0 ? (
          <Card>
            <EmptyState
              heading="No scheduled jobs"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "Add Job",
                onAction: () => {
                  setSelectedJobType(missingJobTypes[0]?.type || "");
                  setCreateModalOpen(true);
                },
              }}
            >
              <p>Set up automatic tasks like catalog sync and inventory updates.</p>
            </EmptyState>
          </Card>
        ) : (
          <BlockStack gap="400">
            {jobs.map(job => (
              <Card key={job.id}>
                <BlockStack gap="400">
                  <InlineStack align="space-between" blockAlign="start">
                    <BlockStack gap="100">
                      <InlineStack gap="200">
                        <Text as="h2" variant="headingMd">{getJobTypeName(job.jobType)}</Text>
                        {job.isEnabled ? (
                          <Badge tone="success">Active</Badge>
                        ) : (
                          <Badge tone="subdued">Disabled</Badge>
                        )}
                      </InlineStack>
                      <Text as="p" variant="bodySm" tone="subdued">
                        {availableJobTypes.find(jt => jt.type === job.jobType)?.description}
                      </Text>
                    </BlockStack>
                    <InlineStack gap="200">
                      <Button
                        size="slim"
                        icon={PlayIcon}
                        onClick={() => handleRunNow(job.id)}
                        loading={isLoading}
                        disabled={job.lastStatus === "running"}
                      >
                        Run Now
                      </Button>
                      <Button
                        size="slim"
                        onClick={() => handleToggle(job.id)}
                      >
                        {job.isEnabled ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        size="slim"
                        tone="critical"
                        variant="plain"
                        onClick={() => handleDelete(job.id)}
                      >
                        Delete
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  <Divider />

                  <Layout>
                    <Layout.Section variant="oneThird">
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">Schedule</Text>
                        <Select
                          label=""
                          options={scheduleOptions}
                          value={job.schedule}
                          onChange={(v) => handleUpdateSchedule(job.id, v)}
                          disabled={!job.isEnabled}
                        />
                      </BlockStack>
                    </Layout.Section>
                    <Layout.Section variant="oneThird">
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">Last Run</Text>
                        <Text as="p" variant="bodyMd">{formatDate(job.lastRunAt)}</Text>
                        {getStatusBadge(job.lastStatus)}
                      </BlockStack>
                    </Layout.Section>
                    <Layout.Section variant="oneThird">
                      <BlockStack gap="100">
                        <Text as="span" variant="bodySm" tone="subdued">Next Run</Text>
                        <Text as="p" variant="bodyMd">{job.isEnabled ? formatDate(job.nextRunAt) : "Disabled"}</Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          Total runs: {job.runCount}
                        </Text>
                      </BlockStack>
                    </Layout.Section>
                  </Layout>

                  {job.lastError && (
                    <Banner tone="critical">
                      <Text as="p" variant="bodySm">{job.lastError}</Text>
                    </Banner>
                  )}
                </BlockStack>
              </Card>
            ))}
          </BlockStack>
        )}

        {/* Create Modal */}
        <Modal
          open={createModalOpen}
          onClose={() => setCreateModalOpen(false)}
          title="Add Scheduled Job"
          primaryAction={{
            content: "Create Job",
            onAction: handleCreate,
            loading: isLoading,
            disabled: !selectedJobType,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setCreateModalOpen(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Select
                label="Job Type"
                options={[
                  { label: "Select a job type...", value: "" },
                  ...missingJobTypes.map(jt => ({
                    label: jt.name,
                    value: jt.type,
                  })),
                ]}
                value={selectedJobType}
                onChange={setSelectedJobType}
              />
              {selectedJobType && (
                <Text as="p" variant="bodySm" tone="subdued">
                  {availableJobTypes.find(jt => jt.type === selectedJobType)?.description}
                </Text>
              )}
              <Select
                label="Schedule"
                options={scheduleOptions}
                value={selectedSchedule}
                onChange={setSelectedSchedule}
              />
            </BlockStack>
          </Modal.Section>
        </Modal>

        {/* Info */}
        <Card>
          <BlockStack gap="300">
            <Text as="h2" variant="headingMd">💡 How Scheduled Jobs Work</Text>
            <Divider />
            <Text as="p" variant="bodySm" tone="subdued">
              Scheduled jobs run automatically in the background based on the schedule you set.
              You can also run any job manually by clicking "Run Now".
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              • <strong>Catalog Sync:</strong> Updates brands, categories, and product styles from SSActiveWear
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              • <strong>Inventory Sync:</strong> Updates stock quantities for all imported products
            </Text>
            <Text as="p" variant="bodySm" tone="subdued">
              • <strong>Price Update:</strong> Applies price rules (markup) to products
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
