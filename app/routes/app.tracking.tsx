import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, useActionData, useLoaderData, useNavigation, useSubmit } from "@remix-run/react";
import { TitleBar } from "@shopify/app-bridge-react";
import {
    Badge,
    Banner,
    BlockStack,
    Box,
    Button,
    Card,
    Divider,
    EmptyState,
    Icon,
    IndexTable,
    InlineStack,
    Layout,
    Link,
    Modal,
    Page,
    Text,
    useIndexResourceState
} from "@shopify/polaris";
import {
    CheckCircleIcon,
    ClockIcon,
    DeliveryIcon,
    ExternalIcon,
    PackageIcon,
    RefreshIcon
} from "@shopify/polaris-icons";
import { useCallback, useState } from "react";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

interface TrackingEvent {
  date: string;
  location: string;
  status: string;
  description: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  // Get all orders with tracking info
  const orders = await prisma.orderJob.findMany({
    where: {
      shop,
      status: { in: ['submitted', 'shipped'] },
    },
    orderBy: { updatedAt: 'desc' },
    take: 50,
  });

  // Get tracking records
  const orderIds = orders.map(o => o.id);
  const trackingRecords = await prisma.shipmentTracking.findMany({
    where: { orderJobId: { in: orderIds } },
  });

  // Merge data
  const ordersWithTracking = orders.map(order => {
    const tracking = trackingRecords.find(t => t.orderJobId === order.id);
    return {
      ...order,
      tracking: tracking || null,
    };
  });

  // Summary stats
  const stats = {
    pending: ordersWithTracking.filter(o => !o.tracking || o.tracking.status === 'pending').length,
    inTransit: ordersWithTracking.filter(o => o.tracking?.status === 'in_transit').length,
    delivered: ordersWithTracking.filter(o => o.tracking?.status === 'delivered').length,
    total: ordersWithTracking.length,
  };

  return json({ orders: ordersWithTracking, stats });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();
  const action = formData.get("action") as string;

  if (action === "refreshTracking") {
    const trackingId = formData.get("trackingId") as string;

    // In production, this would call carrier APIs to get real tracking updates
    // For now, simulate random updates
    const tracking = await prisma.shipmentTracking.findUnique({
      where: { id: trackingId },
    });

    if (tracking) {
      const statuses = ['pending', 'in_transit', 'in_transit', 'delivered'];
      const newStatus = statuses[Math.floor(Math.random() * statuses.length)];

      await prisma.shipmentTracking.update({
        where: { id: trackingId },
        data: {
          status: newStatus,
          lastUpdate: new Date(),
        },
      });
    }

    return json({ success: true, message: "Tracking updated" });
  }

  if (action === "refreshAll") {
    // Refresh all tracking records for this shop's orders
    const orders = await prisma.orderJob.findMany({
      where: { shop, status: { in: ['submitted', 'shipped'] } },
    });

    const orderIds = orders.map(o => o.id);

    await prisma.shipmentTracking.updateMany({
      where: { orderJobId: { in: orderIds } },
      data: { lastUpdate: new Date() },
    });

    return json({ success: true, message: "All tracking records refreshed" });
  }

  return json({ success: false, message: "Unknown action" });
};

export default function TrackingPage() {
  const { orders, stats } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const [selectedOrder, setSelectedOrder] = useState<typeof orders[0] | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);

  const isLoading = navigation.state === "submitting";

  const resourceName = {
    singular: 'shipment',
    plural: 'shipments',
  };

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(orders);

  const handleRefresh = useCallback((trackingId: string) => {
    const formData = new FormData();
    formData.set("action", "refreshTracking");
    formData.set("trackingId", trackingId);
    submit(formData, { method: "POST" });
  }, [submit]);

  const handleRefreshAll = useCallback(() => {
    const formData = new FormData();
    formData.set("action", "refreshAll");
    submit(formData, { method: "POST" });
  }, [submit]);

  const openDetails = useCallback((order: typeof orders[0]) => {
    setSelectedOrder(order);
    setDetailModalOpen(true);
  }, []);

  const getStatusBadge = (status: string | undefined) => {
    switch (status) {
      case 'delivered':
        return <Badge tone="success"><InlineStack gap="100"><Icon source={CheckCircleIcon} />Delivered</InlineStack></Badge>;
      case 'in_transit':
        return <Badge tone="info"><InlineStack gap="100"><Icon source={DeliveryIcon} />In Transit</InlineStack></Badge>;
      case 'pending':
      default:
        return <Badge tone="attention"><InlineStack gap="100"><Icon source={ClockIcon} />Pending</InlineStack></Badge>;
    }
  };

  const getCarrierUrl = (carrier: string | null, trackingNumber: string | null) => {
    if (!trackingNumber) return null;

    if (carrier?.toUpperCase().includes('FEDEX') || carrier === 'FXG' || carrier === 'FXE') {
      return `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
    } else if (carrier?.toUpperCase().includes('UPS') || carrier === 'UPG') {
      return `https://www.ups.com/track?tracknum=${trackingNumber}`;
    } else if (carrier?.toUpperCase().includes('USPS') || carrier === 'USP') {
      return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
    }
    return null;
  };

  // Mock tracking events for detail modal
  const getMockEvents = (status: string): TrackingEvent[] => {
    const baseEvents: TrackingEvent[] = [
      {
        date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toLocaleString(),
        location: "Henderson, NV",
        status: "Picked Up",
        description: "Package picked up by carrier",
      },
    ];

    if (status === 'in_transit' || status === 'delivered') {
      baseEvents.push({
        date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toLocaleString(),
        location: "Phoenix, AZ",
        status: "In Transit",
        description: "Package in transit to destination",
      });
    }

    if (status === 'delivered') {
      baseEvents.push(
        {
          date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toLocaleString(),
          location: "Los Angeles, CA",
          status: "Out for Delivery",
          description: "Package out for delivery",
        },
        {
          date: new Date().toLocaleString(),
          location: "Los Angeles, CA",
          status: "Delivered",
          description: "Package delivered to front door",
        }
      );
    }

    return baseEvents.reverse();
  };

  const rowMarkup = orders.map((order, index) => {
    const trackingUrl = getCarrierUrl(order.tracking?.carrier || null, order.tracking?.trackingNumber || null);

    return (
      <IndexTable.Row
        id={order.id}
        key={order.id}
        selected={selectedResources.includes(order.id)}
        position={index}
      >
        <IndexTable.Cell>
          <Text as="span" variant="bodyMd" fontWeight="semibold">
            #{order.shopifyOrderNumber || order.shopifyOrderId}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          {order.ssOrderNumber ? (
            <Text as="span" variant="bodySm">{order.ssOrderNumber}</Text>
          ) : (
            <Text as="span" variant="bodySm" tone="subdued">—</Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {order.tracking?.carrier || <Text as="span" tone="subdued">—</Text>}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {order.tracking?.trackingNumber ? (
            trackingUrl ? (
              <Link url={trackingUrl} target="_blank">
                {order.tracking.trackingNumber}
              </Link>
            ) : (
              <Text as="span">{order.tracking.trackingNumber}</Text>
            )
          ) : (
            <Text as="span" tone="subdued">Awaiting shipment</Text>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {getStatusBadge(order.tracking?.status)}
        </IndexTable.Cell>
        <IndexTable.Cell>
          <Text as="span" variant="bodySm" tone="subdued">
            {order.tracking?.lastUpdate
              ? new Date(order.tracking.lastUpdate).toLocaleDateString()
              : "—"}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>
          <InlineStack gap="100">
            <Button size="slim" variant="plain" onClick={() => openDetails(order)}>
              Details
            </Button>
            {order.tracking && (
              <Button size="slim" variant="plain" onClick={() => handleRefresh(order.tracking!.id)}>
                Refresh
              </Button>
            )}
          </InlineStack>
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  return (
    <Page
      backAction={{ url: "/app" }}
      title="Shipment Tracking"
      subtitle="Track your SSActiveWear shipments and delivery status"
      secondaryActions={[
        {
          content: "Refresh All",
          icon: RefreshIcon,
          onAction: handleRefreshAll,
          loading: isLoading,
        },
      ]}
    >
      <TitleBar title="Tracking" />
      <BlockStack gap="600">
        {actionData?.message && (
          <Banner tone={actionData.success ? "success" : "critical"} onDismiss={() => {}}>
            {actionData.message}
          </Banner>
        )}

        {/* Stats Cards */}
        <Layout>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm" tone="subdued">Total</Text>
                  <Icon source={PackageIcon} />
                </InlineStack>
                <Text as="p" variant="heading2xl">{stats.total}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm" tone="subdued">Pending</Text>
                  <Icon source={ClockIcon} tone="caution" />
                </InlineStack>
                <Text as="p" variant="heading2xl" tone="caution">{stats.pending}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm" tone="subdued">In Transit</Text>
                  <Icon source={DeliveryIcon} tone="info" />
                </InlineStack>
                <Text as="p" variant="heading2xl" tone="info">{stats.inTransit}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneQuarter">
            <Card>
              <BlockStack gap="200">
                <InlineStack align="space-between">
                  <Text as="h3" variant="headingSm" tone="subdued">Delivered</Text>
                  <Icon source={CheckCircleIcon} tone="success" />
                </InlineStack>
                <Text as="p" variant="heading2xl" tone="success">{stats.delivered}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Tracking Table */}
        {orders.length === 0 ? (
          <Card>
            <EmptyState
              heading="No shipments to track"
              image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              action={{
                content: "View Orders",
                url: "/app/orders",
              }}
            >
              <p>Submitted orders will appear here with tracking information once shipped.</p>
            </EmptyState>
          </Card>
        ) : (
          <Card>
            <IndexTable
              resourceName={resourceName}
              itemCount={orders.length}
              selectedItemsCount={allResourcesSelected ? 'All' : selectedResources.length}
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: 'Order' },
                { title: 'SS Order #' },
                { title: 'Carrier' },
                { title: 'Tracking Number' },
                { title: 'Status' },
                { title: 'Last Update' },
                { title: 'Actions' },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        )}

        {/* Tracking Detail Modal */}
        <Modal
          open={detailModalOpen}
          onClose={() => setDetailModalOpen(false)}
          title={`Order #${selectedOrder?.shopifyOrderNumber || selectedOrder?.shopifyOrderId}`}
          size="large"
        >
          <Modal.Section>
            {selectedOrder && (
              <BlockStack gap="500">
                {/* Order Info */}
                <Layout>
                  <Layout.Section variant="oneHalf">
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Order Details</Text>
                        <Divider />
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Shopify Order</Text>
                          <Text as="span" variant="bodyMd">#{selectedOrder.shopifyOrderNumber}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">SS Order</Text>
                          <Text as="span" variant="bodyMd">{selectedOrder.ssOrderNumber || '—'}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Status</Text>
                          {getStatusBadge(selectedOrder.tracking?.status)}
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                  <Layout.Section variant="oneHalf">
                    <Card>
                      <BlockStack gap="200">
                        <Text as="h3" variant="headingSm">Shipping Details</Text>
                        <Divider />
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Carrier</Text>
                          <Text as="span" variant="bodyMd">{selectedOrder.tracking?.carrier || '—'}</Text>
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Tracking #</Text>
                          {selectedOrder.tracking?.trackingNumber ? (
                            <Link url={getCarrierUrl(selectedOrder.tracking.carrier, selectedOrder.tracking.trackingNumber) || '#'} target="_blank">
                              {selectedOrder.tracking.trackingNumber} <Icon source={ExternalIcon} />
                            </Link>
                          ) : (
                            <Text as="span">—</Text>
                          )}
                        </InlineStack>
                        <InlineStack align="space-between">
                          <Text as="span" variant="bodySm">Est. Delivery</Text>
                          <Text as="span" variant="bodyMd">
                            {selectedOrder.tracking?.estimatedDelivery
                              ? new Date(selectedOrder.tracking.estimatedDelivery).toLocaleDateString()
                              : '—'}
                          </Text>
                        </InlineStack>
                      </BlockStack>
                    </Card>
                  </Layout.Section>
                </Layout>

                {/* Tracking Timeline */}
                <Card>
                  <BlockStack gap="400">
                    <Text as="h3" variant="headingSm">Tracking History</Text>
                    <Divider />
                    {selectedOrder.tracking ? (
                      <BlockStack gap="300">
                        {getMockEvents(selectedOrder.tracking.status).map((event, idx) => (
                          <Box key={idx} paddingInlineStart="200">
                            <InlineStack gap="400">
                              <Box
                                background={idx === 0 ? "bg-fill-success" : "bg-fill-secondary"}
                                padding="100"
                                borderRadius="full"
                                minWidth="12px"
                              />
                              <BlockStack gap="050">
                                <InlineStack gap="200">
                                  <Text as="span" variant="bodyMd" fontWeight="semibold">{event.status}</Text>
                                  <Text as="span" variant="bodySm" tone="subdued">{event.location}</Text>
                                </InlineStack>
                                <Text as="span" variant="bodySm" tone="subdued">{event.description}</Text>
                                <Text as="span" variant="bodySm" tone="subdued">{event.date}</Text>
                              </BlockStack>
                            </InlineStack>
                          </Box>
                        ))}
                      </BlockStack>
                    ) : (
                      <Text as="p" tone="subdued">No tracking events yet. Tracking information will appear once the order ships.</Text>
                    )}
                  </BlockStack>
                </Card>
              </BlockStack>
            )}
          </Modal.Section>
        </Modal>
      </BlockStack>
    </Page>
  );
}
