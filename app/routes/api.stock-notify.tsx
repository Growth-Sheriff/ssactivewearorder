import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

// Public API endpoint for stock notifications (back in stock alerts)
// Allows customers to register for notifications when products come back in stock

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const email = url.searchParams.get("email");

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (!shop || !email) {
    return json(
      { success: false, error: "shop and email required" },
      { headers: corsHeaders }
    );
  }

  // Get customer's notifications
  const notifications = await prisma.stockNotification.findMany({
    where: { shop, email, isNotified: false },
    orderBy: { createdAt: 'desc' },
  });

  return json({
    success: true,
    notifications: notifications.map(n => ({
      id: n.id,
      sku: n.sku,
      styleName: n.styleName,
      colorName: n.colorName,
      sizeName: n.sizeName,
      createdAt: n.createdAt.toISOString(),
    })),
  }, { headers: corsHeaders });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle OPTIONS for CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const formData = await request.formData();
  const action = formData.get("action") as string;
  const shop = formData.get("shop") as string;
  const email = formData.get("email") as string;

  if (!shop || !email) {
    return json(
      { success: false, error: "shop and email required" },
      { headers: corsHeaders }
    );
  }

  // FIX #5: Validate shop origin - request must come from the claimed shop
  const referer = request.headers.get("referer") || request.headers.get("origin") || "";
  const shopDomain = shop.replace(".myshopify.com", "");
  if (referer && !referer.includes(shopDomain) && !referer.includes("localhost")) {
    return json(
      { success: false, error: "Invalid request origin" },
      { status: 403, headers: corsHeaders }
    );
  }

  if (action === "subscribe") {
    const sku = formData.get("sku") as string;
    const productId = formData.get("productId") as string;
    const variantId = formData.get("variantId") as string;
    const styleName = formData.get("styleName") as string;
    const colorName = formData.get("colorName") as string;
    const sizeName = formData.get("sizeName") as string;

    if (!sku) {
      return json(
        { success: false, error: "sku required" },
        { headers: corsHeaders }
      );
    }

    // Check if already subscribed
    const existing = await prisma.stockNotification.findFirst({
      where: { shop, email, sku, isNotified: false },
    });

    if (existing) {
      return json(
        { success: true, message: "Already subscribed", id: existing.id },
        { headers: corsHeaders }
      );
    }

    // Get style ID from product map if productId provided
    let styleId: number | undefined;
    if (productId) {
      const productMap = await prisma.productMap.findFirst({
        where: { shop, shopifyProductId: productId },
      });
      if (productMap) {
        styleId = parseInt(productMap.ssStyleId);
      }
    }

    // Create notification subscription
    const notification = await prisma.stockNotification.create({
      data: {
        shop,
        email,
        sku,
        productId: productId || null,
        variantId: variantId || null,
        styleId: styleId || null,
        styleName: styleName || null,
        colorName: colorName || null,
        sizeName: sizeName || null,
      },
    });

    return json({
      success: true,
      message: "Subscribed for stock notification",
      id: notification.id,
    }, { headers: corsHeaders });
  }

  if (action === "unsubscribe") {
    const notificationId = formData.get("notificationId") as string;
    const sku = formData.get("sku") as string;

    if (notificationId) {
      await prisma.stockNotification.delete({
        where: { id: notificationId },
      });
    } else if (sku) {
      await prisma.stockNotification.deleteMany({
        where: { shop, email, sku },
      });
    }

    return json({
      success: true,
      message: "Unsubscribed from notification",
    }, { headers: corsHeaders });
  }

  return json(
    { success: false, error: "Unknown action" },
    { headers: corsHeaders }
  );
};
