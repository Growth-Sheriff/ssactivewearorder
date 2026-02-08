import prisma from "../db.server";
import { SSActiveWearClient } from "./ssactivewear";

const ssClient = new SSActiveWearClient();

/**
 * Shipping Sync Service
 * Polls SSActiveWear for order status updates and syncs tracking info
 */
export class ShippingSyncService {

  /**
   * Sync all submitted orders to check for shipping updates
   */
  async syncShippingStatus(): Promise<{ updated: number; errors: number }> {
    let updated = 0;
    let errors = 0;

    // Get all orders that are submitted (not yet shipped)
    const submittedOrders = await prisma.orderJob.findMany({
      where: {
        status: "submitted",
        ssOrderNumber: { not: null }
      },
    });

    console.log(`[ShippingSync] Checking ${submittedOrders.length} submitted orders...`);

    for (const order of submittedOrders) {
      try {
        // Get order status from SSActiveWear
        const ssOrders = await ssClient.getOrders(true); // Get all orders
        const ssOrder = ssOrders.find((o: any) =>
          o.orderNumber === order.ssOrderNumber ||
          o.poNumber === order.shopifyOrderNumber
        );

        if (ssOrder && ssOrder.trackingNumber) {
          // Update order with tracking info
          await prisma.orderJob.update({
            where: { id: order.id },
            data: {
              status: "shipped",
              logs: JSON.stringify({
                trackingNumber: ssOrder.trackingNumber,
                carrier: ssOrder.carrier || "UPS",
                shippedAt: ssOrder.shipDate || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              }),
            },
          });
          updated++;
          console.log(`[ShippingSync] Order ${order.ssOrderNumber} marked as shipped`);
        }
      } catch (error) {
        errors++;
        console.error(`[ShippingSync] Error checking order ${order.id}:`, error);
      }
    }

    console.log(`[ShippingSync] Complete: ${updated} updated, ${errors} errors`);
    return { updated, errors };
  }

  /**
   * Get tracking info for a specific order
   */
  async getTrackingInfo(orderJobId: string): Promise<any> {
    const order = await prisma.orderJob.findUnique({
      where: { id: orderJobId },
    });

    if (!order?.logs) return null;

    try {
      return JSON.parse(order.logs);
    } catch {
      return null;
    }
  }
}
