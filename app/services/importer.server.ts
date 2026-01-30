import prisma from "../db.server";
import { SSActiveWearClient, type SSProduct } from "./ssactivewear";

const ssClient = new SSActiveWearClient();
const VARIANT_BATCH_SIZE = 50;
const MAX_VARIANTS = 2000; // Shopify limit is 2048, leave some margin
const MAX_IMAGES = 50;

interface ImportResult {
  productMap: any;
  shopifyProduct: any;
  variantCount: number;
  imageCount: number;
  message: string;
}

export class ImporterService {
  /**
   * Full import of SSActiveWear style to Shopify
   * Supports up to 2000 variants with all data
   */
  async importStyle(admin: any, styleId: number): Promise<ImportResult> {
    console.log(`[Importer] ========================================`);
    console.log(`[Importer] Starting import for style ${styleId}`);
    console.log(`[Importer] ========================================`);

    // 1. Fetch style details
    const style = await this.fetchStyleDetails(styleId);
    console.log(`[Importer] Style: ${style.title} by ${style.brandName}`);

    // 2. Fetch all products (variants)
    const products = await ssClient.getProducts(styleId);
    if (!products || products.length === 0) {
      throw new Error(`No products found for style ${styleId}`);
    }
    console.log(`[Importer] Total SKUs from SSActiveWear: ${products.length}`);

    // 3. Extract unique colors, sizes, and prepare data
    const { colors, sizes, colorImages } = this.extractProductData(products);
    console.log(`[Importer] Unique colors: ${colors.length}, sizes: ${sizes.length}`);

    // 4. Create base product
    const shopifyProduct = await this.createBaseProduct(admin, style, products);
    console.log(`[Importer] Base product created: ${shopifyProduct.id}`);

    // 5. Create options (Color, Size)
    const optionIds = await this.createOptions(admin, shopifyProduct.id, colors, sizes);
    console.log(`[Importer] Options created - Color: ${optionIds.colorOptionId}, Size: ${optionIds.sizeOptionId}`);

    // 6. Delete the default variant created with product
    await this.deleteDefaultVariant(admin, shopifyProduct.id);

    // 7. Create all variants in batches
    const variantCount = await this.createVariantsInBatches(admin, shopifyProduct.id, products, optionIds);
    console.log(`[Importer] Created ${variantCount} variants`);

    // 8. Add product images
    const imageCount = await this.addProductImages(admin, shopifyProduct.id, style, colorImages);
    console.log(`[Importer] Added ${imageCount} images`);

    // 9. Update inventory for all variants
    await this.updateAllInventory(admin, shopifyProduct.id, products);
    console.log(`[Importer] Inventory updated`);

    // 10. Publish product
    await this.publishProduct(admin, shopifyProduct.id);

    // 11. Save mapping to database
    const productMap = await prisma.productMap.create({
      data: {
        shopifyProductId: shopifyProduct.id,
        ssStyleId: String(style.styleID),
      },
    });

    console.log(`[Importer] ========================================`);
    console.log(`[Importer] ✅ Import complete!`);
    console.log(`[Importer] Product: ${style.title}`);
    console.log(`[Importer] Variants: ${variantCount}`);
    console.log(`[Importer] Images: ${imageCount}`);
    console.log(`[Importer] ========================================`);

    return {
      productMap,
      shopifyProduct,
      variantCount,
      imageCount,
      message: `Successfully imported ${style.title} with ${variantCount} variants and ${imageCount} images`,
    };
  }

  private async fetchStyleDetails(styleId: number) {
    const styleDetails = await ssClient.getStyleDetails(styleId);
    if (!styleDetails || styleDetails.length === 0) {
      throw new Error(`Style ${styleId} not found`);
    }
    return styleDetails[0];
  }

  private extractProductData(products: SSProduct[]) {
    const colorMap = new Map<string, { name: string; images: string[] }>();
    const sizeSet = new Set<string>();

    products.forEach(p => {
      // Collect sizes
      if (p.sizeName) sizeSet.add(p.sizeName);

      // Collect colors and their images
      if (p.colorName && !colorMap.has(p.colorCode)) {
        const images: string[] = [];
        if (p.colorFrontImage) images.push(this.getFullImageUrl(p.colorFrontImage));
        if (p.colorBackImage) images.push(this.getFullImageUrl(p.colorBackImage));
        if (p.colorSideImage) images.push(this.getFullImageUrl(p.colorSideImage));
        if (p.colorOnModelFrontImage) images.push(this.getFullImageUrl(p.colorOnModelFrontImage));
        if (p.colorOnModelBackImage) images.push(this.getFullImageUrl(p.colorOnModelBackImage));

        colorMap.set(p.colorCode, { name: p.colorName, images });
      }
    });

    // Sort sizes in logical order
    const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
    const sizes = Array.from(sizeSet).sort((a, b) => {
      const aIdx = sizeOrder.indexOf(a);
      const bIdx = sizeOrder.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a.localeCompare(b);
    });

    const colors = Array.from(colorMap.values()).map(v => v.name);
    const colorImages = colorMap;

    return { colors, sizes, colorImages };
  }

  private async createBaseProduct(admin: any, style: any, products: SSProduct[]) {
    // Build description
    const description = this.buildDescription(style, products);

    const mutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            handle
            title
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await admin.graphql(mutation, {
      variables: {
        input: {
          title: style.title,
          descriptionHtml: description,
          vendor: style.brandName,
          productType: style.baseCategory || "Apparel",
          status: "DRAFT", // Start as draft, publish after complete
          tags: this.buildTags(style),
        },
      },
    });

    const json = await response.json();

    if (json.errors) {
      console.error("[Importer] productCreate errors:", JSON.stringify(json.errors));
      throw new Error(`Failed to create product: ${JSON.stringify(json.errors)}`);
    }

    if (json.data?.productCreate?.userErrors?.length > 0) {
      console.error("[Importer] productCreate userErrors:", json.data.productCreate.userErrors);
      throw new Error(`Failed to create product: ${JSON.stringify(json.data.productCreate.userErrors)}`);
    }

    return json.data.productCreate.product;
  }

  private async createOptions(admin: any, productId: string, colors: string[], sizes: string[]) {
    const mutation = `
      mutation productOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
        productOptionsCreate(productId: $productId, options: $options, variantStrategy: LEAVE_AS_IS) {
          product {
            id
            options {
              id
              name
              position
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
          {
            name: "Color",
            position: 1,
            values: colors.map(c => ({ name: c }))
          },
          {
            name: "Size",
            position: 2,
            values: sizes.map(s => ({ name: s }))
          },
        ],
      },
    });

    const json = await response.json();

    if (json.errors) {
      console.error("[Importer] productOptionsCreate errors:", JSON.stringify(json.errors));
      throw new Error(`Failed to create options: ${JSON.stringify(json.errors)}`);
    }

    if (json.data?.productOptionsCreate?.userErrors?.length > 0) {
      console.error("[Importer] productOptionsCreate userErrors:", json.data.productOptionsCreate.userErrors);
      throw new Error(`Failed to create options: ${JSON.stringify(json.data.productOptionsCreate.userErrors)}`);
    }

    const options = json.data.productOptionsCreate.product.options;
    const colorOption = options.find((o: any) => o.name === "Color");
    const sizeOption = options.find((o: any) => o.name === "Size");

    return {
      colorOptionId: colorOption?.id,
      sizeOptionId: sizeOption?.id,
    };
  }

  private async deleteDefaultVariant(admin: any, productId: string) {
    // Get default variant
    const query = `
      query getDefaultVariant($productId: ID!) {
        product(id: $productId) {
          variants(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
      }
    `;

    try {
      const response = await admin.graphql(query, { variables: { productId } });
      const json = await response.json();

      const defaultVariantId = json.data?.product?.variants?.edges?.[0]?.node?.id;
      if (!defaultVariantId) return;

      // Delete default variant
      const deleteMutation = `
        mutation productVariantsBulkDelete($productId: ID!, $variantsIds: [ID!]!) {
          productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
            userErrors {
              field
              message
            }
          }
        }
      `;

      await admin.graphql(deleteMutation, {
        variables: {
          productId,
          variantsIds: [defaultVariantId],
        },
      });

      console.log("[Importer] Default variant deleted");
    } catch (error) {
      console.log("[Importer] Could not delete default variant:", error);
    }
  }

  private async createVariantsInBatches(
    admin: any,
    productId: string,
    products: SSProduct[],
    optionIds: { colorOptionId: string; sizeOptionId: string }
  ): Promise<number> {
    const mutation = `
      mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
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
    const limitedProducts = products.slice(0, MAX_VARIANTS);
    const totalBatches = Math.ceil(limitedProducts.length / VARIANT_BATCH_SIZE);

    for (let i = 0; i < limitedProducts.length; i += VARIANT_BATCH_SIZE) {
      const batchNum = Math.floor(i / VARIANT_BATCH_SIZE) + 1;
      const batch = limitedProducts.slice(i, i + VARIANT_BATCH_SIZE);

      console.log(`[Importer] Creating variant batch ${batchNum}/${totalBatches} (${batch.length} variants)`);

      const variants = batch.map(p => ({
        sku: p.sku,
        price: String(p.piecePrice || 0),
        compareAtPrice: p.mapPrice && p.mapPrice > (p.piecePrice || 0) ? String(p.mapPrice) : null,
        barcode: p.gtin || null,
        optionValues: [
          { name: p.colorName, optionName: "Color" },
          { name: p.sizeName, optionName: "Size" },
        ],
        inventoryPolicy: "DENY",
      }));

      try {
        const response = await admin.graphql(mutation, {
          variables: { productId, variants },
        });

        const json = await response.json();

        if (json.errors) {
          console.error(`[Importer] Batch ${batchNum} GraphQL errors:`, JSON.stringify(json.errors));
          continue;
        }

        if (json.data?.productVariantsBulkCreate?.userErrors?.length > 0) {
          const errors = json.data.productVariantsBulkCreate.userErrors;
          console.warn(`[Importer] Batch ${batchNum} user errors:`, errors.slice(0, 3));
        }

        const created = json.data?.productVariantsBulkCreate?.productVariants?.length || 0;
        totalCreated += created;

        console.log(`[Importer] Batch ${batchNum} created ${created} variants`);

        // Small delay between batches to avoid rate limits
        if (i + VARIANT_BATCH_SIZE < limitedProducts.length) {
          await this.delay(200);
        }
      } catch (error) {
        console.error(`[Importer] Batch ${batchNum} failed:`, error);
      }
    }

    return totalCreated;
  }

  private async addProductImages(
    admin: any,
    productId: string,
    style: any,
    colorImages: Map<string, { name: string; images: string[] }>
  ): Promise<number> {
    const mutation = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage {
              id
            }
          }
          mediaUserErrors {
            field
            message
          }
        }
      }
    `;

    const mediaInputs: any[] = [];

    // Add main style image first
    if (style.styleImage) {
      mediaInputs.push({
        originalSource: this.getFullImageUrl(style.styleImage),
        alt: style.title,
        mediaContentType: "IMAGE",
      });
    }

    // Add color images (deduplicated)
    const addedUrls = new Set<string>();
    if (style.styleImage) {
      addedUrls.add(this.getFullImageUrl(style.styleImage));
    }

    for (const [, colorData] of colorImages) {
      if (mediaInputs.length >= MAX_IMAGES) break;

      for (const imageUrl of colorData.images) {
        if (mediaInputs.length >= MAX_IMAGES) break;
        if (imageUrl && !addedUrls.has(imageUrl)) {
          mediaInputs.push({
            originalSource: imageUrl,
            alt: `${style.title} - ${colorData.name}`,
            mediaContentType: "IMAGE",
          });
          addedUrls.add(imageUrl);
        }
      }
    }

    if (mediaInputs.length === 0) {
      return 0;
    }

    // Add images in batches of 10
    let totalAdded = 0;
    for (let i = 0; i < mediaInputs.length; i += 10) {
      const batch = mediaInputs.slice(i, i + 10);

      try {
        const response = await admin.graphql(mutation, {
          variables: { productId, media: batch },
        });

        const json = await response.json();

        if (json.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
          console.warn("[Importer] Media errors:", json.data.productCreateMedia.mediaUserErrors.slice(0, 3));
        }

        totalAdded += json.data?.productCreateMedia?.media?.length || 0;

        // Delay between batches
        if (i + 10 < mediaInputs.length) {
          await this.delay(500);
        }
      } catch (error) {
        console.error("[Importer] Failed to add image batch:", error);
      }
    }

    return totalAdded;
  }

  private async updateAllInventory(admin: any, productId: string, products: SSProduct[]) {
    // Get location ID
    const locationId = await this.getDefaultLocationId(admin);
    if (!locationId) {
      console.log("[Importer] No location found, skipping inventory update");
      return;
    }

    // Get all variants with their inventory items
    const variants = await this.getAllVariants(admin, productId);
    if (!variants.length) {
      console.log("[Importer] No variants found for inventory update");
      return;
    }

    // Build SKU to stock map
    const skuStockMap = new Map<string, number>();
    products.forEach(p => {
      const stock = p.warehouses?.reduce((sum, w) => sum + (w.qty || 0), 0) || p.qty || 0;
      skuStockMap.set(p.sku, stock);
    });

    // Update inventory in batches
    const inventoryMutation = `
      mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    const batchSize = 20;
    for (let i = 0; i < variants.length; i += batchSize) {
      const batch = variants.slice(i, i + batchSize);

      const quantities = batch
        .filter(v => v.inventoryItemId && skuStockMap.has(v.sku))
        .map(v => ({
          inventoryItemId: v.inventoryItemId,
          locationId,
          quantity: skuStockMap.get(v.sku) || 0,
        }));

      if (quantities.length === 0) continue;

      try {
        await admin.graphql(inventoryMutation, {
          variables: {
            input: {
              reason: "correction",
              name: "available",
              quantities,
            },
          },
        });
      } catch (error) {
        console.warn("[Importer] Inventory batch update error:", error);
      }

      if (i + batchSize < variants.length) {
        await this.delay(100);
      }
    }

    console.log(`[Importer] Updated inventory for ${variants.length} variants`);
  }

  private async getDefaultLocationId(admin: any): Promise<string | null> {
    try {
      const response = await admin.graphql(`
        query {
          locations(first: 1) {
            edges {
              node {
                id
              }
            }
          }
        }
      `);
      const json = await response.json();
      return json.data?.locations?.edges?.[0]?.node?.id || null;
    } catch {
      return null;
    }
  }

  private async getAllVariants(admin: any, productId: string) {
    const variants: Array<{ id: string; sku: string; inventoryItemId: string }> = [];
    let cursor: string | null = null;

    do {
      const query = `
        query getVariants($productId: ID!, $cursor: String) {
          product(id: $productId) {
            variants(first: 100, after: $cursor) {
              edges {
                node {
                  id
                  sku
                  inventoryItem {
                    id
                  }
                }
                cursor
              }
              pageInfo {
                hasNextPage
              }
            }
          }
        }
      `;

      try {
        const response = await admin.graphql(query, {
          variables: { productId, cursor }
        });
        const json = await response.json();

        const edges = json.data?.product?.variants?.edges || [];
        edges.forEach((edge: any) => {
          if (edge.node.sku) {
            variants.push({
              id: edge.node.id,
              sku: edge.node.sku,
              inventoryItemId: edge.node.inventoryItem?.id,
            });
          }
          cursor = edge.cursor;
        });

        if (!json.data?.product?.variants?.pageInfo?.hasNextPage) {
          cursor = null;
        }
      } catch {
        cursor = null;
      }
    } while (cursor);

    return variants;
  }

  private async publishProduct(admin: any, productId: string) {
    try {
      // Get the online store publication
      const pubQuery = `
        query {
          publications(first: 10) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      `;

      const pubResponse = await admin.graphql(pubQuery);
      const pubJson = await pubResponse.json();

      const onlineStore = pubJson.data?.publications?.edges?.find(
        (e: any) => e.node.name === "Online Store"
      );

      if (onlineStore) {
        await admin.graphql(`
          mutation publishProduct($id: ID!, $input: [PublicationInput!]!) {
            publishablePublish(id: $id, input: $input) {
              userErrors { field message }
            }
          }
        `, {
          variables: {
            id: productId,
            input: [{ publicationId: onlineStore.node.id }],
          },
        });
      }

      // Also set status to ACTIVE
      await admin.graphql(`
        mutation updateStatus($input: ProductInput!) {
          productUpdate(input: $input) {
            userErrors { field message }
          }
        }
      `, {
        variables: {
          input: {
            id: productId,
            status: "ACTIVE",
          },
        },
      });

      console.log("[Importer] Product published");
    } catch (error) {
      console.warn("[Importer] Could not publish product:", error);
    }
  }

  private buildDescription(style: any, products: SSProduct[]): string {
    const colors = [...new Set(products.map(p => p.colorName))];
    const sizes = [...new Set(products.map(p => p.sizeName))];
    const prices = products.filter(p => p.piecePrice > 0).map(p => p.piecePrice);
    const minPrice = prices.length ? Math.min(...prices).toFixed(2) : "N/A";
    const maxPrice = prices.length ? Math.max(...prices).toFixed(2) : "N/A";

    return `
<div class="ss-product-description">
  ${style.description || ""}

  <h4>Product Details</h4>
  <ul>
    <li><strong>Brand:</strong> ${style.brandName}</li>
    <li><strong>Style Number:</strong> ${style.partNumber}</li>
    <li><strong>Category:</strong> ${style.baseCategory || "Apparel"}</li>
    <li><strong>Available Colors:</strong> ${colors.length} (${colors.slice(0, 8).join(", ")}${colors.length > 8 ? "..." : ""})</li>
    <li><strong>Available Sizes:</strong> ${sizes.join(", ")}</li>
    <li><strong>Price Range:</strong> $${minPrice} - $${maxPrice}</li>
    <li><strong>Total Variants:</strong> ${products.length}</li>
  </ul>

  <p><small>Sourced from SSActiveWear - Style ID: ${style.styleID}</small></p>
</div>
    `.trim();
  }

  private buildTags(style: any): string[] {
    const tags = [
      style.brandName,
      style.baseCategory,
      "SSActiveWear",
      `ss-style-${style.styleID}`,
      style.partNumber,
    ];
    return tags.filter(Boolean);
  }

  private getFullImageUrl(imagePath: string | undefined): string {
    if (!imagePath) return "";
    if (imagePath.startsWith("http")) return imagePath;
    return `https://www.ssactivewear.com/${imagePath}`;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
