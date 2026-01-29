import axios, { type AxiosInstance } from "axios";

export interface SSStyle {
  styleID: number;
  partNumber: string;
  brandName: string;
  styleName: string;
  title: string;
  description: string;
  baseCategory: string;
  categories: string;
  brandImage: string;
  styleImage: string;
  sustainableStyle?: boolean;
}

export interface SSCategory {
  categoryID: number;
  name: string;
  image: string;
}

export interface SSWarehouse {
  warehouseAbbr: string;
  skuID: number;
  qty: number;
  closeout?: boolean;
  dropship?: boolean;
  returnable?: boolean;
}

export interface SSProduct {
  sku: string;
  gtin: string;
  skuID_Master: number;
  styleID: number;
  brandName: string;
  styleName: string;
  colorName: string;
  colorCode: string;
  colorGroupName: string;
  colorFamily: string;
  colorSwatchImage: string;
  colorSwatchTextColor: string;
  colorFrontImage: string;
  colorSideImage: string;
  colorBackImage: string;
  colorDirectSideImage: string;
  colorOnModelFrontImage: string;
  colorOnModelSideImage: string;
  colorOnModelBackImage: string;
  color1: string;
  color2: string;
  sizeName: string;
  sizeCode: string;
  sizeOrder: string;
  caseQty: number;
  unitWeight: number;
  mapPrice: number;
  piecePrice: number;
  dozenPrice: number;
  casePrice: number;
  customerPrice: number;
  salePrice?: number;
  qty: number;
  countryOfOrigin: string;
  warehouses: SSWarehouse[];
}

export interface SSInventory {
  sku: string;
  gtin: string;
  styleID: number;
  warehouses: SSWarehouse[];
}

export class SSActiveWearClient {
  private client: AxiosInstance;
  private isConfigured: boolean;

  constructor() {
    const userId = process.env.SSACTIVEWEAR_USER;
    const apiKey = process.env.SSACTIVEWEAR_KEY;

    this.isConfigured = !!(userId && apiKey);

    if (!this.isConfigured) {
      console.warn("[SSActiveWear] Credentials not found in environment.");
    }

    this.client = axios.create({
      baseURL: "https://api.ssactivewear.com/v2",
      auth: {
        username: userId || "",
        password: apiKey || "",
      },
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 60000, // 60 second timeout for large requests
    });
  }

  // Build full image URL from SSActiveWear via proxy
  static buildImageUrl(imagePath: string, size: 'small' | 'medium' | 'large' = 'medium'): string {
    if (!imagePath) return "";
    if (imagePath.startsWith("http")) return imagePath;

    // Replace size suffix based on requested size
    // _fs = small, _fm = medium, _fl = large
    let finalPath = imagePath;
    if (size === 'large') {
      finalPath = imagePath.replace(/_fm\./g, '_fl.').replace(/_fs\./g, '_fl.');
    } else if (size === 'small') {
      finalPath = imagePath.replace(/_fm\./g, '_fs.').replace(/_fl\./g, '_fs.');
    }

    // Use absolute URL for proxy to work within Shopify App Bridge
    const baseUrl = process.env.SHOPIFY_APP_URL || "https://ssaw-e.techifyboost.com";
    return `${baseUrl}/api/image-proxy?path=${encodeURIComponent(finalPath)}`;
  }

  async getCategories(): Promise<SSCategory[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      console.log("[SSActiveWear] Fetching categories...");
      const response = await this.client.get("/categories/");
      console.log(`[SSActiveWear] Got ${response.data?.length || 0} categories`);
      return response.data;
    } catch (error: any) {
      console.error("[SSActiveWear] Error fetching categories:", error?.response?.data || error?.message);
      throw error;
    }
  }

  async getStyles(search?: string): Promise<SSStyle[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      const endpoint = search ? `/styles?search=${encodeURIComponent(search)}` : "/styles/";
      console.log(`[SSActiveWear] Fetching styles: ${endpoint}`);
      const response = await this.client.get(endpoint);
      console.log(`[SSActiveWear] Got ${response.data?.length || 0} styles`);
      return response.data;
    } catch (error: any) {
      console.error("[SSActiveWear] Error fetching styles:", error?.response?.data || error?.message);
      throw error;
    }
  }

  async getStyleDetails(styleId: number): Promise<SSStyle[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      console.log(`[SSActiveWear] Fetching style details for ${styleId}...`);
      const response = await this.client.get(`/styles/${styleId}`);
      return response.data;
    } catch (error: any) {
      console.error(`[SSActiveWear] Error fetching style ${styleId}:`, error?.response?.data || error?.message);
      throw error;
    }
  }

  async getProducts(styleId: number): Promise<SSProduct[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      console.log(`[SSActiveWear] Fetching products for style ${styleId}...`);
      const response = await this.client.get(`/products?style=${styleId}`);
      console.log(`[SSActiveWear] Got ${response.data?.length || 0} products`);
      return response.data;
    } catch (error: any) {
      console.error(`[SSActiveWear] Error fetching products for style ${styleId}:`, error?.response?.data || error?.message);
      throw error;
    }
  }

  async getInventoryByStyle(styleId: number): Promise<SSInventory[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      console.log(`[SSActiveWear] Fetching inventory for style ${styleId}...`);
      const response = await this.client.get(`/inventory?style=${styleId}`);
      console.log(`[SSActiveWear] Got ${response.data?.length || 0} inventory items`);
      return response.data;
    } catch (error: any) {
      console.error(`[SSActiveWear] Error fetching inventory for style ${styleId}:`, error?.response?.data || error?.message);
      throw error;
    }
  }

  async getInventory(skus: string[]): Promise<SSInventory[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      const skuList = skus.join(",");
      const response = await this.client.get(`/inventory/${skuList}`);
      return response.data;
    } catch (error: any) {
      console.error("[SSActiveWear] Error fetching inventory:", error?.response?.data || error?.message);
      throw error;
    }
  }

  async placeOrder(orderData: any): Promise<any> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      const response = await this.client.post("/orders/", orderData);
      return response.data;
    } catch (error: any) {
      console.error("[SSActiveWear] Error placing order:", error?.response?.data || error?.message);
      throw error;
    }
  }

  // Get all brands
  async getBrands(): Promise<any[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      console.log("[SSActiveWear] Fetching all brands...");
      const response = await this.client.get("/brands/");
      console.log(`[SSActiveWear] Got ${response.data?.length || 0} brands`);
      return response.data;
    } catch (error: any) {
      console.error("[SSActiveWear] Error fetching brands:", error?.response?.data || error?.message);
      throw error;
    }
  }

  // Get all styles (full catalog)
  async getAllStyles(): Promise<SSStyle[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      console.log("[SSActiveWear] Fetching ALL styles (this may take a while)...");
      const response = await this.client.get("/styles/");
      console.log(`[SSActiveWear] Got ${response.data?.length || 0} styles`);
      return response.data;
    } catch (error: any) {
      console.error("[SSActiveWear] Error fetching all styles:", error?.response?.data || error?.message);
      throw error;
    }
  }

  // Get styles by brand
  async getStylesByBrand(brandName: string): Promise<SSStyle[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      console.log(`[SSActiveWear] Fetching styles for brand: ${brandName}...`);
      const response = await this.client.get(`/styles?search=${encodeURIComponent(brandName)}`);
      console.log(`[SSActiveWear] Got ${response.data?.length || 0} styles for ${brandName}`);
      return response.data;
    } catch (error: any) {
      console.error(`[SSActiveWear] Error fetching styles for brand ${brandName}:`, error?.response?.data || error?.message);
      throw error;
    }
  }

  // Get SSActiveWear orders
  async getOrders(all: boolean = false): Promise<any[]> {
    if (!this.isConfigured) {
      throw new Error("API credentials not configured");
    }
    try {
      const endpoint = all ? "/orders/?All=True" : "/orders/";
      console.log(`[SSActiveWear] Fetching orders...`);
      const response = await this.client.get(endpoint);
      console.log(`[SSActiveWear] Got ${response.data?.length || 0} orders`);
      return response.data;
    } catch (error: any) {
      console.error("[SSActiveWear] Error fetching orders:", error?.response?.data || error?.message);
      throw error;
    }
  }
}
