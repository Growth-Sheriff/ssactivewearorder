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
  },
};
