import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Button,
    Card,
    EmptyState,
    IndexTable,
    InlineStack,
    Layout,
    Modal,
    Page,
    Text,
} from "@shopify/polaris";
import { useCallback, useEffect, useState } from "react";
import prisma from "../db.server";
import { OrderSyncService } from "../services/orderSync.server";
import { authenticate } from "../shopify.server";

interface OrderJob {
  id: string;
  shopifyOrderId: string;
  status: string;
  ssOrderNumber: string | null;
  logs: string | null;
}

interface LoaderData {
  orders: OrderJob[];
  statusCounts: {
    pending: number;
    submitted: number;
    shipped: number;
    error: number;
  };
}

interface ActionData {
  success?: boolean;
  error?: string;
  message?: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const orders = await prisma.orderJob.findMany({
    where: { shop }, // Filter by shop for multi-tenant security
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const statusCounts = {
    pending: orders.filter((o: OrderJob) => o.status === "pending").length,
    submitted: orders.filter((o: OrderJob) => o.status === "submitted").length,
    shipped: orders.filter((o: OrderJob) => o.status === "shipped").length,
    error: orders.filter((o: OrderJob) => o.status === "error").length,
  };

  return json<LoaderData>({ orders, statusCounts });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const orderId = formData.get("orderId") as string;
  const actionType = formData.get("action") as string;

  if (!orderId) {
    return json<ActionData>({ error: "Order ID required" });
  }

  if (actionType === "approve") {
    const syncService = new OrderSyncService();
    try {
      await syncService.processOrder(admin as any, orderId); // Fixed parameter order
      return json<ActionData>({ success: true, message: `Order ${orderId} submitted to SSActiveWear` });
    } catch (error) {
      console.error("Order sync failed:", error);
      return json<ActionData>({ error: "Failed to submit order" });
    }
  }

  if (actionType === "reject") {
    await prisma.orderJob.update({
      where: { id: orderId },
      data: { status: "rejected" },
    });
    return json<ActionData>({ success: true, message: "Order rejected" });
  }

  return json<ActionData>({ error: "Unknown action" });
}

export default function OrdersPage() {
  const loaderData = useLoaderData<LoaderData>();
  const actionData = useActionData<ActionData>();
  const submit = useSubmit();
  const nav = useNavigation();
  const shopify = useAppBridge();

  const orders = loaderData?.orders || [];
  const statusCounts = loaderData?.statusCounts || { pending: 0, submitted: 0, shipped: 0, error: 0 };

  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [modalActive, setModalActive] = useState(false);

  const isProcessing = nav.state === "submitting";

  useEffect(() => {
    if (actionData?.success) {
      shopify.toast.show(actionData.message || "Action completed");
      setModalActive(false);
    } else if (actionData?.error) {
      shopify.toast.show(actionData.error, { isError: true });
    }
  }, [actionData, shopify]);

  const handleApprove = useCallback((orderId: string) => {
    setSelectedOrderId(orderId);
    setModalActive(true);
  }, []);

  const confirmApprove = useCallback(() => {
    if (selectedOrderId) {
      submit({ orderId: selectedOrderId, action: "approve" }, { method: "post" });
    }
  }, [selectedOrderId, submit]);

  const handleReject = useCallback((orderId: string) => {
    submit({ orderId, action: "reject" }, { method: "post" });
  }, [submit]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge tone="attention">Pending</Badge>;
      case "submitted":
        return <Badge tone="success">Submitted</Badge>;
      case "shipped":
        return <Badge tone="info">Shipped</Badge>;
      case "error":
        return <Badge tone="critical">Error</Badge>;
      case "rejected":
        return <Badge>Rejected</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const resourceName = {
    singular: "order",
    plural: "orders",
  };

  const rowMarkup = orders.map((order: OrderJob, index: number) => {
    const shopifyOrderNumber = order.shopifyOrderId.replace("gid://shopify/Order/", "#");

    return (
      <IndexTable.Row id={order.id} key={order.id} position={index}>
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {shopifyOrderNumber}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{getStatusBadge(order.status)}</IndexTable.Cell>
        <IndexTable.Cell>
          {order.ssOrderNumber ? (
            <Text variant="bodyMd" as="span">
              {order.ssOrderNumber}
            </Text>
          ) : (
            <Text variant="bodyMd" tone="subdued" as="span">
              —
            </Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {order.status === "pending" && (
            <InlineStack gap="200">
              <Button
                size="slim"
                variant="primary"
                onClick={() => handleApprove(order.id)}
                loading={isProcessing && selectedOrderId === order.id}
              >
                Approve
              </Button>
              <Button
                size="slim"
                variant="plain"
                tone="critical"
                onClick={() => handleReject(order.id)}
              >
                Reject
              </Button>
            </InlineStack>
          )}
          {order.status === "submitted" && (
            <Button size="slim" disabled>
              Awaiting Shipment
            </Button>
          )}
          {order.status === "error" && (
            <InlineStack gap="200">
              <Button size="slim" variant="primary" onClick={() => handleApprove(order.id)}>
                Retry
              </Button>
            </InlineStack>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page title="Order Queue">
      <TitleBar title="Order Queue" />
      <BlockStack gap="600">
        {/* Status Summary - Using InlineGrid instead of oneQuarter */}
        <Layout>
          <Layout.Section>
            <InlineStack gap="400" align="start">
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">
                    Pending
                  </Text>
                  <Text as="p" variant="heading2xl">
                    {statusCounts.pending}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">
                    Submitted
                  </Text>
                  <Text as="p" variant="heading2xl">
                    {statusCounts.submitted}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">
                    Shipped
                  </Text>
                  <Text as="p" variant="heading2xl">
                    {statusCounts.shipped}
                  </Text>
                </BlockStack>
              </Card>
              <Card>
                <BlockStack gap="200">
                  <Text as="h3" variant="headingSm" tone="subdued">
                    Errors
                  </Text>
                  <Text as="p" variant="heading2xl" tone="critical">
                    {statusCounts.error}
                  </Text>
                </BlockStack>
              </Card>
            </InlineStack>
          </Layout.Section>
        </Layout>

        {/* Orders Table */}
        <Card>
          {orders.length === 0 ? (
            <EmptyState
              heading="No orders yet"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
            >
              <p>
                Orders containing SSActiveWear products will appear here for approval before being sent to the supplier.
              </p>
            </EmptyState>
          ) : (
            <IndexTable
              resourceName={resourceName}
              itemCount={orders.length}
              headings={[
                { title: "Shopify Order" },
                { title: "Status" },
                { title: "SS Order #" },
                { title: "Actions" },
              ]}
              selectable={false}
            >
              {rowMarkup}
            </IndexTable>
          )}
        </Card>

        {/* Confirmation Modal */}
        <Modal
          open={modalActive}
          onClose={() => setModalActive(false)}
          title="Confirm Order Submission"
          primaryAction={{
            content: "Submit to SSActiveWear",
            onAction: confirmApprove,
            loading: isProcessing,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: () => setModalActive(false),
            },
          ]}
        >
          <Modal.Section>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                Are you sure you want to submit this order to SSActiveWear? This action cannot be undone.
              </Text>
              <Banner tone="warning">
                <p>
                  Make sure the order details are correct. The order will be placed with SSActiveWear and you will be charged.
                </p>
              </Banner>
            </BlockStack>
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
