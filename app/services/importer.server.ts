import prisma from "../db.server";
import { SSActiveWearClient, type SSProduct } from "./ssactivewear";

const ssClient = new SSActiveWearClient();
const VARIANT_BATCH_SIZE = 50;  // Safe batch size for Shopify
const MAX_VARIANTS = 2000;       // Shopify max
const MAX_IMAGES = 50;

interface ImportResult {
  productMap: any;
  shopifyProduct: any;
  variantCount: number;
  imageCount: number;
  message: string;
}

export class ImporterService {
  async importStyle(admin: any, styleId: number): Promise<ImportResult> {
    console.log(`\n[Importer] ========================================`);
    console.log(`[Importer] Starting import for style ${styleId}`);
    console.log(`[Importer] ========================================\n`);

    // 1. Fetch style details
    const styleDetails = await ssClient.getStyleDetails(styleId);
    if (!styleDetails?.length) {
      throw new Error(`Style ${styleId} not found`);
    }
    const style = styleDetails[0];
    console.log(`[Importer] Style: "${style.title}" by ${style.brandName}`);

    // 2. Fetch all products (variants) from SSActiveWear
    const products = await ssClient.getProducts(styleId);
    if (!products?.length) {
      throw new Error(`No products found for style ${styleId}`);
    }
    console.log(`[Importer] SSActiveWear SKUs: ${products.length}`);

    // 3. Log sample data
    this.logSampleData(products[0]);

    // 4. Prepare normalized data
    const { normalizedProducts, uniqueColors, uniqueSizes, colorImages } = this.prepareData(products);
    console.log(`[Importer] Unique Colors: ${uniqueColors.length}`);
    console.log(`[Importer] Unique Sizes: ${uniqueSizes.length}`);
    console.log(`[Importer] Products to import: ${normalizedProducts.length}`);

    // 5. Create base product (no variants)
    const productId = await this.createBaseProduct(admin, style, normalizedProducts);
    console.log(`[Importer] Base product: ${productId}`);

    // 6. Add options WITHOUT creating variants (LEAVE_AS_IS)
    await this.addOptionsWithoutVariants(admin, productId, uniqueColors, uniqueSizes);
    console.log(`[Importer] Options added`);

    // 7. Delete default variant
    await this.deleteAllExistingVariants(admin, productId);
    console.log(`[Importer] Default variant deleted`);

    // 8. Create variants in batches using productVariantsBulkCreate
    const variantCount = await this.createVariantsInBatches(admin, productId, normalizedProducts);
    console.log(`[Importer] Variants created: ${variantCount}`);

    // 9. Add images
    const imageCount = await this.addImages(admin, productId, style, colorImages);
    console.log(`[Importer] Images added: ${imageCount}`);

    // 10. Update inventory
    await this.updateInventory(admin, productId, normalizedProducts);
    console.log(`[Importer] Inventory updated`);

    // 11. Publish
    await this.publishProduct(admin, productId);

    // 12. Save to DB
    const productMap = await prisma.productMap.create({
      data: {
        shopifyProductId: productId,
        ssStyleId: String(style.styleID),
      },
    });

    console.log(`\n[Importer] ========================================`);
    console.log(`[Importer] ✅ IMPORT COMPLETE`);
    console.log(`[Importer] Product ID: ${productId}`);
    console.log(`[Importer] Variants: ${variantCount} / ${normalizedProducts.length}`);
    console.log(`[Importer] Images: ${imageCount}`);
    console.log(`[Importer] ========================================\n`);

    return {
      productMap,
      shopifyProduct: { id: productId },
      variantCount,
      imageCount,
      message: `Imported "${style.title}" with ${variantCount} variants`,
    };
  }

  private logSampleData(sample: SSProduct) {
    console.log(`[Importer] --- Sample SKU Data ---`);
    console.log(`[Importer] SKU: ${sample.sku}`);
    console.log(`[Importer] Color: "${sample.colorName}"`);
    console.log(`[Importer] Size: "${sample.sizeName}"`);
    console.log(`[Importer] Price: $${sample.piecePrice}`);
    const stock = sample.warehouses?.reduce((s, w) => s + w.qty, 0) || sample.qty || 0;
    console.log(`[Importer] Stock: ${stock}`);
    console.log(`[Importer] ---`);
  }

  private prepareData(products: SSProduct[]) {
    // Normalize all option values - KEY: use lowercase for consistency
    const colorMap = new Map<string, string>(); // normalized -> original display
    const sizeMap = new Map<string, string>();
    const colorImages = new Map<string, string[]>();

    products.forEach(p => {
      // Normalize color
      const colorKey = this.normalize(p.colorName);
      if (colorKey && !colorMap.has(colorKey)) {
        colorMap.set(colorKey, p.colorName.trim()); // Keep original for display

        // Collect images for this color
        const images: string[] = [];
        if (p.colorFrontImage) images.push(this.fullUrl(p.colorFrontImage));
        if (p.colorBackImage) images.push(this.fullUrl(p.colorBackImage));
        if (p.colorOnModelFrontImage) images.push(this.fullUrl(p.colorOnModelFrontImage));
        colorImages.set(colorKey, images);
      }

      // Normalize size
      const sizeKey = this.normalize(p.sizeName);
      if (sizeKey && !sizeMap.has(sizeKey)) {
        sizeMap.set(sizeKey, p.sizeName.trim());
      }
    });

    // Sort sizes logically
    const sizeOrder = ['xxs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl'];
    const sortedSizes = Array.from(sizeMap.entries()).sort((a, b) => {
      const aIdx = sizeOrder.indexOf(a[0]);
      const bIdx = sizeOrder.indexOf(b[0]);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a[0].localeCompare(b[0]);
    });

    const uniqueColors = Array.from(colorMap.values());
    const uniqueSizes = sortedSizes.map(([, original]) => original);

    // Create lookup maps for consistent option values
    // KEY: normalized (lowercase) -> VALUE: consistent display value
    const colorLookup = new Map<string, string>();
    colorMap.forEach((displayValue, normalizedKey) => {
      colorLookup.set(normalizedKey, displayValue);
    });

    const sizeLookup = new Map<string, string>();
    sizeMap.forEach((displayValue, normalizedKey) => {
      sizeLookup.set(normalizedKey, displayValue);
    });

    // Deduplicate by Color+Size combination (take first SKU for each combo)
    // This prevents Shopify error: "Cannot create duplicate variant"
    const seenCombos = new Set<string>();
    const deduplicatedProducts: typeof products = [];

    for (const p of products) {
      const colorKey = this.normalize(p.colorName);
      const sizeKey = this.normalize(p.sizeName);
      const comboKey = `${colorKey}|${sizeKey}`;

      // Skip empty values
      if (!colorKey || !sizeKey) {
        console.warn(`[Importer] Skipping SKU ${p.sku} - empty color or size`);
        continue;
      }

      // Skip duplicates
      if (seenCombos.has(comboKey)) {
        continue; // Silently skip duplicate combos
      }

      seenCombos.add(comboKey);
      deduplicatedProducts.push(p);
    }

    console.log(`[Importer] After dedup: ${deduplicatedProducts.length} unique combos (from ${products.length} SKUs)`);

    // Normalize products - USE THE SAME VALUES AS OPTIONS
    const normalizedProducts = deduplicatedProducts.slice(0, MAX_VARIANTS).map(p => {
      const colorKey = this.normalize(p.colorName);
      const sizeKey = this.normalize(p.sizeName);

      return {
        ...p,
        // Use colorMap value for consistency with options!
        normalizedColor: colorLookup.get(colorKey) || p.colorName.trim(),
        normalizedSize: sizeLookup.get(sizeKey) || p.sizeName.trim(),
        totalStock: p.warehouses?.reduce((s, w) => s + (w.qty || 0), 0) || p.qty || 0,
      };
    });

    return { normalizedProducts, uniqueColors, uniqueSizes, colorImages };
  }

  private normalize(value: string): string {
    if (!value) return "";
    return value.trim().toLowerCase().replace(/\s+/g, " ");
  }

  private async createBaseProduct(admin: any, style: any, products: any[]): Promise<string> {
    const mutation = `
      mutation createProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const description = this.buildDescription(style, products);

    const response = await admin.graphql(mutation, {
      variables: {
        input: {
          title: style.title,
          descriptionHtml: description,
          vendor: style.brandName,
          productType: style.baseCategory || "Apparel",
          status: "DRAFT",
          tags: [style.brandName, style.baseCategory, "SSActiveWear", `ss-${style.styleID}`].filter(Boolean),
        },
      },
    });

    const json = await response.json();

    if (json.errors) {
      console.error(`[Importer] productCreate errors:`, JSON.stringify(json.errors));
      throw new Error(`productCreate failed`);
    }

    if (json.data?.productCreate?.userErrors?.length > 0) {
      console.error(`[Importer] productCreate userErrors:`, JSON.stringify(json.data.productCreate.userErrors));
      throw new Error(`productCreate failed`);
    }

    const productId = json.data?.productCreate?.product?.id;
    if (!productId) {
      throw new Error("No product ID returned");
    }

    return productId;
  }

  private async addOptionsWithoutVariants(
    admin: any,
    productId: string,
    colors: string[],
    sizes: string[]
  ) {
    // Use LEAVE_AS_IS to add options without creating variant combinations
    const mutation = `
      mutation addOptions($productId: ID!, $options: [OptionCreateInput!]!) {
        productOptionsCreate(
          productId: $productId,
          options: $options,
          variantStrategy: LEAVE_AS_IS
        ) {
          product {
            options {
              id
              name
              values
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    const response = await admin.graphql(mutation, {
      variables: {
        productId,
        options: [
          { name: "Color", values: colors.map(c => ({ name: c })) },
          { name: "Size", values: sizes.map(s => ({ name: s })) },
        ],
      },
    });

    const json = await response.json();

    if (json.errors) {
      console.error(`[Importer] addOptions errors:`, JSON.stringify(json.errors));
      throw new Error(`addOptions failed: ${JSON.stringify(json.errors)}`);
    }

    if (json.data?.productOptionsCreate?.userErrors?.length > 0) {
      const errors = json.data.productOptionsCreate.userErrors;
      console.error(`[Importer] addOptions userErrors:`, JSON.stringify(errors));
      throw new Error(`addOptions failed: ${JSON.stringify(errors)}`);
    }

    console.log(`[Importer] Options: Color(${colors.length}), Size(${sizes.length})`);
  }

  private async deleteAllExistingVariants(admin: any, productId: string) {
    // Get all existing variants
    const query = `
      query getVariants($productId: ID!) {
        product(id: $productId) {
          variants(first: 100) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

    const response = await admin.graphql(query, { variables: { productId } });
    const json = await response.json();

    const variantIds = json.data?.product?.variants?.edges?.map((e: any) => e.node.id) || [];

    if (variantIds.length === 0) {
      console.log(`[Importer] No variants to delete`);
      return;
    }

    // Delete all variants
    const deleteMutation = `
      mutation deleteVariants($productId: ID!, $variantsIds: [ID!]!) {
        productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    await admin.graphql(deleteMutation, {
      variables: { productId, variantsIds: variantIds },
    });

    console.log(`[Importer] Deleted ${variantIds.length} default variant(s)`);
  }

  private async createVariantsInBatches(
    admin: any,
    productId: string,
    products: Array<{ sku: string; piecePrice: number; mapPrice?: number; gtin?: string; normalizedColor: string; normalizedSize: string; totalStock: number }>
  ): Promise<number> {

    const mutation = `
      mutation bulkCreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
          productVariants {
            id
            sku
          }
          userErrors {
            field
            message
            code
          }
        }
      }
    `;

    let totalCreated = 0;
    const totalBatches = Math.ceil(products.length / VARIANT_BATCH_SIZE);

    for (let i = 0; i < products.length; i += VARIANT_BATCH_SIZE) {
      const batchNum = Math.floor(i / VARIANT_BATCH_SIZE) + 1;
      const batch = products.slice(i, i + VARIANT_BATCH_SIZE);

      console.log(`[Importer] Batch ${batchNum}/${totalBatches}: ${batch.length} variants`);

      const variants = batch.map(p => ({
        sku: p.sku,
        price: (p.piecePrice || 0).toFixed(2),
        compareAtPrice: p.mapPrice && p.mapPrice > (p.piecePrice || 0)
          ? p.mapPrice.toFixed(2)
          : undefined,
        barcode: p.gtin || undefined,
        inventoryPolicy: "DENY",
        optionValues: [
          { optionName: "Color", name: p.normalizedColor },
          { optionName: "Size", name: p.normalizedSize },
        ],
      }));

      // Debug: Log first batch to verify option values match
      if (batchNum === 1) {
        console.log(`[DEBUG] First 3 variants:`, JSON.stringify(variants.slice(0, 3), null, 2));
      }

      try {
        const response = await admin.graphql(mutation, {
          variables: { productId, variants },
        });

        const json = await response.json();

        // Log full response for first batch
        if (batchNum === 1) {
          console.log(`[DEBUG] Full response:`, JSON.stringify(json, null, 2).slice(0, 2000));
        }

        if (json.errors) {
          console.error(`[Importer] Batch ${batchNum} GraphQL errors:`, JSON.stringify(json.errors));
          // Continue with next batch
        } else if (json.data?.productVariantsBulkCreate?.userErrors?.length > 0) {
          const errors = json.data.productVariantsBulkCreate.userErrors;
          console.error(`[Importer] Batch ${batchNum} userErrors:`, JSON.stringify(errors));
          // Still count successful ones
          const created = json.data.productVariantsBulkCreate.productVariants?.length || 0;
          totalCreated += created;
        } else {
          const created = json.data?.productVariantsBulkCreate?.productVariants?.length || 0;
          totalCreated += created;
          console.log(`[Importer] Batch ${batchNum} success: ${created} variants`);
        }

        // Rate limit protection - wait between batches
        if (i + VARIANT_BATCH_SIZE < products.length) {
          await this.delay(500);
        }
      } catch (error: any) {
        console.error(`[Importer] Batch ${batchNum} exception:`, error.message || error);
      }
    }

    if (totalCreated === 0) {
      console.error(`[Importer] WARNING: No variants created! Check option values match.`);
    }

    return totalCreated;
  }

  private async addImages(
    admin: any,
    productId: string,
    style: any,
    colorImages: Map<string, string[]>
  ): Promise<number> {
    const mutation = `
      mutation addMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage { id }
          }
          mediaUserErrors {
            field
            message
          }
        }
      }
    `;

    const allMedia: any[] = [];
    const addedUrls = new Set<string>();

    // Main image first
    if (style.styleImage) {
      const url = this.fullUrl(style.styleImage);
      allMedia.push({ originalSource: url, alt: style.title, mediaContentType: "IMAGE" });
      addedUrls.add(url);
    }

    // Color images
    for (const [, images] of colorImages) {
      if (allMedia.length >= MAX_IMAGES) break;
      for (const url of images) {
        if (allMedia.length >= MAX_IMAGES) break;
        if (url && !addedUrls.has(url)) {
          allMedia.push({ originalSource: url, alt: style.title, mediaContentType: "IMAGE" });
          addedUrls.add(url);
        }
      }
    }

    if (allMedia.length === 0) return 0;

    let totalAdded = 0;
    for (let i = 0; i < allMedia.length; i += 10) {
      const batch = allMedia.slice(i, i + 10);
      try {
        const response = await admin.graphql(mutation, { variables: { productId, media: batch } });
        const json = await response.json();
        totalAdded += json.data?.productCreateMedia?.media?.length || 0;
        await this.delay(300);
      } catch (error) {
        console.error(`[Importer] Image batch error:`, error);
      }
    }

    return totalAdded;
  }

  private async updateInventory(
    admin: any,
    productId: string,
    products: Array<{ sku: string; totalStock: number }>
  ) {
    // Get location
    const locResponse = await admin.graphql(`query { locations(first: 1) { edges { node { id } } } }`);
    const locJson = await locResponse.json();
    const locationId = locJson.data?.locations?.edges?.[0]?.node?.id;

    if (!locationId) {
      console.log(`[Importer] No location found, skipping inventory`);
      return;
    }

    // Build SKU -> stock map
    const stockMap = new Map<string, number>();
    products.forEach(p => stockMap.set(p.sku, p.totalStock));

    // Get all variants with inventory items (paginated)
    const items: Array<{ inventoryItemId: string; quantity: number }> = [];
    let cursor: string | null = null;

    do {
      const query = `
        query($productId: ID!, $cursor: String) {
          product(id: $productId) {
            variants(first: 100, after: $cursor) {
              edges {
                node {
                  sku
                  inventoryItem { id }
                }
                cursor
              }
              pageInfo { hasNextPage }
            }
          }
        }
      `;

      const response = await admin.graphql(query, { variables: { productId, cursor } });
      const json = await response.json();

      for (const edge of json.data?.product?.variants?.edges || []) {
        const { sku, inventoryItem } = edge.node;
        if (sku && inventoryItem?.id && stockMap.has(sku)) {
          items.push({
            inventoryItemId: inventoryItem.id,
            quantity: stockMap.get(sku)!,
          });
        }
        cursor = edge.cursor;
      }

      if (!json.data?.product?.variants?.pageInfo?.hasNextPage) {
        cursor = null;
      }
    } while (cursor);

    console.log(`[Importer] Updating inventory for ${items.length} items...`);

    // Update in batches
    for (let i = 0; i < items.length; i += 20) {
      const batch = items.slice(i, i + 20);
      try {
        await admin.graphql(`
          mutation($input: InventorySetQuantitiesInput!) {
            inventorySetQuantities(input: $input) {
              userErrors { message }
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
        await this.delay(100);
      } catch (error) {
        console.warn(`[Importer] Inventory batch error:`, error);
      }
    }
  }

  private async publishProduct(admin: any, productId: string) {
    try {
      // Activate
      await admin.graphql(`
        mutation($input: ProductInput!) {
          productUpdate(input: $input) { userErrors { message } }
        }
      `, { variables: { input: { id: productId, status: "ACTIVE" } } });

      // Publish to Online Store
      const pubResponse = await admin.graphql(`
        query { publications(first: 10) { edges { node { id name } } } }
      `);
      const pubJson = await pubResponse.json();

      const onlineStore = pubJson.data?.publications?.edges?.find(
        (e: any) => e.node.name === "Online Store"
      );

      if (onlineStore) {
        await admin.graphql(`
          mutation($id: ID!, $input: [PublicationInput!]!) {
            publishablePublish(id: $id, input: $input) { userErrors { message } }
          }
        `, { variables: { id: productId, input: [{ publicationId: onlineStore.node.id }] } });
      }

      console.log(`[Importer] Product published`);
    } catch (error) {
      console.warn(`[Importer] Publish error:`, error);
    }
  }

  private buildDescription(style: any, products: any[]): string {
    const uniqueColors = [...new Set(products.map((p: any) => p.normalizedColor || p.colorName))];
    const uniqueSizes = [...new Set(products.map((p: any) => p.normalizedSize || p.sizeName))];
    const prices = products.filter((p: any) => p.piecePrice > 0).map((p: any) => p.piecePrice);
    const minPrice = prices.length ? Math.min(...prices).toFixed(2) : "0.00";
    const maxPrice = prices.length ? Math.max(...prices).toFixed(2) : "0.00";
    const totalStock = products.reduce((sum: number, p: any) => sum + (p.totalStock || 0), 0);

    return `
<div class="product-description">
  ${style.description || ""}
  <h4>Product Details</h4>
  <ul>
    <li><strong>Brand:</strong> ${style.brandName}</li>
    <li><strong>Style:</strong> ${style.partNumber}</li>
    <li><strong>Colors:</strong> ${uniqueColors.length} options</li>
    <li><strong>Sizes:</strong> ${uniqueSizes.join(", ")}</li>
    <li><strong>Price:</strong> $${minPrice} - $${maxPrice}</li>
    <li><strong>Total Stock:</strong> ${totalStock.toLocaleString()} units</li>
  </ul>
  <p><small>SSActiveWear Style: ${style.styleID}</small></p>
</div>`.trim();
  }

  private fullUrl(path: string): string {
    if (!path) return "";
    if (path.startsWith("http")) return path;
    return `https://www.ssactivewear.com/${path}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
