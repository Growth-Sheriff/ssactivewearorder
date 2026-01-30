import prisma from "../db.server";
import { SSActiveWearClient, type SSProduct } from "./ssactivewear";

const ssClient = new SSActiveWearClient();
const VARIANT_BATCH_SIZE = 50;
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
    console.log(`[Importer] ========================================`);
    console.log(`[Importer] Starting import for style ${styleId}`);

    // 1. Fetch style details
    const styleDetails = await ssClient.getStyleDetails(styleId);
    if (!styleDetails || styleDetails.length === 0) {
      throw new Error(`Style ${styleId} not found`);
    }
    const style = styleDetails[0];
    console.log(`[Importer] Style: ${style.title}`);

    // 2. Fetch all products (variants)
    const products = await ssClient.getProducts(styleId);
    if (!products || products.length === 0) {
      throw new Error(`No products found for style ${styleId}`);
    }
    console.log(`[Importer] Total SKUs: ${products.length}`);

    // Log sample product data
    if (products.length > 0) {
      const sample = products[0];
      console.log(`[Importer] Sample SKU: ${sample.sku}`);
      console.log(`[Importer] Sample Color: ${sample.colorName}`);
      console.log(`[Importer] Sample Size: ${sample.sizeName}`);
      console.log(`[Importer] Sample Price: ${sample.piecePrice}`);
      console.log(`[Importer] Sample Stock: ${sample.warehouses?.reduce((s, w) => s + w.qty, 0) || sample.qty || 0}`);
    }

    // 3. Extract unique colors and sizes
    const colors = [...new Set(products.map(p => p.colorName).filter(Boolean))];
    const sizes = this.sortSizes([...new Set(products.map(p => p.sizeName).filter(Boolean))]);
    console.log(`[Importer] Colors: ${colors.length} - ${colors.slice(0, 5).join(', ')}...`);
    console.log(`[Importer] Sizes: ${sizes.length} - ${sizes.join(', ')}`);

    // 4. Collect color images
    const colorImages = new Map<string, string[]>();
    products.forEach(p => {
      if (!colorImages.has(p.colorCode)) {
        const imgs: string[] = [];
        if (p.colorFrontImage) imgs.push(this.fullUrl(p.colorFrontImage));
        if (p.colorBackImage) imgs.push(this.fullUrl(p.colorBackImage));
        if (p.colorOnModelFrontImage) imgs.push(this.fullUrl(p.colorOnModelFrontImage));
        colorImages.set(p.colorCode, imgs);
      }
    });

    // 5. Create product with options using productCreate
    const product = await this.createProductWithOptions(admin, style, colors, sizes, products);
    console.log(`[Importer] Product created: ${product.id}`);

    // 6. Create variants
    const variantCount = await this.createAllVariants(admin, product.id, products);
    console.log(`[Importer] Variants created: ${variantCount}`);

    // 7. Add images
    const imageCount = await this.uploadImages(admin, product.id, style, colorImages);
    console.log(`[Importer] Images added: ${imageCount}`);

    // 8. Update inventory
    await this.syncInventory(admin, product.id, products);

    // 9. Publish
    await this.activateProduct(admin, product.id);

    // 10. Save to DB
    const productMap = await prisma.productMap.create({
      data: {
        shopifyProductId: product.id,
        ssStyleId: String(style.styleID),
      },
    });

    console.log(`[Importer] ✅ Complete: ${variantCount} variants, ${imageCount} images`);

    return {
      productMap,
      shopifyProduct: product,
      variantCount,
      imageCount,
      message: `Imported ${style.title}: ${variantCount} variants, ${imageCount} images`,
    };
  }

  private async createProductWithOptions(
    admin: any,
    style: any,
    colors: string[],
    sizes: string[],
    products: SSProduct[]
  ) {
    // Use productCreate - simpler and more reliable
    const mutation = `
      mutation CreateProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            handle
            options {
              id
              name
            }
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const description = this.buildDescription(style, products, colors, sizes);

    const input: any = {
      title: style.title,
      descriptionHtml: description,
      vendor: style.brandName,
      productType: style.baseCategory || "Apparel",
      status: "DRAFT",
      tags: [style.brandName, style.baseCategory, "SSActiveWear", `ss-${style.styleID}`].filter(Boolean),
    };

    console.log(`[Importer] Creating base product...`);

    const response = await admin.graphql(mutation, { variables: { input } });
    const json = await response.json();

    if (json.errors) {
      console.error(`[Importer] productCreate errors:`, JSON.stringify(json.errors));
      throw new Error(`productCreate failed: ${JSON.stringify(json.errors)}`);
    }

    if (json.data?.productCreate?.userErrors?.length > 0) {
      console.error(`[Importer] productCreate userErrors:`, JSON.stringify(json.data.productCreate.userErrors));
      throw new Error(`productCreate failed: ${JSON.stringify(json.data.productCreate.userErrors)}`);
    }

    const product = json.data.productCreate.product;
    if (!product) {
      throw new Error("productCreate returned no product");
    }

    // Now add options
    console.log(`[Importer] Adding options...`);
    await this.addOptions(admin, product.id, colors, sizes);

    return product;
  }

  private async addOptions(admin: any, productId: string, colors: string[], sizes: string[]) {
    const mutation = `
      mutation AddOptions($productId: ID!, $options: [OptionCreateInput!]!) {
        productOptionsCreate(productId: $productId, options: $options, variantStrategy: LEAVE_AS_IS) {
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

    try {
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

      if (json.data?.productOptionsCreate?.userErrors?.length > 0) {
        console.warn(`[Importer] Options warnings:`, json.data.productOptionsCreate.userErrors);
      }

      console.log(`[Importer] Options added successfully`);
    } catch (error) {
      console.error(`[Importer] Failed to add options:`, error);
      throw error;
    }
  }

  private async createAllVariants(admin: any, productId: string, products: SSProduct[]): Promise<number> {
    // First, delete the default variant
    await this.deleteDefaultVariant(admin, productId);

    const mutation = `
      mutation BulkCreateVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
          productVariants {
            id
            sku
            price
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
    const batches = Math.ceil(limitedProducts.length / VARIANT_BATCH_SIZE);

    console.log(`[Importer] Creating ${limitedProducts.length} variants in ${batches} batches...`);

    for (let i = 0; i < limitedProducts.length; i += VARIANT_BATCH_SIZE) {
      const batchNum = Math.floor(i / VARIANT_BATCH_SIZE) + 1;
      const batch = limitedProducts.slice(i, i + VARIANT_BATCH_SIZE);

      const variants = batch.map(p => {
        const price = p.piecePrice || p.customerPrice || 0;
        return {
          sku: p.sku,
          price: price.toFixed(2),
          compareAtPrice: p.mapPrice && p.mapPrice > price ? p.mapPrice.toFixed(2) : null,
          barcode: p.gtin || null,
          optionValues: [
            { optionName: "Color", name: p.colorName },
            { optionName: "Size", name: p.sizeName },
          ],
          inventoryPolicy: "DENY",
        };
      });

      try {
        console.log(`[Importer] Batch ${batchNum}/${batches}: ${batch.length} variants`);

        const response = await admin.graphql(mutation, {
          variables: { productId, variants },
        });

        const json = await response.json();

        if (json.errors) {
          console.error(`[Importer] Batch ${batchNum} GraphQL errors:`, JSON.stringify(json.errors).slice(0, 500));
          continue;
        }

        if (json.data?.productVariantsBulkCreate?.userErrors?.length > 0) {
          const errors = json.data.productVariantsBulkCreate.userErrors;
          console.warn(`[Importer] Batch ${batchNum} warnings:`, JSON.stringify(errors.slice(0, 3)));
        }

        const created = json.data?.productVariantsBulkCreate?.productVariants?.length || 0;
        totalCreated += created;
        console.log(`[Importer] Batch ${batchNum} created: ${created} variants`);

        // Delay to avoid rate limits
        if (i + VARIANT_BATCH_SIZE < limitedProducts.length) {
          await this.delay(300);
        }
      } catch (error: any) {
        console.error(`[Importer] Batch ${batchNum} error:`, error.message || error);
      }
    }

    return totalCreated;
  }

  private async deleteDefaultVariant(admin: any, productId: string) {
    try {
      const query = `
        query GetVariants($productId: ID!) {
          product(id: $productId) {
            variants(first: 5) {
              edges {
                node {
                  id
                  title
                }
              }
            }
          }
        }
      `;

      const response = await admin.graphql(query, { variables: { productId } });
      const json = await response.json();

      const variants = json.data?.product?.variants?.edges || [];
      if (variants.length === 0) return;

      // Delete all variants (will be recreated)
      const variantIds = variants.map((v: any) => v.node.id);

      const deleteMutation = `
        mutation DeleteVariants($productId: ID!, $variantsIds: [ID!]!) {
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
    } catch (error) {
      console.log(`[Importer] Could not delete default variant:`, error);
    }
  }

  private async uploadImages(
    admin: any,
    productId: string,
    style: any,
    colorImages: Map<string, string[]>
  ): Promise<number> {
    const mutation = `
      mutation AddMedia($productId: ID!, $media: [CreateMediaInput!]!) {
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

    const allMedia: any[] = [];
    const addedUrls = new Set<string>();

    // Main image
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
        const response = await admin.graphql(mutation, {
          variables: { productId, media: batch },
        });

        const json = await response.json();
        totalAdded += json.data?.productCreateMedia?.media?.length || 0;

        if (i + 10 < allMedia.length) await this.delay(500);
      } catch (error) {
        console.error(`[Importer] Image batch error:`, error);
      }
    }

    return totalAdded;
  }

  private async syncInventory(admin: any, productId: string, products: SSProduct[]) {
    // Get location
    const locResponse = await admin.graphql(`query { locations(first: 1) { edges { node { id } } } }`);
    const locJson = await locResponse.json();
    const locationId = locJson.data?.locations?.edges?.[0]?.node?.id;

    if (!locationId) {
      console.log(`[Importer] No location found, skipping inventory`);
      return;
    }

    console.log(`[Importer] Location: ${locationId}`);

    // Build SKU -> stock map
    const stockMap = new Map<string, number>();
    products.forEach(p => {
      const qty = p.warehouses?.reduce((sum, w) => sum + (w.qty || 0), 0) || p.qty || 0;
      stockMap.set(p.sku, qty);
    });

    // Get all variants with inventory items
    let cursor: string | null = null;
    const inventoryItems: { inventoryItemId: string; quantity: number }[] = [];

    do {
      const query = `
        query GetInventory($productId: ID!, $cursor: String) {
          product(id: $productId) {
            variants(first: 100, after: $cursor) {
              edges {
                node {
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

      const response = await admin.graphql(query, { variables: { productId, cursor } });
      const json = await response.json();

      const edges = json.data?.product?.variants?.edges || [];
      for (const { node, cursor: c } of edges) {
        if (node.sku && node.inventoryItem?.id && stockMap.has(node.sku)) {
          inventoryItems.push({
            inventoryItemId: node.inventoryItem.id,
            quantity: stockMap.get(node.sku)!,
          });
        }
        cursor = c;
      }

      if (!json.data?.product?.variants?.pageInfo?.hasNextPage) {
        cursor = null;
      }
    } while (cursor);

    console.log(`[Importer] Updating inventory for ${inventoryItems.length} items...`);

    // Update in batches
    const inventoryMutation = `
      mutation SetInventory($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    for (let i = 0; i < inventoryItems.length; i += 20) {
      const batch = inventoryItems.slice(i, i + 20);

      try {
        await admin.graphql(inventoryMutation, {
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
      } catch (error) {
        console.warn(`[Importer] Inventory batch error:`, error);
      }

      if (i + 20 < inventoryItems.length) await this.delay(100);
    }

    console.log(`[Importer] Inventory updated`);
  }

  private async activateProduct(admin: any, productId: string) {
    try {
      await admin.graphql(`
        mutation Activate($input: ProductInput!) {
          productUpdate(input: $input) {
            userErrors { field message }
          }
        }
      `, {
        variables: { input: { id: productId, status: "ACTIVE" } },
      });

      // Publish to online store
      const pubResponse = await admin.graphql(`
        query { publications(first: 10) { edges { node { id name } } } }
      `);
      const pubJson = await pubResponse.json();

      const onlineStore = pubJson.data?.publications?.edges?.find((e: any) =>
        e.node.name === "Online Store"
      );

      if (onlineStore) {
        await admin.graphql(`
          mutation Publish($id: ID!, $input: [PublicationInput!]!) {
            publishablePublish(id: $id, input: $input) {
              userErrors { field message }
            }
          }
        `, {
          variables: { id: productId, input: [{ publicationId: onlineStore.node.id }] },
        });
      }

      console.log(`[Importer] Product activated and published`);
    } catch (error) {
      console.warn(`[Importer] Publish error:`, error);
    }
  }

  private buildDescription(style: any, products: SSProduct[], colors: string[], sizes: string[]): string {
    const prices = products.filter(p => p.piecePrice > 0).map(p => p.piecePrice);
    const minPrice = prices.length ? Math.min(...prices).toFixed(2) : "0.00";
    const maxPrice = prices.length ? Math.max(...prices).toFixed(2) : "0.00";
    const totalStock = products.reduce((sum, p) => {
      return sum + (p.warehouses?.reduce((s, w) => s + w.qty, 0) || p.qty || 0);
    }, 0);

    return `
<div class="product-description">
  ${style.description || ""}
  <h4>Product Details</h4>
  <ul>
    <li><strong>Brand:</strong> ${style.brandName}</li>
    <li><strong>Style:</strong> ${style.partNumber}</li>
    <li><strong>Colors:</strong> ${colors.length} available</li>
    <li><strong>Sizes:</strong> ${sizes.join(", ")}</li>
    <li><strong>Price:</strong> $${minPrice} - $${maxPrice}</li>
    <li><strong>Total Stock:</strong> ${totalStock.toLocaleString()} units</li>
  </ul>
  <p><small>SSActiveWear Style ID: ${style.styleID}</small></p>
</div>`.trim();
  }

  private sortSizes(sizes: string[]): string[] {
    const order = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', '6XL'];
    return sizes.sort((a, b) => {
      const aIdx = order.indexOf(a);
      const bIdx = order.indexOf(b);
      if (aIdx >= 0 && bIdx >= 0) return aIdx - bIdx;
      if (aIdx >= 0) return -1;
      if (bIdx >= 0) return 1;
      return a.localeCompare(b);
    });
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
