import prisma from "../db.server";
import { SSActiveWearClient } from "../services/ssactivewear";

const client = new SSActiveWearClient();

export const resolvers = {
  Query: {
    searchStyles: async (_: any, { term }: { term?: string }) => {
      return await client.getStyles(term);
    },
    getStyleDetails: async (_: any, { styleId }: { styleId: number }) => {
      return await client.getStyleDetails(styleId);
    },
    getInventory: async (_: any, { skus }: { skus: string[] }) => {
      return await client.getInventory(skus);
    },
    // Check if product was imported from SSActiveWear
    isProductImported: async (_: any, { shopifyProductId }: { shopifyProductId: string }) => {
      const productMap = await prisma.productMap.findFirst({
        where: { shopifyProductId: shopifyProductId },
      });
      return {
        imported: !!productMap,
        ssStyleId: productMap?.ssStyleId || null,
      };
    },
  },
};
