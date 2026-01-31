import type { ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { topic, shop, session, admin, payload } = await authenticate.webhook(request);

  if (!admin) {
    // The authenticate.webhook automatically responds to Shopify even if no admin content
    // But usually it provides correct context.
    return new Response();
  }

  // Payload is the Order JSON
  const orderId = payload.id; // Shopify GraphID or ID? Webhook payloads usually have numeric ID, need to verify API version.
  // Shopify Admin API 2024+ returns GIDs often. Webhooks payload format depends on config.
  // Standard Payload is JSON object.
  const gid = `gid://shopify/Order/${orderId}`;

  // Check if order contains SS items
  // We check existing ProductMaps.
  // This is a simplification. Ideally check line items SKUs or Vendor.

  const lineItems = payload.line_items || [];
  let isSSOrder = false;

  // Quick check by vendor
  const hasSSVendor = lineItems.some((item: any) => item.vendor === "SSActiveWear" || item.vendor === "Gildan"); // Example check

  // Deep check by ProductMap
  if (!isSSOrder) {
      // Find one map
      // This is expensive per webhook, but for MVP:
      for (const item of lineItems) {
         if (item.product_id) {
             const map = await prisma.productMap.findFirst({
                 where: { shopifyProductId: `gid://shopify/Product/${item.product_id}` }
             });
             if (map) {
                 isSSOrder = true;
                 break;
             }
         }
      }
  }

  if (isSSOrder) {
    // Create OrderJob
    await prisma.orderJob.create({
      data: {
        shop,
        shopifyOrderId: gid,
        shopifyOrderNumber: payload.order_number?.toString() || payload.name || null,
        status: "PENDING_APPROVAL",
      },
    });

    // Update DailyStats for analytics
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const orderTotal = parseFloat(payload.total_price || "0");
    const itemCount = lineItems.reduce((sum: number, item: any) => sum + (item.quantity || 0), 0);

    await prisma.dailyStats.upsert({
      where: {
        shop_date: { shop, date: today },
      },
      update: {
        ordersCount: { increment: 1 },
        itemsSold: { increment: itemCount },
        revenue: { increment: orderTotal },
        ssOrdersCount: { increment: 1 },
      },
      create: {
        shop,
        date: today,
        ordersCount: 1,
        itemsSold: itemCount,
        revenue: orderTotal,
        ssOrdersCount: 1,
        importedCount: 0,
      },
    });

    console.log(`[Webhook] Order ${gid} (${payload.name}) queued + DailyStats updated`);
  }

  return new Response();
};
