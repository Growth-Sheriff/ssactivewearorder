import prisma from "../db.server";
import { SSActiveWearClient } from "./ssactivewear";

const ssClient = new SSActiveWearClient();

export class OrderSyncService {
  async processOrder(admin: any, orderJobId: string) {
    // 1. Get Job
    const job = await prisma.orderJob.findUnique({ where: { id: orderJobId } });
    if (!job) throw new Error("Job not found");

    // 2. Fetch Order from Shopify
    // We need shipping address, line items, variants.
    const query = `
      query getOrder($id: ID!) {
        order(id: $id) {
          name
          email
          shippingAddress {
            address1
            address2
            city
            zip
            province
            provinceCode
            country
            firstName
            lastName
          }
          lineItems(first: 50) {
            edges {
              node {
                sku
                quantity
                variant {
                  id
                  sku
                }
              }
            }
          }
        }
      }
    `;
    const response = await admin.graphql(query, { variables: { id: job.shopifyOrderId } });
    const { data } = await response.json();
    const order = data.order;

    if (!order) throw new Error("Order not found in Shopify");

    // 3. Map to SSActiveWear Format
    const lines = [];
    for (const edge of order.lineItems.edges) {
        const item = edge.node;
        // Check if map exists or assume SKU match
        // Ideally we check our VariantMap
        // For now, use SKU as identifier
        if (item.sku) {
            lines.push({
                identifier: item.sku,
                qty: item.quantity
            });
        }
    }

    if (lines.length === 0) throw new Error("No mappable items found");

    const ssOrderPayload = {
        shippingAddress: {
            customer: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
            attn: `${order.shippingAddress.firstName} ${order.shippingAddress.lastName}`,
            address: order.shippingAddress.address1,
            city: order.shippingAddress.city,
            state: order.shippingAddress.provinceCode || "IL", // Fallback needed? SS requires state
            zip: order.shippingAddress.zip,
            residential: true // Assume residential usually for D2C
        },
        lines: lines,
        poNumber: order.name,
        shippingMethod: "1", // Default to Ground (1). TODO: Map via Settings.
        testOrder: true // SAFETY FLAG
    };

    // 4. Send to SS
    const ssResponse = await ssClient.placeOrder(ssOrderPayload);

    // 5. Update Job
    await prisma.orderJob.update({
        where: { id: orderJobId },
        data: {
            status: "SUBMITTED",
            ssOrderNumber: ssResponse[0].orderNumber,
            logs: "Successfully submitted"
        }
    });

    return ssResponse;
  }
}
