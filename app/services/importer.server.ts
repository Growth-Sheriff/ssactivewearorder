import prisma from "../db.server";
import { SSActiveWearClient } from "./ssactivewear";

const ssClient = new SSActiveWearClient();

export class ImporterService {
  async importStyle(admin: any, styleId: number) {
    // 1. Fetch full details from SSActiveWear
    const styleDetails = await ssClient.getStyleDetails(styleId);
    if (!styleDetails || styleDetails.length === 0) {
      throw new Error(`Style ${styleId} not found`);
    }
    const style = styleDetails[0];

    // 2. Fetch ALL products (variants) for this style
    const products = await ssClient.getProducts(styleId);
    if (!products || products.length === 0) {
      throw new Error(`No products found for style ${styleId}`);
    }

    console.log(`[Importer] Found ${products.length} variants for style ${styleId}`);

    // 3. Group products by color to create proper variants
    const colorMap = new Map<string, typeof products>();
    const allSizes = new Set<string>();

    products.forEach((product) => {
      const colorKey = product.colorCode;
      if (!colorMap.has(colorKey)) {
        colorMap.set(colorKey, []);
      }
      colorMap.get(colorKey)!.push(product);
      allSizes.add(product.sizeName);
    });

    const colors = Array.from(colorMap.keys());
    const sizes = Array.from(allSizes);

    console.log(`[Importer] Colors: ${colors.length}, Sizes: ${sizes.length}`);

    // 4. Prepare media (images) from first product of each color
    const mediaInputs: any[] = [];
    const colorToMediaMap = new Map<string, number>();

    colorMap.forEach((colorProducts, colorCode) => {
      const firstProduct = colorProducts[0];
      // Use the best quality image available
      const imageUrl = firstProduct.colorFrontImage ||
                       firstProduct.colorOnModelFrontImage ||
                       firstProduct.colorSwatchImage;

      if (imageUrl) {
        const mediaIndex = mediaInputs.length;
        colorToMediaMap.set(colorCode, mediaIndex);
        mediaInputs.push({
          alt: `${firstProduct.colorName}`,
          mediaContentType: "IMAGE",
          originalSource: imageUrl,
        });
      }
    });

    // 5. Create variants array for Shopify
    const variantsInputs = products.map((product) => {
      // Calculate total stock from all warehouses
      const totalQty = product.warehouses?.reduce((sum, w) => sum + (w.qty || 0), 0) || product.qty || 0;

      return {
        optionValues: [
          { name: product.colorName, optionName: "Color" },
          { name: product.sizeName, optionName: "Size" },
        ],
        sku: product.sku,
        price: String(product.piecePrice || 0),
        inventoryQuantities: [{
          availableQuantity: totalQty,
          locationId: "gid://shopify/Location/current", // Will use default location
        }],
        mediaId: colorToMediaMap.has(product.colorCode)
          ? `MEDIA_${colorToMediaMap.get(product.colorCode)}`
          : undefined,
      };
    });

    // 6. Create Product with Variants using productSet mutation (newer API)
    const createProductMutation = `
      mutation productCreate($input: ProductInput!, $media: [CreateMediaInput!]) {
        productCreate(input: $input, media: $media) {
          product {
            id
            handle
            variants(first: 250) {
              edges {
                node {
                  id
                  sku
                  selectedOptions {
                    name
                    value
                  }
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

    // Build product input
    const productInput = {
      title: style.title,
      descriptionHtml: style.description,
      vendor: style.brandName,
      productType: style.baseCategory,
      status: "ACTIVE",
      tags: [style.baseCategory, "SSActiveWear", `ss-style-${styleId}`],
      options: ["Color", "Size"],
      variants: products.slice(0, 100).map((product) => {
        const totalQty = product.warehouses?.reduce((sum, w) => sum + (w.qty || 0), 0) || product.qty || 0;
        return {
          sku: product.sku,
          price: String(product.piecePrice || 0),
          options: [product.colorName, product.sizeName],
          inventoryPolicy: "DENY",
          inventoryManagement: "SHOPIFY",
        };
      }),
    };

    console.log(`[Importer] Creating product with ${productInput.variants.length} variants...`);

    try {
      const response = await admin.graphql(createProductMutation, {
        variables: {
          input: productInput,
          media: mediaInputs.length > 0 ? mediaInputs : null,
        },
      });
      const responseJson = await response.json();

      if (responseJson.data?.productCreate?.userErrors?.length > 0) {
        console.error("[Importer] User errors:", responseJson.data.productCreate.userErrors);
        throw new Error(JSON.stringify(responseJson.data.productCreate.userErrors));
      }

      const shopifyProduct = responseJson.data?.productCreate?.product;
      if (!shopifyProduct) {
        throw new Error("Product creation returned no product");
      }

      console.log(`[Importer] Product created: ${shopifyProduct.id}`);

      // 7. Save Mapping to DB
      const productMap = await prisma.productMap.create({
        data: {
          shopifyProductId: shopifyProduct.id,
          ssStyleId: String(style.styleID),
        },
      });

      // 8. Update inventory for each variant
      const variants = shopifyProduct.variants?.edges || [];
      console.log(`[Importer] Updating inventory for ${variants.length} variants...`);

      for (const { node: variant } of variants) {
        const matchingProduct = products.find(p => p.sku === variant.sku);
        if (matchingProduct) {
          const totalQty = matchingProduct.warehouses?.reduce((sum, w) => sum + (w.qty || 0), 0) || matchingProduct.qty || 0;

          // We'll set inventory later via inventory API if needed
          // For now, log what we would set
          console.log(`[Importer] Variant ${variant.sku}: ${totalQty} units`);
        }
      }

      return {
        productMap,
        shopifyProduct,
        variantCount: variants.length,
        message: `Successfully imported ${style.title} with ${variants.length} variants`,
      };

    } catch (error: any) {
      console.error("[Importer] Error creating product:", error);
      throw error;
    }
  }

  // Update variant images after product creation
  async updateVariantImages(admin: any, productId: string, styleId: number) {
    const products = await ssClient.getProducts(styleId);

    // Group by color and get first product's image for each color
    const colorImages = new Map<string, string>();
    products.forEach(product => {
      if (!colorImages.has(product.colorCode)) {
        const imageUrl = product.colorFrontImage || product.colorOnModelFrontImage;
        if (imageUrl) {
          colorImages.set(product.colorCode, imageUrl);
        }
      }
    });

    console.log(`[Importer] Found ${colorImages.size} color images to upload`);

    // Upload images to product
    for (const [colorCode, imageUrl] of colorImages) {
      try {
        const uploadMutation = `
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

        await admin.graphql(uploadMutation, {
          variables: {
            productId,
            media: [{
              alt: colorCode,
              mediaContentType: "IMAGE",
              originalSource: imageUrl,
            }],
          },
        });
      } catch (error) {
        console.error(`[Importer] Failed to upload image for color ${colorCode}:`, error);
      }
    }
  }
}
