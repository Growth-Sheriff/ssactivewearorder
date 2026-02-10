import { json, type LoaderFunctionArgs } from "@remix-run/node";
import { unauthenticated } from "../shopify.server";

/**
 * Shipping Estimate API
 * Fetches real delivery profiles from Shopify Admin API
 * Called via app proxy: /apps/ssactiveorder/api/shipping-estimate?shop=xxx
 */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "public, max-age=300", // Cache 5 minutes
  };

  if (!shop) {
    return json(
      { error: "Missing shop parameter", shipping: null },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const { admin } = await unauthenticated.admin(shop);

    // Query Shopify's delivery profiles for real shipping data
    const response = await admin.graphql(`
      query {
        deliveryProfiles(first: 5) {
          edges {
            node {
              id
              name
              default
              profileLocationGroups {
                locationGroup {
                  id
                }
                locationGroupZones(first: 20) {
                  edges {
                    node {
                      zone {
                        id
                        name
                        countries {
                          code {
                            countryCode
                          }
                          provinces {
                            code
                          }
                        }
                      }
                      methodDefinitions(first: 10) {
                        edges {
                          node {
                            id
                            name
                            active
                            rateProvider {
                              ... on DeliveryRateDefinition {
                                id
                                price {
                                  amount
                                  currencyCode
                                }
                              }
                              ... on DeliveryParticipant {
                                id
                                carrierService {
                                  id
                                  name
                                }
                              }
                            }
                            methodConditions {
                              field
                              operator
                              conditionCriteria {
                                ... on MoneyV2 {
                                  amount
                                  currencyCode
                                }
                                ... on Weight {
                                  value
                                  unit
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const data = await response.json();
    const profiles = data?.data?.deliveryProfiles?.edges || [];

    // Process into a clean format for the frontend
    const shippingInfo = {
      freeShippingThreshold: null as number | null,
      shippingRates: [] as Array<{
        name: string;
        price: number;
        currency: string;
        zone: string;
        conditions: Array<{ field: string; operator: string; value: string }>;
      }>,
      zones: [] as Array<{
        name: string;
        countries: string[];
        methods: Array<{ name: string; price: number; isFree: boolean }>;
      }>,
    };

    for (const profile of profiles) {
      const node = profile.node;
      const locationGroups = node.profileLocationGroups || [];

      for (const lg of locationGroups) {
        const zones = lg.locationGroupZones?.edges || [];

        for (const zoneEdge of zones) {
          const zoneName = zoneEdge.node.zone?.name || "Default";
          const countries = (zoneEdge.node.zone?.countries || []).map(
            (c: any) => c.code?.countryCode
          );
          const methods = zoneEdge.node.methodDefinitions?.edges || [];

          const zoneMethods: Array<{
            name: string;
            price: number;
            isFree: boolean;
          }> = [];

          for (const method of methods) {
            const m = method.node;
            if (!m.active) continue;

            const methodName = m.name;
            let price = 0;
            let isFreeMethod = false;

            // Get price from rate definition
            if (m.rateProvider?.price) {
              price = parseFloat(m.rateProvider.price.amount);
            }

            // Check if this is a free shipping method
            if (price === 0) {
              isFreeMethod = true;
            }

            // Check conditions for free shipping threshold
            if (m.methodConditions && m.methodConditions.length > 0) {
              for (const cond of m.methodConditions) {
                if (
                  cond.field === "TOTAL_PRICE" &&
                  cond.conditionCriteria?.amount
                ) {
                  const threshold = parseFloat(
                    cond.conditionCriteria.amount
                  );
                  if (isFreeMethod && threshold > 0) {
                    shippingInfo.freeShippingThreshold = threshold;
                  }
                }
              }
            }

            zoneMethods.push({
              name: methodName,
              price: price,
              isFree: isFreeMethod,
            });

            shippingInfo.shippingRates.push({
              name: methodName,
              price: price,
              currency: m.rateProvider?.price?.currencyCode || "USD",
              zone: zoneName,
              conditions: (m.methodConditions || []).map((c: any) => ({
                field: c.field,
                operator: c.operator,
                value: c.conditionCriteria?.amount || c.conditionCriteria?.value || "",
              })),
            });
          }

          shippingInfo.zones.push({
            name: zoneName,
            countries: countries,
            methods: zoneMethods,
          });
        }
      }
    }

    return json(shippingInfo, { headers: corsHeaders });
  } catch (error: unknown) {
    console.error("[ShippingEstimate] Error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return json(
      { error: errorMessage, shipping: null },
      { status: 500, headers: corsHeaders }
    );
  }
};
