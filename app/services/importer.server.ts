import prisma from "../db.server";
import { SSActiveWearClient } from "./ssactivewear";

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

    // 3. Get unique colors and their images
    const colorImages = new Map<string, { color: string; image: string }>();
    products.forEach((product) => {
      if (!colorImages.has(product.colorCode)) {
        const imageUrl = this.getFullImageUrl(
          product.colorFrontImage ||
          product.colorOnModelFrontImage ||
          product.colorSwatchImage
        );
        colorImages.set(product.colorCode, {
          color: product.colorName,
          image: imageUrl,
        });
      }
    });
    console.log(`[Importer] Found ${colorImages.size} unique colors`);

    // 4. Build variants for Shopify (limit to 100 due to API limits)
    const limitedProducts = products.slice(0, 100);
    const variants = limitedProducts.map((product) => ({
      sku: product.sku,
      price: String(product.piecePrice || 0),
      options: [product.colorName, product.sizeName],
    }));

    // 5. Get main product image
    const mainImage = this.getFullImageUrl(style.styleImage);

    // 6. Create Product in Shopify - simple approach
    const createProductMutation = `
      mutation productCreate($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            handle
            title
            variants(first: 100) {
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
          }
        }
      }
    `;

    const productInput: any = {
      title: style.title,
      descriptionHtml: style.description || "",
      vendor: style.brandName,
      productType: style.baseCategory,
      status: "ACTIVE",
      tags: [style.baseCategory || "Apparel", "SSActiveWear", `ss-style-${styleId}`],
      options: ["Color", "Size"],
      variants: variants,
    };

    console.log(`[Importer] Creating product with ${variants.length} variants...`);

    try {
      const response = await admin.graphql(createProductMutation, {
        variables: { input: productInput },
      });
      const responseJson = await response.json();

      // Check for errors
      if (responseJson.errors) {
        console.error("[Importer] GraphQL errors:", responseJson.errors);
        throw new Error(JSON.stringify(responseJson.errors));
      }

      if (responseJson.data?.productCreate?.userErrors?.length > 0) {
        console.error("[Importer] User errors:", responseJson.data.productCreate.userErrors);
        throw new Error(JSON.stringify(responseJson.data.productCreate.userErrors));
      }

      const shopifyProduct = responseJson.data?.productCreate?.product;
      if (!shopifyProduct) {
        throw new Error("Product creation returned no product");
      }

      console.log(`[Importer] Product created: ${shopifyProduct.id}`);

      // 7. Add product images
      await this.addProductImages(admin, shopifyProduct.id, mainImage, colorImages);

      // 8. Save Mapping to DB
      const productMap = await prisma.productMap.create({
        data: {
          shopifyProductId: shopifyProduct.id,
          ssStyleId: String(style.styleID),
        },
      });

      const variantCount = shopifyProduct.variants?.edges?.length || variants.length;
      console.log(`[Importer] Import complete! Created ${variantCount} variants`);

      return {
        productMap,
        shopifyProduct,
        variantCount,
        message: `Successfully imported ${style.title} with ${variantCount} variants`,
      };

    } catch (error: any) {
      console.error("[Importer] Error creating product:", error.message || error);
      throw error;
    }
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

  // Add images to the product
  private async addProductImages(
    admin: any,
    productId: string,
    mainImage: string,
    colorImages: Map<string, { color: string; image: string }>
  ) {
    if (!mainImage && colorImages.size === 0) {
      console.log("[Importer] No images to add");
      return;
    }

    const mediaInputs: any[] = [];

    // Add main image first
    if (mainImage) {
      mediaInputs.push({
        alt: "Main product image",
        mediaContentType: "IMAGE",
        originalSource: mainImage,
      });
    }

    // Add color images (limit to prevent timeout)
    let count = 0;
    for (const [_, colorData] of colorImages) {
      if (count >= 10) break; // Limit to 10 color images
      if (colorData.image && colorData.image !== mainImage) {
        mediaInputs.push({
          alt: colorData.color,
          mediaContentType: "IMAGE",
          originalSource: colorData.image,
        });
        count++;
      }
    }

    if (mediaInputs.length === 0) {
      console.log("[Importer] No valid images to add");
      return;
    }

    console.log(`[Importer] Adding ${mediaInputs.length} images...`);

    const addMediaMutation = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media {
            ... on MediaImage {
              id
              alt
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
      const response = await admin.graphql(addMediaMutation, {
        variables: {
          productId,
          media: mediaInputs,
        },
      });
      const responseJson = await response.json();

      if (responseJson.data?.productCreateMedia?.mediaUserErrors?.length > 0) {
        console.warn("[Importer] Media errors:", responseJson.data.productCreateMedia.mediaUserErrors);
      } else {
        console.log(`[Importer] Successfully added ${mediaInputs.length} images`);
      }
    } catch (error) {
      console.error("[Importer] Failed to add images:", error);
      // Don't throw - images are optional
    }
  }
}
