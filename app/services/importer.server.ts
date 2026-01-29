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

    // 2. Prepare Shopify Product Input
    const productInput = {
      title: style.title,
      descriptionHtml: style.description,
      vendor: style.brandName,
      productType: style.baseCategory,
      status: "ACTIVE",
      tags: [style.baseCategory, "SSActiveWear"],
      // Variants will be created separately or via nested mutation if simpler
      // For detailed variants (Color/Size), we usually need multiple calls or a large mutation
    };

    // 3. Create Product in Shopify
    const createProductMutation = `
      mutation productCreate($input: ProductInput!) {
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

    const response = await admin.graphql(createProductMutation, {
      variables: { input: productInput },
    });
    const responseJson = await response.json();

    if (responseJson.data?.productCreate?.userErrors?.length > 0) {
        throw new Error(JSON.stringify(responseJson.data.productCreate.userErrors));
    }

    const shopifyProduct = responseJson.data?.productCreate?.product;

    // 4. Save Mapping to DB
    const productMap = await prisma.productMap.create({
      data: {
        shopifyProductId: shopifyProduct.id,
        ssStyleId: String(style.styleID),
      },
    });

    // 5. Fetch Products (SKUs) for this Style to create Variants
    // Note: This matches the "Product Discovery" module logic.
    // We need to fetch ALL products for this style using SS Client.
    // Then loop and create variants.
    // For MVP, we just create the base product.
    // Ideally, we fetch variants and add them.

    return productMap;
  }
}
