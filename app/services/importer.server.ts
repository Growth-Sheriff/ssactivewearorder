import prisma from "../db.server";
import { SSActiveWearClient, type SSProduct } from "./ssactivewear";

const ssClient = new SSActiveWearClient();

export class ImporterService {
  async importStyle(admin: any, styleId: number) {
    console.log(`[Importer] Starting import for style ${styleId}...`);

    // 1. Fetch full details from SSActiveWear
    const styleDetails = await ssClient.getStyleDetails(styleId);
    if (!styleDetails || styleDetails.length === 0) {
      throw new Error(`Style ${styleId} not found`);
    }
    const style = styleDetails[0];
    console.log(`[Importer] Found style: ${style.title}`);

    // 2. Fetch ALL products (variants) for this style
    const products = await ssClient.getProducts(styleId);
    if (!products || products.length === 0) {
      throw new Error(`No products found for style ${styleId}`);
    }
    console.log(`[Importer] Found ${products.length} variants`);

    // 3. Get unique colors and sizes
    const uniqueColors = [...new Set(products.map(p => p.colorName))];
    const uniqueSizes = [...new Set(products.map(p => p.sizeName))];
    console.log(`[Importer] Colors: ${uniqueColors.length}, Sizes: ${uniqueSizes.length}`);

    // 4. Get main product image
    const mainImage = this.getFullImageUrl(style.styleImage);

    // 5. Create Product WITHOUT variants first (simpler approach)
    const createProductMutation = `
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

    const productInput = {
      title: style.title,
      descriptionHtml: style.description || "",
      vendor: style.brandName,
      productType: style.baseCategory || "Apparel",
      status: "ACTIVE",
      tags: [style.baseCategory || "Apparel", "SSActiveWear", `ss-style-${styleId}`],
    };

    console.log(`[Importer] Creating base product...`);

    try {
      const response = await admin.graphql(createProductMutation, {
        variables: { input: productInput },
      });
      const responseJson = await response.json();

      // Check for errors
      if (responseJson.errors) {
        console.error("[Importer] GraphQL errors:", JSON.stringify(responseJson.errors));
        throw new Error(JSON.stringify(responseJson.errors));
      }

      if (responseJson.data?.productCreate?.userErrors?.length > 0) {
        console.error("[Importer] User errors:", JSON.stringify(responseJson.data.productCreate.userErrors));
        throw new Error(JSON.stringify(responseJson.data.productCreate.userErrors));
      }

      const shopifyProduct = responseJson.data?.productCreate?.product;
      if (!shopifyProduct) {
        throw new Error("Product creation returned no product");
      }

      console.log(`[Importer] Base product created: ${shopifyProduct.id}`);

      // 6. Now create variants using productVariantsBulkCreate
      const variantCount = await this.createVariants(admin, shopifyProduct.id, products, uniqueColors, uniqueSizes);

      // 7. Add product image
      if (mainImage) {
        await this.addProductImage(admin, shopifyProduct.id, mainImage);
      }

      // 8. Save Mapping to DB
      const productMap = await prisma.productMap.create({
        data: {
          shopifyProductId: shopifyProduct.id,
          ssStyleId: String(style.styleID),
        },
      });

      console.log(`[Importer] Import complete! Created ${variantCount} variants`);

      return {
        productMap,
        shopifyProduct,
        variantCount,
        message: `Successfully imported ${style.title} with ${variantCount} variants`,
      };

    } catch (error: any) {
      console.error("[Importer] Error:", error.message || error);
      throw error;
    }
  }

  // Create variants using bulk mutation
  private async createVariants(
    admin: any,
    productId: string,
    products: SSProduct[],
    colors: string[],
    sizes: string[]
  ): Promise<number> {
    // First, create product options
    const optionsMutation = `
      mutation productOptionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
        productOptionsCreate(productId: $productId, options: $options) {
          userErrors {
            field
            message
          }
          product {
            options {
              id
              name
              values
            }
          }
        }
      }
    `;

    try {
      await admin.graphql(optionsMutation, {
        variables: {
          productId,
          options: [
            { name: "Color", values: colors.map(c => ({ name: c })) },
            { name: "Size", values: sizes.map(s => ({ name: s })) },
          ],
        },
      });
      console.log(`[Importer] Options created`);
    } catch (error) {
      console.error("[Importer] Failed to create options:", error);
    }

    // Then create variants in batches
    const variantMutation = `
      mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkCreate(productId: $productId, variants: $variants) {
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

    let createdCount = 0;
    const batchSize = 50; // Shopify limit

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);

      const variants = batch.map(product => ({
        sku: product.sku,
        price: String(product.piecePrice || 0),
        optionValues: [
          { optionName: "Color", name: product.colorName },
          { optionName: "Size", name: product.sizeName },
        ],
      }));

      try {
        const response = await admin.graphql(variantMutation, {
          variables: {
            productId,
            variants,
          },
        });
        const json = await response.json();

        if (json.data?.productVariantsBulkCreate?.productVariants) {
          createdCount += json.data.productVariantsBulkCreate.productVariants.length;
        }

        if (json.data?.productVariantsBulkCreate?.userErrors?.length > 0) {
          console.warn("[Importer] Variant errors:", json.data.productVariantsBulkCreate.userErrors);
        }
      } catch (error) {
        console.error(`[Importer] Batch ${i / batchSize + 1} failed:`, error);
      }
    }

    console.log(`[Importer] Created ${createdCount} variants`);
    return createdCount;
  }

  // Get full SSActiveWear image URL
  private getFullImageUrl(imagePath: string | undefined): string {
    if (!imagePath) return "";

    // If already a full URL, return as-is
    if (imagePath.startsWith("http")) {
      return imagePath;
    }

    // Build full SSActiveWear URL
    return `https://www.ssactivewear.com/${imagePath}`;
  }

  // Add main image to product
  private async addProductImage(admin: any, productId: string, imageUrl: string) {
    if (!imageUrl) return;

    const addMediaMutation = `
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

    try {
      await admin.graphql(addMediaMutation, {
        variables: {
          productId,
          media: [{
            alt: "Product Image",
            mediaContentType: "IMAGE",
            originalSource: imageUrl,
          }],
        },
      });
      console.log(`[Importer] Added product image`);
    } catch (error) {
      console.error("[Importer] Failed to add image:", error);
    }
  }
}
