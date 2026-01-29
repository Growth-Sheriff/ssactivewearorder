export const typeDefs = `
  type Style {
    styleID: Int
    partNumber: String
    brandName: String
    styleName: String
    title: String
    description: String
    baseCategory: String
    categories: String
    brandImage: String
    styleImage: String
  }

  type WarehouseQty {
    warehouseAbbr: String
    qty: Int
  }

  type Inventory {
    sku: String
    warehouses: [WarehouseQty]
  }

  type Query {
    searchStyles(term: String): [Style]
    getStyleDetails(styleId: Int!): [Style]
    getInventory(skus: [String]!): [Inventory]
  }
`;
