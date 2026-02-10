import { json, type ActionFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

/**
 * Lead Capture API
 * Stores bulk quote requests from guest users
 * Called via app proxy: POST /apps/ssactiveorder/api/lead-capture
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle CORS preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405, headers: corsHeaders });
  }

  try {
    const body = await request.json();
    const { email, product, productTitle, items, totalQty, pageUrl, timestamp } = body;

    if (!email || !email.includes("@")) {
      return json({ error: "Valid email required" }, { status: 400, headers: corsHeaders });
    }

    // Store the lead in the database
    // Use a generic key-value approach via session or a dedicated table
    // For now, we'll store it as a JSON log entry

    // Try to store in database if LeadCapture model exists
    try {
      await (prisma as any).leadCapture.create({
        data: {
          email: email.trim().toLowerCase(),
          productId: product || "",
          productTitle: productTitle || "",
          orderDetails: JSON.stringify(items || []),
          totalQuantity: totalQty || 0,
          pageUrl: pageUrl || "",
          status: "new",
          source: "bulk-order-widget",
        },
      });
    } catch (dbError) {
      // If the model doesn't exist yet, just log it
      console.log("[LeadCapture] Database model not available, logging lead:");
      console.log("[LeadCapture] ===================================");
      console.log("[LeadCapture] Email:", email);
      console.log("[LeadCapture] Product:", productTitle || product);
      console.log("[LeadCapture] Total Qty:", totalQty);
      console.log("[LeadCapture] Items:", JSON.stringify(items));
      console.log("[LeadCapture] URL:", pageUrl);
      console.log("[LeadCapture] Time:", timestamp);
      console.log("[LeadCapture] ===================================");
    }

    // Log to console for immediate visibility
    console.log(`[LeadCapture] New lead: ${email} | ${productTitle} | ${totalQty} items`);

    return json(
      {
        success: true,
        message: "Quote request received. Our team will reach out within 60 minutes!"
      },
      { headers: corsHeaders }
    );
  } catch (error: unknown) {
    console.error("[LeadCapture] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return json(
      { error: errorMessage },
      { status: 500, headers: corsHeaders }
    );
  }
};

// GET requests return info
export const loader = async () => {
  return json(
    { status: "Lead Capture API active" },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
};
