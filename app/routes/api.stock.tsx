import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";

// Public API endpoint for real-time stock data
// Used by theme widget to show stock levels and availability matrix

interface StockItem {
  sku: string;
  color: string;
  size: string;
  qty: number;
  inStock: boolean;
}

interface StockResponse {
  success: boolean;
  styleId: string;
  styleName: string;
  brandName: string;
  totalStock: number;
  colors: string[];
  sizes: string[];
  items: StockItem[];
  matrix: Record<string, Record<string, { qty: number; inStock: boolean }>>;
  lowStockThreshold: number;
  updatedAt: string;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const styleId = url.searchParams.get("styleId");
  const shopifyProductId = url.searchParams.get("productId");
  const shop = url.searchParams.get("shop");

  // CORS headers for theme widget access
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=60", // Cache for 1 minute
  };

  if (!styleId && !shopifyProductId) {
    return json(
      { success: false, error: "styleId or productId required" },
      { headers: corsHeaders }
    );
  }

  try {
    let ssStyleId = styleId;

    // If productId provided, look up the style mapping
    if (shopifyProductId && shop) {
      const productMap = await prisma.productMap.findFirst({
        where: {
          shop,
          shopifyProductId,
        },
      });

      if (!productMap) {
        return json(
          { success: false, error: "Product not found" },
          { headers: corsHeaders }
        );
      }

      ssStyleId = productMap.ssStyleId;
    }

    if (!ssStyleId) {
      return json(
        { success: false, error: "Style ID not found" },
        { headers: corsHeaders }
      );
    }

    // Get style details from cache
    const styleCache = await prisma.sSStyleCache.findUnique({
      where: { styleId: parseInt(ssStyleId) },
    });

    // Get inventory from SSActiveWear - use getInventoryByStyle for style-based lookup
    const ssClient = new SSActiveWearClient();
    const inventory = await ssClient.getInventoryByStyle(parseInt(ssStyleId));

    if (!inventory || !Array.isArray(inventory)) {
      return json(
        { success: false, error: "Inventory not available" },
        { headers: corsHeaders }
      );
    }

    // Process inventory data
    const items: StockItem[] = [];
    const colorsSet = new Set<string>();
    const sizesSet = new Set<string>();
    const matrix: Record<string, Record<string, { qty: number; inStock: boolean }>> = {};

    // SSInventory has warehouses array, need to get product details for color/size names
    // For now, use SKU parsing or fetch products
    const products = await ssClient.getProducts(parseInt(ssStyleId));
    const skuToProduct = new Map(products.map((p: any) => [p.sku, p]));

    inventory.forEach((item) => {
      const product = skuToProduct.get(item.sku);
      const color = product?.colorName || 'Default';
      const size = product?.sizeName || 'One Size';
      // SSInventory has warehouses array, sum quantities
      const qty = item.warehouses?.reduce((sum, w) => sum + (w.qty || 0), 0) || 0;

      colorsSet.add(color);
      sizesSet.add(size);

      items.push({
        sku: item.sku,
        color,
        size,
        qty,
        inStock: qty > 0,
      });

      // Build availability matrix
      if (!matrix[color]) {
        matrix[color] = {};
      }
      matrix[color][size] = {
        qty,
        inStock: qty > 0,
      };
    });

    // Sort sizes in a logical order
    const sizeOrder = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'One Size'];
    const sizes = Array.from(sizesSet).sort((a, b) => {
      const aIdx = sizeOrder.indexOf(a);
      const bIdx = sizeOrder.indexOf(b);
      if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
      if (aIdx !== -1) return -1;
      if (bIdx !== -1) return 1;
      return a.localeCompare(b);
    });

    const colors = Array.from(colorsSet).sort();

    const totalStock = items.reduce((sum, item) => sum + item.qty, 0);

    const response: StockResponse = {
      success: true,
      styleId: ssStyleId,
      styleName: styleCache?.styleName || `Style ${ssStyleId}`,
      brandName: styleCache?.brandName || 'Unknown',
      totalStock,
      colors,
      sizes,
      items,
      matrix,
      lowStockThreshold: 5, // Default threshold
      updatedAt: new Date().toISOString(),
    };

    return json(response, { headers: corsHeaders });

  } catch (error) {
    console.error("Stock API error:", error);
    return json(
      { success: false, error: "Failed to fetch stock data" },
      { headers: corsHeaders }
    );
  }
};

// Handle OPTIONS for CORS preflight
export const action = async ({ request }: LoaderFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  return json({ error: "Method not allowed" }, { status: 405 });
};
