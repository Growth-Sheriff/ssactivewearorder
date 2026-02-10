import { json, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  let productId = url.searchParams.get("product_id");

  if (!productId) {
    return json({ tiers: [] }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // Ensure GID format if needed, OR try both formats
  // Usually stored as gid://shopify/Product/12345 or just 12345
  // We'll try to find a rule that contains this product.

  try {
    // Attempt 1: Search by partial ID or Exact ID
    // Since we don't know the exact schema of relation (is it ManyToMany with ProductMap or embedded?),
    // we use the relation defined in Rule -> products

    // We try to find a rule where 'products' list contains our productId
    const rules = await prisma.volumePriceRule.findMany({
      where: {
        isActive: true,
        products: {
          some: {
            OR: [
              { shopifyProductId: productId },
              { shopifyProductId: `gid://shopify/Product/${productId}` }
            ]
          }
        }
      },
      include: {
        tiers: { orderBy: { sortOrder: "asc" } },
        products: {
          where: {
             OR: [
              { shopifyProductId: productId },
              { shopifyProductId: `gid://shopify/Product/${productId}` }
            ]
          },
          select: { basePrice: true }
        }
      },
      take: 1
    });

    const rule = rules[0];

    if (!rule) {
      return json({ tiers: [] }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // Get Base Price if available (to calculate exact prices)
    const basePrice = rule.products[0]?.basePrice || 0;

    const tiers = rule.tiers.map(t => ({
      min: t.minQty,
      max: t.maxQty,
      type: t.discountType, // 'percentage' or 'fixed'
      value: t.discountValue
    }));

    return json({
      tiers,
      basePrice,
      ruleId: rule.id
    }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });

  } catch (error) {
    console.error("Volume Pricing API Error:", error);
    return json({ tiers: [], error: error.message }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
};
