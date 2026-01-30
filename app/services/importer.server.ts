import prisma from "../db.server";
import { SSActiveWearClient, type SSProduct } from "./ssactivewear";

const ssClient = new SSActiveWearClient();
const MAX_VARIANTS = 2000;
const MAX_IMAGES = 50;
const BATCH_SIZE = 50;

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

    // 2. Fetch all products (variants)
    const products = await ssClient.getProducts(styleId);
    if (!products?.length) {
      throw new Error(`No products found for style ${styleId}`);
    }
    console.log(`[Importer] Total SKUs from API: ${products.length}`);

    // 3. Log sample data for debugging
    this.logSampleData(products);

    // 4. Extract and normalize data
    const { colors, sizes, colorImages, normalizedProducts } = this.prepareData(products);
    console.log(`[Importer] Unique Colors: ${colors.length}`);
    console.log(`[Importer] Unique Sizes: ${sizes.length}`);
    console.log(`[Importer] Expected Variants: ${normalizedProducts.length}`);

    // 5. Create product using productSet (single atomic operation)
    const result = await this.createProductWithProductSet(
      admin,
      style,
      colors,
      sizes,
      normalizedProducts.slice(0, MAX_VARIANTS)
    );

    if (!result.productId) {
      throw new Error("Product creation failed");
    }

    console.log(`[Importer] Product created: ${result.productId}`);
    console.log(`[Importer] Variants created: ${result.variantCount}`);

    // 6. Add images
    const imageCount = await this.addImages(admin, result.productId, style, colorImages);
    console.log(`[Importer] Images added: ${imageCount}`);

    // 7. Update inventory
    await this.updateInventory(admin, result.productId, normalizedProducts);

    // 8. Publish product
    await this.publishProduct(admin, result.productId);

    // 9. Save to database
    const productMap = await prisma.productMap.create({
      data: {
        shopifyProductId: result.productId,
        ssStyleId: String(style.styleID),
      },
    });

    console.log(`\n[Importer] ========================================`);
    console.log(`[Importer] ✅ IMPORT COMPLETE`);
    console.log(`[Importer] Product: ${style.title}`);
    console.log(`[Importer] Variants: ${result.variantCount}`);
    console.log(`[Importer] Images: ${imageCount}`);
    console.log(`[Importer] ========================================\n`);

    return {
      productMap,
      shopifyProduct: { id: result.productId },
      variantCount: result.variantCount,
      imageCount,
      message: `Imported "${style.title}" with ${result.variantCount} variants`,
    };
  }

  private logSampleData(products: SSProduct[]) {
    const sample = products[0];
    console.log(`[Importer] --- Sample Product Data ---`);
    console.log(`[Importer] SKU: ${sample.sku}`);
    console.log(`[Importer] Color: "${sample.colorName}" (${sample.colorCode})`);
    console.log(`[Importer] Size: "${sample.sizeName}" (${sample.sizeCode})`);
    console.log(`[Importer] Price: $${sample.piecePrice}`);
    const stock = sample.warehouses?.reduce((s, w) => s + w.qty, 0) || sample.qty || 0;
    console.log(`[Importer] Stock: ${stock}`);
    console.log(`[Importer] ----------------------------`);
  }

  private prepareData(products: SSProduct[]) {
    // Normalize option values - trim whitespace, consistent casing
    const colorSet = new Map<string, string>(); // code -> normalized name
    const sizeSet = new Map<string, string>();   // code -> normalized name
    const colorImages = new Map<string, string[]>();

    products.forEach(p => {
      // Normalize color name
      const normalizedColor = this.normalizeOptionValue(p.colorName);
      if (normalizedColor && !colorSet.has(p.colorCode)) {
        colorSet.set(p.colorCode, normalizedColor);

        // Collect images for this color
        const images: string[] = [];
        if (p.colorFrontImage) images.push(this.fullUrl(p.colorFrontImage));
        if (p.colorBackImage) images.push(this.fullUrl(p.colorBackImage));
        if (p.colorOnModelFrontImage) images.push(this.fullUrl(p.colorOnModelFrontImage));
        colorImages.set(p.colorCode, images);
      }

      // Normalize size name
      const normalizedSize = this.normalizeOptionValue(p.sizeName);
      if (normalizedSize && !sizeSet.has(p.sizeCode)) {
        sizeSet.set(p.sizeCode, normalizedSize);
      }
    });

    // Sort sizes logically
    const sizeOrder = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
    const sizes = Array.from(sizeSet.values()).sort((a, b) => {
      const aIdx = sizeOrder.indexOf(a.toUpperCase());
      const bIdx = sizeOrder.indexOf(b.toUpperCase());
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a.localeCompare(b);
    });

    const colors = Array.from(colorSet.values());

    // Create normalized products with consistent option values
    const normalizedProducts = products.map(p => ({
      ...p,
      normalizedColor: colorSet.get(p.colorCode) || this.normalizeOptionValue(p.colorName),
      normalizedSize: sizeSet.get(p.sizeCode) || this.normalizeOptionValue(p.sizeName),
      totalStock: p.warehouses?.reduce((s, w) => s + (w.qty || 0), 0) || p.qty || 0,
    }));

    return { colors, sizes, colorImages, normalizedProducts };
  }

  private normalizeOptionValue(value: string): string {
    if (!value) return "";
    // Trim whitespace and normalize to Title Case for consistency
    return value.trim();
  }

  private async createProductWithProductSet(
    admin: any,
    style: any,
    colors: string[],
    sizes: string[],
    products: Array<SSProduct & { normalizedColor: string; normalizedSize: string; totalStock: number }>
  ): Promise<{ productId: string; variantCount: number }> {

    // Use productSet mutation - creates product + options + variants atomically
    const mutation = `
      mutation productSet($input: ProductSetInput!) {
        productSet(input: $input) {
          product {
            id
            title
            variants(first: 250) {
              edges {
                node {
                  id
                  sku
                }
              }
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

    // Build variants array - MUST use exact same option values as productOptions
    const variants = products.map((p, idx) => ({
      position: idx + 1,
      sku: p.sku || `${style.partNumber}-${p.colorCode}-${p.sizeCode}`,
      price: (p.piecePrice || p.customerPrice || 0).toFixed(2),
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

    console.log(`[Importer] Building productSet input...`);
    console.log(`[Importer] - Title: ${style.title}`);
    console.log(`[Importer] - Colors: ${colors.slice(0, 5).join(", ")}${colors.length > 5 ? "..." : ""}`);
    console.log(`[Importer] - Sizes: ${sizes.join(", ")}`);
    console.log(`[Importer] - Variants: ${variants.length}`);

    const input = {
      title: style.title,
      descriptionHtml: this.buildDescription(style, products, colors, sizes),
      vendor: style.brandName,
      productType: style.baseCategory || "Apparel",
      status: "DRAFT",
      tags: [style.brandName, style.baseCategory, "SSActiveWear", `ss-${style.styleID}`].filter(Boolean),
      productOptions: [
        { name: "Color", position: 1, values: colors.map(c => ({ name: c })) },
        { name: "Size", position: 2, values: sizes.map(s => ({ name: s })) },
      ],
      variants,
    };

    console.log(`[Importer] Sending productSet mutation...`);

    try {
      const response = await admin.graphql(mutation, { variables: { input } });
      const json = await response.json();

      // Log full response for debugging
      if (json.errors) {
        console.error(`[Importer] GraphQL Errors:`, JSON.stringify(json.errors, null, 2));
        throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
      }

      if (json.data?.productSet?.userErrors?.length > 0) {
        const errors = json.data.productSet.userErrors;
        console.error(`[Importer] User Errors:`, JSON.stringify(errors, null, 2));

        // Try fallback method if productSet fails
        console.log(`[Importer] productSet failed, trying fallback method...`);
        return await this.fallbackCreate(admin, style, colors, sizes, products);
      }

      const product = json.data?.productSet?.product;
      if (!product) {
        console.error(`[Importer] No product returned`);
        throw new Error("No product returned from productSet");
      }

      const variantCount = product.variants?.edges?.length || 0;
      return { productId: product.id, variantCount };

    } catch (error: any) {
      console.error(`[Importer] productSet error:`, error.message);

      // Try fallback
      console.log(`[Importer] Trying fallback method...`);
      return await this.fallbackCreate(admin, style, colors, sizes, products);
    }
  }

  private async fallbackCreate(
    admin: any,
    style: any,
    colors: string[],
    sizes: string[],
    products: Array<SSProduct & { normalizedColor: string; normalizedSize: string; totalStock: number }>
  ): Promise<{ productId: string; variantCount: number }> {

    console.log(`[Importer] === FALLBACK METHOD ===`);

    // Step 1: Create basic product
    const createMutation = `
      mutation createProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            variants(first: 5) {
              edges {
                node {
                  id
                }
              }
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    console.log(`[Importer] Step 1: Creating base product...`);

    const createResponse = await admin.graphql(createMutation, {
      variables: {
        input: {
          title: style.title,
          descriptionHtml: this.buildDescription(style, products, colors, sizes),
          vendor: style.brandName,
          productType: style.baseCategory || "Apparel",
          status: "DRAFT",
          tags: ["SSActiveWear", `ss-${style.styleID}`],
        },
      },
    });

    const createJson = await createResponse.json();

    if (createJson.errors || createJson.data?.productCreate?.userErrors?.length > 0) {
      const err = createJson.errors || createJson.data.productCreate.userErrors;
      console.error(`[Importer] Create product failed:`, JSON.stringify(err));
      throw new Error(`Create product failed: ${JSON.stringify(err)}`);
    }

    const productId = createJson.data.productCreate.product.id;
    console.log(`[Importer] Base product created: ${productId}`);

    // Get default variant to delete later
    const defaultVariants = createJson.data.productCreate.product.variants.edges.map((e: any) => e.node.id);

    // Step 2: Create options with CREATE strategy (this creates all variant combinations)
    const optionsMutation = `
      mutation createOptions($productId: ID!, $options: [OptionCreateInput!]!) {
        productOptionsCreate(productId: $productId, options: $options, variantStrategy: CREATE) {
          product {
            id
            options {
              id
              name
              values
            }
            variants(first: 5) {
              edges {
                node {
                  id
                  title
                }
              }
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

    console.log(`[Importer] Step 2: Creating options (Color: ${colors.length}, Size: ${sizes.length})...`);

    const optionsResponse = await admin.graphql(optionsMutation, {
      variables: {
        productId,
        options: [
          { name: "Color", values: colors.map(c => ({ name: c })) },
          { name: "Size", values: sizes.map(s => ({ name: s })) },
        ],
      },
    });

    const optionsJson = await optionsResponse.json();

    if (optionsJson.errors) {
      console.error(`[Importer] Options creation GraphQL error:`, JSON.stringify(optionsJson.errors));
    }

    if (optionsJson.data?.productOptionsCreate?.userErrors?.length > 0) {
      console.error(`[Importer] Options creation user errors:`,
        JSON.stringify(optionsJson.data.productOptionsCreate.userErrors));
    }

    // Step 3: Get all created variants and update them with SKU, price, etc.
    console.log(`[Importer] Step 3: Fetching variants to update...`);

    let allVariants: Array<{ id: string; title: string; color?: string; size?: string }> = [];
    let cursor: string | null = null;

    do {
      const variantsQuery = `
        query getVariants($productId: ID!, $cursor: String) {
          product(id: $productId) {
            variants(first: 100, after: $cursor) {
              edges {
                node {
                  id
                  title
                  selectedOptions {
                    name
                    value
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

      const variantsResponse = await admin.graphql(variantsQuery, {
        variables: { productId, cursor }
      });
      const variantsJson = await variantsResponse.json();

      const edges = variantsJson.data?.product?.variants?.edges || [];
      for (const edge of edges) {
        const v = edge.node;
        const color = v.selectedOptions?.find((o: any) => o.name === "Color")?.value;
        const size = v.selectedOptions?.find((o: any) => o.name === "Size")?.value;
        allVariants.push({ id: v.id, title: v.title, color, size });
        cursor = edge.cursor;
      }

      if (!variantsJson.data?.product?.variants?.pageInfo?.hasNextPage) {
        cursor = null;
      }
    } while (cursor);

    console.log(`[Importer] Found ${allVariants.length} variants to update`);

    // Step 4: Update variants with SKU, price from SS data
    const updateMutation = `
      mutation updateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
            sku
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    // Build lookup map: "ColorName|SizeName" -> product data
    const productMap = new Map<string, typeof products[0]>();
    products.forEach(p => {
      const key = `${p.normalizedColor}|${p.normalizedSize}`;
      productMap.set(key, p);
    });

    let updatedCount = 0;

    // Update in batches
    for (let i = 0; i < allVariants.length; i += BATCH_SIZE) {
      const batch = allVariants.slice(i, i + BATCH_SIZE);

      const updates = batch.map(v => {
        const key = `${v.color}|${v.size}`;
        const productData = productMap.get(key);

        return {
          id: v.id,
          sku: productData?.sku || "",
          price: (productData?.piecePrice || 0).toFixed(2),
          compareAtPrice: productData?.mapPrice && productData.mapPrice > (productData.piecePrice || 0)
            ? productData.mapPrice.toFixed(2)
            : undefined,
          barcode: productData?.gtin || undefined,
        };
      }).filter(u => u.sku); // Only update variants with matching product data

      if (updates.length === 0) continue;

      try {
        const updateResponse = await admin.graphql(updateMutation, {
          variables: { productId, variants: updates },
        });

        const updateJson = await updateResponse.json();

        if (updateJson.data?.productVariantsBulkUpdate?.productVariants) {
          updatedCount += updateJson.data.productVariantsBulkUpdate.productVariants.length;
        }

        if (updateJson.data?.productVariantsBulkUpdate?.userErrors?.length > 0) {
          console.warn(`[Importer] Update batch errors:`,
            updateJson.data.productVariantsBulkUpdate.userErrors.slice(0, 2));
        }

        // Rate limit protection
        await this.delay(200);
      } catch (error) {
        console.error(`[Importer] Variant update batch error:`, error);
      }
    }

    console.log(`[Importer] Updated ${updatedCount} variants with SKU/price data`);

    return { productId, variantCount: updatedCount };
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

    console.log(`[Importer] Uploading ${allMedia.length} images...`);

    let totalAdded = 0;
    for (let i = 0; i < allMedia.length; i += 10) {
      const batch = allMedia.slice(i, i + 10);
      try {
        const response = await admin.graphql(mutation, { variables: { productId, media: batch } });
        const json = await response.json();
        totalAdded += json.data?.productCreateMedia?.media?.length || 0;
        await this.delay(500);
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

    // Get variants with inventory items
    const items: Array<{ inventoryItemId: string; quantity: number }> = [];
    let cursor: string | null = null;

    do {
      const query = `
        query($productId: ID!, $cursor: String) {
          product(id: $productId) {
            variants(first: 100, after: $cursor) {
              edges {
                node { sku, inventoryItem { id } }
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
          items.push({ inventoryItemId: inventoryItem.id, quantity: stockMap.get(sku)! });
        }
        cursor = edge.cursor;
      }

      if (!json.data?.product?.variants?.pageInfo?.hasNextPage) cursor = null;
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
      // Set status to ACTIVE
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

      console.log(`[Importer] Product published to Online Store`);
    } catch (error) {
      console.warn(`[Importer] Publish error:`, error);
    }
  }

  private buildDescription(
    style: any,
    products: SSProduct[],
    colors: string[],
    sizes: string[]
  ): string {
    const prices = products.filter(p => p.piecePrice > 0).map(p => p.piecePrice);
    const minPrice = prices.length ? Math.min(...prices).toFixed(2) : "0.00";
    const maxPrice = prices.length ? Math.max(...prices).toFixed(2) : "0.00";

    return `
<div class="product-description">
  ${style.description || ""}
  <h4>Product Details</h4>
  <ul>
    <li><strong>Brand:</strong> ${style.brandName}</li>
    <li><strong>Style:</strong> ${style.partNumber}</li>
    <li><strong>Colors:</strong> ${colors.length} options</li>
    <li><strong>Sizes:</strong> ${sizes.join(", ")}</li>
    <li><strong>Price:</strong> $${minPrice} - $${maxPrice}</li>
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
