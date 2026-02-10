import { json, LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const productId = url.searchParams.get("product_id");

  if (!productId) {
    return json({ tiers: [] }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  try {
    // Attempt to find a rule where 'products' list (Relationship) contains our productId
    // Or GID format

    // We assume Model VolumePriceRule -> products: VolumePriceProduct[]
    // VolumePriceProduct has field `shopifyProductId`.

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
        sizePremiums: { orderBy: { sortOrder: "asc" } },
        products: {
          where: {
             OR: [
              { shopifyProductId: productId },
              { shopifyProductId: `gid://shopify/Product/${productId}` }
            ]
          },
          select: { basePrice: true } // We need base price to calculate final tiered pricing accurately
        }
      },
      take: 1
    });

    const rule = rules[0];

    if (!rule) {
      return json({ tiers: [], sizePremiums: [] }, { headers: { "Access-Control-Allow-Origin": "*" } });
    }

    // Get Base Price usually from VolumePriceProduct
    // If not set perfectly, fallback to 0 (frontend will use variant price)
    const basePrice = rule.products[0]?.basePrice || 0;

    const tiers = rule.tiers.map(t => ({
      min: t.minQty,
      max: t.maxQty,
      type: t.discountType, // 'percentage' or 'fixed'
      value: t.discountValue
    }));

    // Process size premiums (e.g. 2XL -> +$2.00)
    const sizePremiums = rule.sizePremiums.map(p => ({
        pattern: p.sizePattern, // e.g. "2XL", "3XL" or Regex
        value: p.premiumValue,
        type: p.premiumType // 'fixed' or 'percentage'
    }));

    return json({
      tiers,
      sizePremiums,
      basePrice, // This is the COST price usually, but maybe used for tiered calc
      ruleId: rule.id
    }, {
      headers: { "Access-Control-Allow-Origin": "*" }
    });

  } catch (error: unknown) {
    console.error("Volume Pricing API Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return json({ tiers: [], error: errorMessage }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
  }
};
