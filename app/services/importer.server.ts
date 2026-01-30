import prisma from "../db.server";
import { SSActiveWearClient, type SSProduct } from "./ssactivewear";

const ssClient = new SSActiveWearClient();
const MAX_VARIANTS = 2000;
const MAX_IMAGES = 50;
const PRODUCT_SET_MAX = 50;      // İlk batch için productSet
const BULK_BATCH_SIZE = 50;     // Sonraki batch'ler için
const BATCH_DELAY = 500;        // Rate limit koruması

interface ImportResult {
  productMap: any;
  shopifyProduct: any;
  variantCount: number;
  imageCount: number;
  message: string;
}

export class ImporterService {
  async importStyle(admin: any, styleId: number, shop: string): Promise<ImportResult> {
    console.log(`[Importer] Starting import for style ${styleId}`);

    // 1. Fetch data
    const styleDetails = await ssClient.getStyleDetails(styleId);
    if (!styleDetails?.length) throw new Error(`Style ${styleId} not found`);
    const style = styleDetails[0];

    const products = await ssClient.getProducts(styleId);
    if (!products?.length) throw new Error(`No products found for style ${styleId}`);

    console.log(`[Importer] "${style.title}" - ${products.length} SKUs`);

    // 2. Prepare data
    const { normalizedProducts, uniqueColors, uniqueSizes, colorImages } = this.prepareData(products);
    console.log(`[Importer] ${uniqueColors.length} colors, ${uniqueSizes.length} sizes, ${normalizedProducts.length} variants`);

    // 3. Split: first batch for productSet, rest for bulk create
    const firstBatch = normalizedProducts.slice(0, PRODUCT_SET_MAX);
    const remainingBatches = normalizedProducts.slice(PRODUCT_SET_MAX);

    // 4. Create product with first batch using productSet
    const { productId, createdCount: initialCreated } = await this.createProductWithFirstBatch(admin, style, firstBatch, uniqueColors, uniqueSizes);
    console.log(`[Importer] Product created: ${productId} with ${initialCreated}/${firstBatch.length} initial variants`);

    // 5. Add remaining variants in batches using productVariantsBulkCreate
    let additionalCreated = 0;
    if (remainingBatches.length > 0) {
      additionalCreated = await this.addRemainingVariants(admin, productId, remainingBatches);
      console.log(`[Importer] Added ${additionalCreated} additional variants`);
    }

    const variantCount = initialCreated + additionalCreated;

    // 6. Add images
    const imageCount = await this.addImages(admin, productId, style, colorImages);

    // 7. Update inventory
    await this.updateInventory(admin, productId, normalizedProducts);

    // 8. Publish
    await this.publishProduct(admin, productId);

    // 9. Save to DB
    const productMap = await prisma.productMap.create({
      data: {
        shop,
        shopifyProductId: productId,
        ssStyleId: String(style.styleID),
      },
    });

    console.log(`[Importer] ✅ Complete: ${variantCount} variants, ${imageCount} images`);

    return {
      productMap,
      shopifyProduct: { id: productId },
      variantCount,
      imageCount,
      message: `Imported "${style.title}" with ${variantCount} variants`,
    };
  }

  private prepareData(products: SSProduct[]) {
    const colorMap = new Map<string, string>();
    const sizeMap = new Map<string, string>();
    const colorImages = new Map<string, string[]>();

    products.forEach(p => {
      const colorKey = this.normalize(p.colorName);
      if (colorKey && !colorMap.has(colorKey)) {
        colorMap.set(colorKey, p.colorName.trim());
        const images: string[] = [];
        if (p.colorFrontImage) images.push(this.fullUrl(p.colorFrontImage));
        if (p.colorBackImage) images.push(this.fullUrl(p.colorBackImage));
        colorImages.set(colorKey, images);
      }

      const sizeKey = this.normalize(p.sizeName);
      if (sizeKey && !sizeMap.has(sizeKey)) {
        sizeMap.set(sizeKey, p.sizeName.trim());
      }
    });

    const sizeOrder = ['xxs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl', '4xl', '5xl'];
    const sortedSizes = Array.from(sizeMap.entries()).sort((a, b) => {
      const aIdx = sizeOrder.indexOf(a[0]);
      const bIdx = sizeOrder.indexOf(b[0]);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      return a[0].localeCompare(b[0]);
    });

    const uniqueColors = Array.from(colorMap.values());
    const uniqueSizes = sortedSizes.map(([, v]) => v);

    const seenCombos = new Set<string>();
    const deduplicatedProducts: any[] = [];

    for (const p of products) {
      const colorKey = this.normalize(p.colorName);
      const sizeKey = this.normalize(p.sizeName);
      if (!colorKey || !sizeKey) continue;

      const comboKey = `${colorKey}|${sizeKey}`;
      if (seenCombos.has(comboKey)) continue;

      seenCombos.add(comboKey);
      deduplicatedProducts.push({
        ...p,
        normalizedColor: colorMap.get(colorKey) || p.colorName.trim(),
        normalizedSize: sizeMap.get(sizeKey) || p.sizeName.trim(),
        totalStock: p.warehouses?.reduce((s, w) => s + (w.qty || 0), 0) || p.qty || 0,
      });
    }

    return {
      normalizedProducts: deduplicatedProducts.slice(0, MAX_VARIANTS),
      uniqueColors,
      uniqueSizes,
      colorImages
    };
  }

  private async createProductWithFirstBatch(
    admin: any,
    style: any,
    products: any[],
    colors: string[],
    sizes: string[]
  ): Promise<{ productId: string; createdCount: number }> {
    // ProductVariantSetInput - sku is direct field
    const variants = products.map(p => ({
      sku: p.sku,
      price: (p.piecePrice || 0).toFixed(2),
      compareAtPrice: p.mapPrice && p.mapPrice > (p.piecePrice || 0) ? p.mapPrice.toFixed(2) : undefined,
      barcode: p.gtin || undefined,
      inventoryPolicy: "DENY",
      optionValues: [
        { optionName: "Color", name: p.normalizedColor },
        { optionName: "Size", name: p.normalizedSize },
      ],
    }));

    // Use ASYNCHRONOUS mode to avoid timeout!
    const response = await admin.graphql(`
      mutation productSet($input: ProductSetInput!, $synchronous: Boolean!) {
        productSet(synchronous: $synchronous, input: $input) {
          product {
            id
            variantsCount { count }
          }
          productSetOperation {
            id
            status
          }
          userErrors { field message code }
        }
      }
    `, {
      variables: {
        synchronous: false,  // ASYNC MODE - prevents timeout!
        input: {
          title: style.title,
          descriptionHtml: this.buildDescription(style, products),
          vendor: style.brandName,
          productType: style.baseCategory || "Apparel",
          status: "DRAFT",
          tags: [style.brandName, style.baseCategory, "SSActiveWear", `ss-${style.styleID}`].filter(Boolean),
          productOptions: [
            { name: "Color", position: 1, values: colors.map(c => ({ name: c })) },
            { name: "Size", position: 2, values: sizes.map(s => ({ name: s })) },
          ],
          variants,
        },
      },
    });

    const json = await response.json();

    if (json.errors?.length) {
      console.log(`[Importer] GraphQL errors:`, JSON.stringify(json.errors).slice(0, 500));
      throw new Error(`productSet GraphQL error: ${json.errors[0].message}`);
    }

    if (json.data?.productSet?.userErrors?.length > 0) {
      console.log(`[Importer] userErrors:`, JSON.stringify(json.data.productSet.userErrors));
      throw new Error(`productSet error: ${json.data.productSet.userErrors[0].message}`);
    }

    // If synchronous result available (small product)
    if (json.data?.productSet?.product?.id) {
      const productId = json.data.productSet.product.id;
      const createdCount = json.data.productSet.product.variantsCount?.count || products.length;
      return { productId, createdCount };
    }

    // ASYNC: Poll for operation completion
    const operationId = json.data?.productSet?.productSetOperation?.id;
    if (!operationId) {
      throw new Error("No product ID or operation ID returned");
    }

    console.log(`[Importer] Async operation started: ${operationId}`);

    // Poll until complete (max 5 minutes)
    const maxAttempts = 60;  // 60 * 5 seconds = 5 minutes
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.delay(5000);  // Wait 5 seconds between polls

      const statusResponse = await admin.graphql(`
        query productOperation($id: ID!) {
          productOperation(id: $id) {
            ... on ProductSetOperation {
              id
              status
              product {
                id
                variantsCount { count }
              }
              userErrors { field message code }
            }
          }
        }
      `, { variables: { id: operationId } });

      const statusJson = await statusResponse.json();
      const operation = statusJson.data?.productOperation;

      if (!operation) {
        console.log(`[Importer] Poll ${attempt + 1}: No operation data`);
        continue;
      }

      console.log(`[Importer] Poll ${attempt + 1}: status=${operation.status}`);

      if (operation.status === "COMPLETE") {
        if (operation.userErrors?.length > 0) {
          throw new Error(`productSet operation failed: ${operation.userErrors[0].message}`);
        }
        const productId = operation.product?.id;
        if (!productId) throw new Error("Operation complete but no product ID");
        const createdCount = operation.product?.variantsCount?.count || products.length;
        return { productId, createdCount };
      }

      if (operation.status === "FAILED") {
        throw new Error(`productSet operation failed: ${operation.userErrors?.[0]?.message || 'Unknown error'}`);
      }

      // CREATED or RUNNING - continue polling
    }

    throw new Error("productSet operation timed out after 5 minutes");
  }

  private async addRemainingVariants(admin: any, productId: string, products: any[]): Promise<number> {
    let totalCreated = 0;

    for (let i = 0; i < products.length; i += BULK_BATCH_SIZE) {
      const batch = products.slice(i, i + BULK_BATCH_SIZE);
      const batchNum = Math.floor(i / BULK_BATCH_SIZE) + 1;

      // ProductVariantsBulkInput - sku MUST be inside inventoryItem (per Shopify 2025-10 docs)
      const variants = batch.map(p => ({
        inventoryItem: { sku: p.sku },
        price: (p.piecePrice || 0).toFixed(2),
        compareAtPrice: p.mapPrice && p.mapPrice > (p.piecePrice || 0) ? p.mapPrice.toFixed(2) : undefined,
        barcode: p.gtin || undefined,
        inventoryPolicy: "DENY",
        optionValues: [
          { optionName: "Color", name: p.normalizedColor },
          { optionName: "Size", name: p.normalizedSize },
        ],
      }));

      try {
        const response = await admin.graphql(`
          mutation bulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $productId, variants: $variants) {
              productVariants { id }
              userErrors { field message }
            }
          }
        `, { variables: { productId, variants } });

        const json = await response.json();
        const created = json.data?.productVariantsBulkCreate?.productVariants?.length || 0;
        totalCreated += created;

        if (json.data?.productVariantsBulkCreate?.userErrors?.length > 0) {
          console.log(`[Importer] Batch ${batchNum} userErrors:`, json.data.productVariantsBulkCreate.userErrors[0].message);
        }

        await this.delay(BATCH_DELAY);
      } catch (err) {
        console.log(`[Importer] Batch ${batchNum} failed:`, err instanceof Error ? err.message : err);
      }
    }

    return totalCreated;
  }

  private async addImages(admin: any, productId: string, style: any, colorImages: Map<string, string[]>): Promise<number> {
    // Step 1: Upload all media and track color -> mediaId mapping
    const colorMediaMap = new Map<string, string>(); // normalized color -> first media id
    const allMedia: any[] = [];
    const addedUrls = new Set<string>();
    const urlToColor = new Map<string, string>(); // url -> normalized color

    // Main style image first
    if (style.styleImage) {
      const url = this.fullUrl(style.styleImage);
      allMedia.push({ originalSource: url, alt: style.title, mediaContentType: "IMAGE" });
      addedUrls.add(url);
    }

    // Color images - track which URL belongs to which color
    for (const [colorKey, images] of colorImages) {
      if (allMedia.length >= MAX_IMAGES) break;
      for (const url of images) {
        if (allMedia.length >= MAX_IMAGES) break;
        if (url && !addedUrls.has(url)) {
          allMedia.push({ originalSource: url, alt: `${style.title} - ${colorKey}`, mediaContentType: "IMAGE" });
          addedUrls.add(url);
          if (!urlToColor.has(url)) {
            urlToColor.set(url, colorKey);
          }
        }
      }
    }

    if (allMedia.length === 0) return 0;

    // Upload media in batches and collect media IDs
    const uploadedMedia: Array<{ id: string; alt: string }> = [];
    for (let i = 0; i < allMedia.length; i += 10) {
      const batch = allMedia.slice(i, i + 10);
      try {
        const response = await admin.graphql(`
          mutation addMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              media {
                ... on MediaImage {
                  id
                  alt
                  image { url }
                }
              }
            }
          }
        `, { variables: { productId, media: batch } });

        const json = await response.json();
        const mediaItems = json.data?.productCreateMedia?.media || [];
        for (const m of mediaItems) {
          if (m?.id) {
            uploadedMedia.push({ id: m.id, alt: m.alt || "" });
          }
        }
        await this.delay(300);
      } catch (error) { /* continue */ }
    }

    // Build colorKey -> mediaId map from alt text
    for (const media of uploadedMedia) {
      const altParts = media.alt.split(" - ");
      if (altParts.length >= 2) {
        const colorKey = altParts[altParts.length - 1].toLowerCase().trim();
        if (!colorMediaMap.has(colorKey)) {
          colorMediaMap.set(colorKey, media.id);
        }
      }
    }

    // Step 2: Attach media to variants by color
    if (colorMediaMap.size > 0) {
      await this.attachMediaToVariants(admin, productId, colorMediaMap);
    }

    return uploadedMedia.length;
  }

  private async attachMediaToVariants(admin: any, productId: string, colorMediaMap: Map<string, string>) {
    // Get all variants with their color option
    const variants: Array<{ id: string; color: string }> = [];
    let cursor: string | null = null;

    do {
      const response = await admin.graphql(`
        query($productId: ID!, $cursor: String) {
          product(id: $productId) {
            variants(first: 100, after: $cursor) {
              edges {
                node {
                  id
                  selectedOptions { name value }
                }
                cursor
              }
              pageInfo { hasNextPage }
            }
          }
        }
      `, { variables: { productId, cursor } });

      const json = await response.json();
      for (const edge of json.data?.product?.variants?.edges || []) {
        const colorOption = edge.node.selectedOptions?.find((o: any) => o.name === "Color");
        if (colorOption) {
          variants.push({
            id: edge.node.id,
            color: colorOption.value.toLowerCase().trim()
          });
        }
        cursor = edge.cursor;
      }
      if (!json.data?.product?.variants?.pageInfo?.hasNextPage) cursor = null;
    } while (cursor);

    // Update variants with their color's media
    const variantsToUpdate: Array<{ id: string; mediaId: string }> = [];
    for (const variant of variants) {
      const mediaId = colorMediaMap.get(variant.color);
      if (mediaId) {
        variantsToUpdate.push({ id: variant.id, mediaId });
      }
    }

    // Batch update variants with media
    for (let i = 0; i < variantsToUpdate.length; i += 50) {
      const batch = variantsToUpdate.slice(i, i + 50);
      try {
        await admin.graphql(`
          mutation bulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              userErrors { field message }
            }
          }
        `, {
          variables: {
            productId,
            variants: batch.map(v => ({ id: v.id, mediaId: v.mediaId })),
          },
        });
        await this.delay(200);
      } catch (error) { /* continue */ }
    }

    console.log(`[Importer] Attached media to ${variantsToUpdate.length} variants`);
  }

  private async updateInventory(admin: any, productId: string, products: any[]) {
    console.log(`[Importer] Updating inventory for ${products.length} variants...`);

    const locResponse = await admin.graphql(`query { locations(first: 1) { edges { node { id } } } }`);
    const locJson = await locResponse.json();
    const locationId = locJson.data?.locations?.edges?.[0]?.node?.id;

    if (!locationId) {
      console.log(`[Importer] ⚠️ No location found - skipping inventory update`);
      return;
    }
    console.log(`[Importer] Location found: ${locationId}`);

    // Build stock map from SSActiveWear products
    const stockMap = new Map<string, number>();
    let totalStock = 0;
    products.forEach(p => {
      const qty = p.totalStock || 0;
      stockMap.set(p.sku, qty);
      totalStock += qty;
    });
    console.log(`[Importer] Stock map built: ${stockMap.size} SKUs, total: ${totalStock} units`);

    // Get variants from Shopify
    const items: Array<{ inventoryItemId: string; quantity: number }> = [];
    let cursor: string | null = null;

    do {
      const response = await admin.graphql(`
        query($productId: ID!, $cursor: String) {
          product(id: $productId) {
            variants(first: 100, after: $cursor) {
              edges { node { sku inventoryItem { id } } cursor }
              pageInfo { hasNextPage }
            }
          }
        }
      `, { variables: { productId, cursor } });

      const json = await response.json();
      for (const edge of json.data?.product?.variants?.edges || []) {
        const { sku, inventoryItem } = edge.node;
        if (sku && inventoryItem?.id && stockMap.has(sku)) {
          items.push({ inventoryItemId: inventoryItem.id, quantity: stockMap.get(sku)! });
        }
        cursor = edge.cursor;
      }
      if (!json.data?.product?.variants?.pageInfo?.hasNextPage) cursor = null;
    } while (cursor);

    console.log(`[Importer] Found ${items.length} variants to update inventory`);

    // Update inventory in batches
    let updatedCount = 0;
    for (let i = 0; i < items.length; i += 20) {
      const batch = items.slice(i, i + 20);
      try {
        const result = await admin.graphql(`
          mutation($input: InventorySetQuantitiesInput!) {
            inventorySetQuantities(input: $input) {
              inventoryAdjustmentGroup { id }
              userErrors { message field }
            }
          }
        `, {
          variables: {
            input: {
              reason: "correction",
              name: "available",
              quantities: batch.map(item => ({
                inventoryItemId: item.inventoryItemId,
                locationId,
                quantity: item.quantity,
              })),
            },
          },
        });

        const resultJson = await result.json();
        if (resultJson.data?.inventorySetQuantities?.userErrors?.length > 0) {
          console.log(`[Importer] Inventory batch error:`, resultJson.data.inventorySetQuantities.userErrors[0].message);
        } else {
          updatedCount += batch.length;
        }
        await this.delay(100);
      } catch (error) {
        console.log(`[Importer] Inventory batch failed:`, error);
      }
    }

    console.log(`[Importer] ✅ Inventory updated: ${updatedCount}/${items.length} variants`);
  }

  private async publishProduct(admin: any, productId: string) {
    try {
      await admin.graphql(`
        mutation($input: ProductInput!) {
          productUpdate(input: $input) { userErrors { message } }
        }
      `, { variables: { input: { id: productId, status: "ACTIVE" } } });

      const pubResponse = await admin.graphql(`query { publications(first: 10) { edges { node { id name } } } }`);
      const pubJson = await pubResponse.json();
      const onlineStore = pubJson.data?.publications?.edges?.find((e: any) => e.node.name === "Online Store");

      if (onlineStore) {
        await admin.graphql(`
          mutation($id: ID!, $input: [PublicationInput!]!) {
            publishablePublish(id: $id, input: $input) { userErrors { message } }
          }
        `, { variables: { id: productId, input: [{ publicationId: onlineStore.node.id }] } });
      }
    } catch (error) { /* non-critical */ }
  }

  private buildDescription(style: any, products: any[]): string {
    return `<div class="product-description">
  ${style.description || ""}
  <h4>Product Details</h4>
  <ul>
    <li><strong>Brand:</strong> ${style.brandName}</li>
    <li><strong>Style:</strong> ${style.partNumber}</li>
  </ul>
</div>`.trim();
  }

  private normalize(value: string): string {
    return value ? value.trim().toLowerCase().replace(/\s+/g, " ") : "";
  }

  private fullUrl(path: string): string {
    if (!path) return "";
    return path.startsWith("http") ? path : `https://www.ssactivewear.com/${path}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
