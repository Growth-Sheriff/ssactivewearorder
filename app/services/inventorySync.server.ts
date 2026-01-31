import prisma from "../db.server";
import { SSActiveWearClient } from "./ssactivewear";

const ssClient = new SSActiveWearClient();

/**
 * Inventory Sync Service
 * Syncs inventory from SSActiveWear to Shopify for imported products
 */
export class InventorySyncService {

  /**
   * Full inventory sync for all imported products
   */
  async syncAllInventory(admin: any, shop: string): Promise<{
    total: number;
    updated: number;
    failed: number;
    logId: string;
  }> {
    // Create sync log
    const syncLog = await prisma.inventorySyncLog.create({
      data: {
        shop,
        syncType: "full",
        status: "running",
        productsTotal: 0,
        productsUpdated: 0,
        productsFailed: 0,
      },
    });

    let updated = 0;
    let failed = 0;

    try {
      // Get all imported products for this shop
      const productMaps = await prisma.productMap.findMany({
        where: { shop },
        select: { id: true, shopifyProductId: true, ssStyleId: true },
      });

      await prisma.inventorySyncLog.update({
        where: { id: syncLog.id },
        data: { productsTotal: productMaps.length },
      });

      console.log(`[InventorySync] Starting sync for ${productMaps.length} products...`);

      // Get location
      const locResponse = await admin.graphql(`query { locations(first: 1) { edges { node { id } } } }`);
      const locJson = await locResponse.json();
      const locationId = locJson.data?.locations?.edges?.[0]?.node?.id;

      if (!locationId) {
        throw new Error("No location found");
      }

      // Process each product
      for (const productMap of productMaps) {
        try {
          const styleId = parseInt(productMap.ssStyleId);
          if (isNaN(styleId)) continue;

          // Get inventory from SSActiveWear
          const ssInventory = await ssClient.getInventoryByStyle(styleId);

          // Build SKU -> quantity map
          const stockMap = new Map<string, number>();
          for (const item of ssInventory) {
            const totalQty = item.warehouses?.reduce((sum, w) => sum + (w.qty || 0), 0) || 0;
            stockMap.set(item.sku, totalQty);
          }

          // Get Shopify variants
          const varResponse = await admin.graphql(`
            query($productId: ID!) {
              product(id: $productId) {
                variants(first: 100) {
                  edges { node { sku inventoryItem { id } } }
                }
              }
            }
          `, { variables: { productId: productMap.shopifyProductId } });

          const varJson = await varResponse.json();
          const variants = varJson.data?.product?.variants?.edges || [];

          // Build quantities array
          const quantities: Array<{ inventoryItemId: string; locationId: string; quantity: number }> = [];

          for (const edge of variants) {
            const { sku, inventoryItem } = edge.node;
            if (sku && inventoryItem?.id && stockMap.has(sku)) {
              quantities.push({
                inventoryItemId: inventoryItem.id,
                locationId,
                quantity: stockMap.get(sku)!,
              });
            }
          }

          // Update inventory in batches
          for (let i = 0; i < quantities.length; i += 20) {
            const batch = quantities.slice(i, i + 20);
            await admin.graphql(`
              mutation($input: InventorySetQuantitiesInput!) {
                inventorySetQuantities(input: $input) {
                  userErrors { message }
                }
              }
            `, {
              variables: {
                input: {
                  ignoreCompareQuantity: true,
                  reason: "correction",
                  name: "available",
                  quantities: batch,
                },
              },
            });
          }

          updated++;
        } catch (error) {
          failed++;
          console.error(`[InventorySync] Failed to sync ${productMap.ssStyleId}:`, error);
        }
      }

      // Update sync log
      await prisma.inventorySyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "completed",
          productsUpdated: updated,
          productsFailed: failed,
          completedAt: new Date(),
        },
      });

      console.log(`[InventorySync] Complete: ${updated} updated, ${failed} failed`);

    } catch (error: any) {
      await prisma.inventorySyncLog.update({
        where: { id: syncLog.id },
        data: {
          status: "failed",
          errors: error?.message || "Unknown error",
          completedAt: new Date(),
        },
      });
      throw error;
    }

    return {
      total: updated + failed,
      updated,
      failed,
      logId: syncLog.id
    };
  }
}
