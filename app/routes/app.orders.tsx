import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import { Badge, Button, Card, IndexTable, Layout, Page } from "@shopify/polaris";
import prisma from "../db.server";
import { OrderSyncService } from "../services/orderSync.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  const jobs = await prisma.orderJob.findMany({
    orderBy: { id: "desc" },
    take: 50,
  });
  return json({ jobs });
}

export async function action({ request }: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const jobId = formData.get("jobId");

  if (!jobId) return json({ error: "Job ID required" }, { status: 400 });

  const service = new OrderSyncService();
  try {
    await service.processOrder(admin, String(jobId));
    return json({ success: true });
  } catch (error) {
    console.error(error);
    return json({ error: "Sync failed" }, { status: 500 });
  }
}

export default function OrdersPage() {
  const { jobs } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();

  const handleApprove = (jobId: string) => {
    fetcher.submit({ jobId }, { method: "post" });
  };

  const resourceName = {
    singular: 'order',
    plural: 'orders',
  };

  const rowMarkup = jobs.map(
    ({ id, shopifyOrderId, status, ssOrderNumber, logs }: { id: string; shopifyOrderId: string; status: string; ssOrderNumber?: string | null; logs?: string | null }, index: number) => (
      <IndexTable.Row id={id} key={id} position={index}>
        <IndexTable.Cell>{shopifyOrderId.split("/").pop()}</IndexTable.Cell>
        <IndexTable.Cell>
            <Badge tone={status === "SUBMITTED" ? "success" : status === "PENDING_APPROVAL" ? "attention" : "critical"}>
                {status}
            </Badge>
        </IndexTable.Cell>
        <IndexTable.Cell>{ssOrderNumber || "-"}</IndexTable.Cell>
        <IndexTable.Cell>{logs || "-"}</IndexTable.Cell>
        <IndexTable.Cell>
            {status === "PENDING_APPROVAL" && (
                <Button onClick={() => handleApprove(id)} loading={fetcher.state === "submitting"}>Approve & Send</Button>
            )}
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <Page title="Order Synchronization">
      <Layout>
        <Layout.Section>
          <Card>
            <IndexTable
              resourceName={resourceName}
              itemCount={jobs.length}
              headings={[
                { title: 'Shopify Order ID' },
                { title: 'Status' },
                { title: 'SS Order #' },
                { title: 'Logs' },
                { title: 'Action' },
              ]}
            >
              {rowMarkup}
            </IndexTable>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
