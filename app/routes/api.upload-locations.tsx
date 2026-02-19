import { json, type LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

/**
 * Upload Locations API
 * Serves upload locations for a product from the database.
 * If no locations are defined, returns default ["Front", "Back"].
 *
 * Called via app proxy: GET /apps/ssactiveorder/api/upload-locations?shop=xxx&productId=gid://shopify/Product/xxx
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300", // Cache for 5 minutes
  };

  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");
  const productId = url.searchParams.get("productId");

  // Default locations if nothing is configured
  const defaultLocations = [
    { name: "full_front", label: "Front", icon: "full_front", price: 0, sortOrder: 0 },
    { name: "full_back", label: "Back", icon: "full_back", price: 0, sortOrder: 1 },
  ];

  if (!shop || !productId) {
    return json({ locations: defaultLocations, source: "default" }, { headers: corsHeaders });
  }

  try {
    const locations = await prisma.productUploadLocation.findMany({
      where: { shop, shopifyProductId: productId },
      orderBy: { sortOrder: "asc" },
      select: {
        name: true,
        label: true,
        iconType: true,
        price: true,
        sortOrder: true,
      },
    });

    if (locations.length === 0) {
      return json({ locations: defaultLocations, source: "default" }, { headers: corsHeaders });
    }

    return json({
      locations: locations.map(l => ({
        name: l.name,
        label: l.label,
        icon: l.iconType,
        price: l.price || 0,
        sortOrder: l.sortOrder,
      })),
      source: "database",
    }, { headers: corsHeaders });
  } catch (error) {
    console.error("[UploadLocations API] Error:", error);
    return json({ locations: defaultLocations, source: "default-error" }, { headers: corsHeaders });
  }
};
