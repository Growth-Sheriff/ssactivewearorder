import prisma from "../db.server";
import { SSActiveWearClient, type SSProduct } from "./ssactivewear";

const ssClient = new SSActiveWearClient();

export class ImporterService {
  async importStyle(admin: any, styleId: number) {
    console.log(`[Importer] Starting full import for style ${styleId}...`);

    // 1. Fetch style details
    const styleDetails = await ssClient.getStyleDetails(styleId);
    if (!styleDetails || styleDetails.length === 0) {
      throw new Error(`Style ${styleId} not found`);
    }
    const style = styleDetails[0];
    console.log(`[Importer] Style: ${style.title}`);

    // 2. Fetch ALL products (variants) with full data
    const products = await ssClient.getProducts(styleId);
    if (!products || products.length === 0) {
      throw new Error(`No products found for style ${styleId}`);
    }
    console.log(`[Importer] Found ${products.length} SKUs`);

    // 3. Prepare color images map
    const colorImages = new Map<string, string[]>();
    products.forEach(p => {
      if (!colorImages.has(p.colorCode)) {
        const images: string[] = [];
        if (p.colorFrontImage) images.push(this.getFullImageUrl(p.colorFrontImage));
        if (p.colorBackImage) images.push(this.getFullImageUrl(p.colorBackImage));
        if (p.colorSideImage) images.push(this.getFullImageUrl(p.colorSideImage));
        if (p.colorOnModelFrontImage) images.push(this.getFullImageUrl(p.colorOnModelFrontImage));
        colorImages.set(p.colorCode, images);
      }
    });

    // 4. Get unique options
    const colors = [...new Set(products.map(p => p.colorName))];
    const sizes = [...new Set(products.map(p => p.sizeName))];
    console.log(`[Importer] ${colors.length} colors, ${sizes.length} sizes`);

    // 5. Calculate price range
    const prices = products.map(p => p.piecePrice || 0).filter(p => p > 0);
    const minPrice = Math.min(...prices) || 0;
    const maxPrice = Math.max(...prices) || 0;

    // 6. Build description
    const description = this.buildDescription(style, products, colors, sizes);

    // 7. Create product with productSet mutation (comprehensive)
    const productSetMutation = `
      mutation productSet($input: ProductSetInput!) {
        productSet(input: $input) {
          product {
            id
            handle
            title
            variants(first: 250) {
              edges {
                node {
                  id
                  sku
                  price
                  inventoryQuantity
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

    // Build variants with ALL data
    const productVariants = products.slice(0, 100).map((p, index) => {
      const totalStock = p.warehouses?.reduce((sum, w) => sum + (w.qty || 0), 0) || p.qty || 0;

      return {
        position: index + 1,
        sku: p.sku,
        price: p.piecePrice || 0,
        compareAtPrice: p.mapPrice && p.mapPrice > p.piecePrice ? p.mapPrice : null,
        inventoryPolicy: "DENY",
        inventoryManagement: "SHOPIFY",
        inventoryQuantities: [{
          locationId: "gid://shopify/Location/default",
          name: "available",
          quantity: totalStock,
        }],
        optionValues: [
          { optionName: "Color", name: p.colorName },
          { optionName: "Size", name: p.sizeName },
        ],
        metafields: [
          { namespace: "ssactivewear", key: "sku", value: p.sku, type: "single_line_text_field" },
          { namespace: "ssactivewear", key: "color_code", value: p.colorCode, type: "single_line_text_field" },
          { namespace: "ssactivewear", key: "size_code", value: p.sizeCode, type: "single_line_text_field" },
        ],
      };
    });

    // Build media array
    const mediaArray: any[] = [];

    // Main style image first
    if (style.styleImage) {
      mediaArray.push({
        originalSource: this.getFullImageUrl(style.styleImage),
        alt: style.title,
        mediaContentType: "IMAGE",
      });
    }

    // Add unique color images (limit to 20)
    let imageCount = 0;
    for (const [colorCode, images] of colorImages) {
      if (imageCount >= 20) break;
      for (const imageUrl of images) {
        if (imageCount >= 20) break;
        if (imageUrl && !mediaArray.some(m => m.originalSource === imageUrl)) {
          mediaArray.push({
            originalSource: imageUrl,
            alt: `${style.title} - ${colorCode}`,
            mediaContentType: "IMAGE",
          });
          imageCount++;
        }
      }
    }

    const productInput = {
      title: style.title,
      descriptionHtml: description,
      vendor: style.brandName,
      productType: style.baseCategory || "Apparel",
      status: "ACTIVE",
      tags: [
        style.brandName,
        style.baseCategory || "Apparel",
        "SSActiveWear",
        `ss-style-${styleId}`,
        style.partNumber,
      ].filter(Boolean),
      productOptions: [
        { name: "Color", values: colors.map(c => ({ name: c })) },
        { name: "Size", values: sizes.map(s => ({ name: s })) },
      ],
      variants: productVariants,
    };

    console.log(`[Importer] Creating product with ${productVariants.length} variants, ${mediaArray.length} images...`);

    try {
      const response = await admin.graphql(productSetMutation, {
        variables: { input: productInput },
      });
      const json = await response.json();

      if (json.errors) {
        console.error("[Importer] GraphQL errors:", JSON.stringify(json.errors));
        throw new Error(JSON.stringify(json.errors));
      }

      if (json.data?.productSet?.userErrors?.length > 0) {
        console.error("[Importer] User errors:", JSON.stringify(json.data.productSet.userErrors));
        throw new Error(JSON.stringify(json.data.productSet.userErrors));
      }

      const shopifyProduct = json.data?.productSet?.product;
      if (!shopifyProduct) {
        throw new Error("Product creation failed - no product returned");
      }

      console.log(`[Importer] Product created: ${shopifyProduct.id}`);

      // Add images separately (more reliable)
      if (mediaArray.length > 0) {
        await this.addProductMedia(admin, shopifyProduct.id, mediaArray);
      }

      // Update inventory for each variant
      await this.updateInventory(admin, shopifyProduct.id, products);

      // Save to database
      const productMap = await prisma.productMap.create({
        data: {
          shopifyProductId: shopifyProduct.id,
          ssStyleId: String(style.styleID),
        },
      });

      const variantCount = shopifyProduct.variants?.edges?.length || productVariants.length;
      console.log(`[Importer] ✅ Import complete: ${variantCount} variants, ${mediaArray.length} images`);

      return {
        productMap,
        shopifyProduct,
        variantCount,
        imageCount: mediaArray.length,
        message: `Successfully imported ${style.title} with ${variantCount} variants and ${mediaArray.length} images`,
      };

    } catch (error: any) {
      console.error("[Importer] Error:", error.message || error);

      // Try fallback simple import
      console.log("[Importer] Trying fallback import...");
      return await this.fallbackImport(admin, style, products, styleId);
    }
  }

  // Fallback simple import if productSet fails
  private async fallbackImport(admin: any, style: any, products: SSProduct[], styleId: number) {
    const colors = [...new Set(products.map(p => p.colorName))];
    const sizes = [...new Set(products.map(p => p.sizeName))];

    // Simple product create
    const createMutation = `
      mutation createProduct($input: ProductInput!) {
        productCreate(input: $input) {
          product {
            id
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;

    const response = await admin.graphql(createMutation, {
      variables: {
        input: {
          title: style.title,
          descriptionHtml: style.description || "",
          vendor: style.brandName,
          productType: style.baseCategory || "Apparel",
          status: "ACTIVE",
          tags: ["SSActiveWear", `ss-style-${styleId}`],
        },
      },
    });

    const json = await response.json();
    const product = json.data?.productCreate?.product;

    if (!product) {
      throw new Error("Fallback import also failed");
    }

    // Create options
    await admin.graphql(`
      mutation optionsCreate($productId: ID!, $options: [OptionCreateInput!]!) {
        productOptionsCreate(productId: $productId, options: $options) {
          userErrors { field message }
        }
      }
    `, {
      variables: {
        productId: product.id,
        options: [
          { name: "Color", values: colors.map(c => ({ name: c })) },
          { name: "Size", values: sizes.map(s => ({ name: s })) },
        ],
      },
    });

    // Create variants in batches
    let createdCount = 0;
    const batchSize = 50;

    for (let i = 0; i < products.length && i < 100; i += batchSize) {
      const batch = products.slice(i, Math.min(i + batchSize, 100));

      const variants = batch.map(p => ({
        sku: p.sku,
        price: String(p.piecePrice || 0),
        optionValues: [
          { optionName: "Color", name: p.colorName },
          { optionName: "Size", name: p.sizeName },
        ],
      }));

      try {
        const varResponse = await admin.graphql(`
          mutation bulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $productId, variants: $variants) {
              productVariants { id sku }
              userErrors { field message }
            }
          }
        `, {
          variables: { productId: product.id, variants },
        });

        const varJson = await varResponse.json();
        createdCount += varJson.data?.productVariantsBulkCreate?.productVariants?.length || 0;
      } catch (e) {
        console.error(`[Importer] Batch ${i / batchSize + 1} error:`, e);
      }
    }

    // Save mapping
    const productMap = await prisma.productMap.create({
      data: {
        shopifyProductId: product.id,
        ssStyleId: String(style.styleID),
      },
    });

    return {
      productMap,
      shopifyProduct: product,
      variantCount: createdCount,
      message: `Imported ${style.title} with ${createdCount} variants (fallback mode)`,
    };
  }

  // Build rich product description
  private buildDescription(style: any, products: SSProduct[], colors: string[], sizes: string[]): string {
    const priceRange = products.filter(p => p.piecePrice > 0).map(p => p.piecePrice);
    const minPrice = Math.min(...priceRange) || 0;
    const maxPrice = Math.max(...priceRange) || 0;

    return `
      <div class="ss-product-description">
        ${style.description || ''}

        <h4>Product Details</h4>
        <ul>
          <li><strong>Brand:</strong> ${style.brandName}</li>
          <li><strong>Style:</strong> ${style.partNumber}</li>
          <li><strong>Category:</strong> ${style.baseCategory || 'Apparel'}</li>
          <li><strong>Available Colors:</strong> ${colors.length} (${colors.slice(0, 5).join(', ')}${colors.length > 5 ? '...' : ''})</li>
          <li><strong>Available Sizes:</strong> ${sizes.join(', ')}</li>
          <li><strong>SKUs:</strong> ${products.length}</li>
        </ul>

        <p><em>Sourced from SSActiveWear - Style ID: ${style.styleID}</em></p>
      </div>
    `.trim();
  }

  // Add media to product
  private async addProductMedia(admin: any, productId: string, media: any[]) {
    if (media.length === 0) return;

    try {
      await admin.graphql(`
        mutation addMedia($productId: ID!, $media: [CreateMediaInput!]!) {
          productCreateMedia(productId: $productId, media: $media) {
            media { ... on MediaImage { id } }
            mediaUserErrors { field message }
          }
        }
      `, {
        variables: { productId, media },
      });
      console.log(`[Importer] Added ${media.length} images`);
    } catch (error) {
      console.error("[Importer] Media upload error:", error);
    }
  }

  // Update inventory for variants
  private async updateInventory(admin: any, productId: string, products: SSProduct[]) {
    // Get location ID first
    try {
      const locResponse = await admin.graphql(`
        query {
          locations(first: 1) {
            edges {
              node {
                id
                name
              }
            }
          }
        }
      `);
      const locJson = await locResponse.json();
      const locationId = locJson.data?.locations?.edges?.[0]?.node?.id;

      if (!locationId) {
        console.log("[Importer] No location found, skipping inventory update");
        return;
      }

      // Get variants
      const varResponse = await admin.graphql(`
        query getVariants($productId: ID!) {
          product(id: $productId) {
            variants(first: 100) {
              edges {
                node {
                  id
                  sku
                  inventoryItem {
                    id
                  }
                }
              }
            }
          }
        }
      `, { variables: { productId } });

      const varJson = await varResponse.json();
      const variants = varJson.data?.product?.variants?.edges || [];

      // Update inventory for each variant
      for (const { node: variant } of variants) {
        const product = products.find(p => p.sku === variant.sku);
        if (!product || !variant.inventoryItem?.id) continue;

        const totalQty = product.warehouses?.reduce((sum, w) => sum + (w.qty || 0), 0) || product.qty || 0;

        try {
          await admin.graphql(`
            mutation setInventory($inventoryItemId: ID!, $locationId: ID!, $quantity: Int!) {
              inventorySetQuantities(
                input: {
                  reason: "correction"
                  name: "available"
                  quantities: [
                    {
                      inventoryItemId: $inventoryItemId
                      locationId: $locationId
                      quantity: $quantity
                    }
                  ]
                }
              ) {
                userErrors { field message }
              }
            }
          `, {
            variables: {
              inventoryItemId: variant.inventoryItem.id,
              locationId,
              quantity: totalQty,
            },
          });
        } catch (e) {
          // Silently fail individual inventory updates
        }
      }

      console.log(`[Importer] Updated inventory for ${variants.length} variants`);
    } catch (error) {
      console.error("[Importer] Inventory update error:", error);
    }
  }

  private getFullImageUrl(imagePath: string | undefined): string {
    if (!imagePath) return "";
    if (imagePath.startsWith("http")) return imagePath;
    return `https://www.ssactivewear.com/${imagePath}`;
  }
}
