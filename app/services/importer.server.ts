import prisma from "../db.server";
import { SSActiveWearClient, type SSProduct } from "./ssactivewear";

const ssClient = new SSActiveWearClient();
const MAX_VARIANTS = 2000;
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
    console.log(`[Importer] Starting import for style ${styleId}`);

    // 1. Fetch data from SSActiveWear
    const styleDetails = await ssClient.getStyleDetails(styleId);
    if (!styleDetails?.length) throw new Error(`Style ${styleId} not found`);
    const style = styleDetails[0];

    const products = await ssClient.getProducts(styleId);
    if (!products?.length) throw new Error(`No products found for style ${styleId}`);

    console.log(`[Importer] "${style.title}" - ${products.length} SKUs`);

    // 2. Prepare data
    const { normalizedProducts, uniqueColors, uniqueSizes, colorImages } = this.prepareData(products);
    console.log(`[Importer] ${uniqueColors.length} colors, ${uniqueSizes.length} sizes, ${normalizedProducts.length} variants`);

    // 3. Create product with variants using productSet
    const result = await this.createProductWithVariants(admin, style, normalizedProducts, uniqueColors, uniqueSizes);
    const productId = result.productId;
    const variantCount = result.variantCount;

    console.log(`[Importer] Product created: ${productId}, Variants: ${variantCount}`);

    // 4. Add images
    const imageCount = await this.addImages(admin, productId, style, colorImages);

    // 5. Update inventory
    await this.updateInventory(admin, productId, normalizedProducts);

    // 6. Publish
    await this.publishProduct(admin, productId);

    // 7. Save to DB
    const productMap = await prisma.productMap.create({
      data: {
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

    // Sort sizes
    const sizeOrder = ['xxs', 'xs', 's', 'm', 'l', 'xl', '2xl', '3xl', '4xl', '5xl'];
    const sortedSizes = Array.from(sizeMap.entries()).sort((a, b) => {
      const aIdx = sizeOrder.indexOf(a[0]);
      const bIdx = sizeOrder.indexOf(b[0]);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      return a[0].localeCompare(b[0]);
    });

    const uniqueColors = Array.from(colorMap.values());
    const uniqueSizes = sortedSizes.map(([, v]) => v);

    // Deduplicate and normalize products
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

    const normalizedProducts = deduplicatedProducts.slice(0, MAX_VARIANTS);
    return { normalizedProducts, uniqueColors, uniqueSizes, colorImages };
  }

  private async createProductWithVariants(
    admin: any,
    style: any,
    products: any[],
    colors: string[],
    sizes: string[]
  ): Promise<{ productId: string; variantCount: number }> {

    // Build variants for productSet mutation
    // ProductVariantSetInput has 'sku' as direct field!
    const variants = products.map(p => ({
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

    const mutation = `
      mutation productSet($input: ProductSetInput!, $synchronous: Boolean!) {
        productSet(synchronous: $synchronous, input: $input) {
          product {
            id
            variants(first: 1) {
              nodes { id }
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

    const input = {
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
      variants: variants,
    };

    const response = await admin.graphql(mutation, {
      variables: { input, synchronous: true },
    });

    const json = await response.json();

    if (json.errors) {
      console.error(`[Importer] GraphQL errors:`, JSON.stringify(json.errors).slice(0, 500));
      throw new Error(`productSet failed: GraphQL errors`);
    }

    if (json.data?.productSet?.userErrors?.length > 0) {
      const errors = json.data.productSet.userErrors;
      console.error(`[Importer] userErrors:`, JSON.stringify(errors.slice(0, 5)));
      throw new Error(`productSet failed: ${errors[0].message}`);
    }

    const productId = json.data?.productSet?.product?.id;
    if (!productId) {
      throw new Error("No product ID returned from productSet");
    }

    // Get actual variant count
    const countResponse = await admin.graphql(`
      query getVariantCount($id: ID!) {
        product(id: $id) {
          variantsCount { count }
        }
      }
    `, { variables: { id: productId } });

    const countJson = await countResponse.json();
    const variantCount = countJson.data?.product?.variantsCount?.count || products.length;

    return { productId, variantCount };
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
          media { ... on MediaImage { id } }
          mediaUserErrors { message }
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
        // Continue with other batches
      }
    }

    return totalAdded;
  }

  private async updateInventory(admin: any, productId: string, products: any[]) {
    // Get location
    const locResponse = await admin.graphql(`query { locations(first: 1) { edges { node { id } } } }`);
    const locJson = await locResponse.json();
    const locationId = locJson.data?.locations?.edges?.[0]?.node?.id;
    if (!locationId) return;

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
                node { sku inventoryItem { id } }
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

    // Update in batches
    for (let i = 0; i < items.length; i += 20) {
      const batch = items.slice(i, i + 20);
      try {
        await admin.graphql(`
          mutation($input: InventorySetQuantitiesInput!) {
            inventorySetQuantities(input: $input) { userErrors { message } }
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
        // Continue
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
    } catch (error) {
      // Non-critical
    }
  }

  private buildDescription(style: any, products: any[]): string {
    const uniqueColors = [...new Set(products.map((p: any) => p.normalizedColor))];
    const uniqueSizes = [...new Set(products.map((p: any) => p.normalizedSize))];
    const prices = products.filter((p: any) => p.piecePrice > 0).map((p: any) => p.piecePrice);
    const minPrice = prices.length ? Math.min(...prices).toFixed(2) : "0.00";
    const maxPrice = prices.length ? Math.max(...prices).toFixed(2) : "0.00";

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
  </ul>
</div>`.trim();
  }

  private normalize(value: string): string {
    if (!value) return "";
    return value.trim().toLowerCase().replace(/\s+/g, " ");
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
