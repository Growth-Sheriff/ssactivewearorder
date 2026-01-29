import axios, { type AxiosInstance } from "axios";

export interface SSStyle {
  styleID: number;
  partNumber: string;
  brandName: string;
  styleName: string;
  title: string;
  description: string;
  baseCategory: string;
  categories: string; // Comma separated IDs
  brandImage: string;
  styleImage: string;
}

export interface SSCategory {
  categoryID: number;
  name: string;
  image: string;
}

export interface SSInventory {
  sku: string;
  warehouses: {
    warehouseAbbr: string;
    qty: number;
  }[];
}

export class SSActiveWearClient {
  private client: AxiosInstance;
  private isConfigured: boolean;

  constructor() {
    const userId = process.env.SSACTIVEWEAR_USER;
    const apiKey = process.env.SSACTIVEWEAR_KEY;

    this.isConfigured = !!(userId && apiKey);

    if (!this.isConfigured) {
      console.warn("SSActiveWear credentials not found in environment.");
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
      timeout: 30000, // 30 second timeout
    });
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
     try {
      const response = await this.client.get(`/styles/${styleId}`);
      return response.data;
    } catch (error: any) {
       console.error(`[SSActiveWear] Error fetching style ${styleId}:`, error?.response?.data || error?.message);
      throw error;
    }
  }

  async getInventory(skus: string[]): Promise<SSInventory[]> {
      try {
          const skuList = skus.join(",");
          const response = await this.client.get(`/inventory/${skuList}`);
          return response.data;
      } catch (error: any) {
          console.error("[SSActiveWear] Error fetching inventory:", error?.response?.data || error?.message);
          throw error;
      }
  }

  async getProducts(styleId: number): Promise<any[]> {
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

  async placeOrder(orderData: any): Promise<any> {
    try {
      const response = await this.client.post("/orders/", orderData);
      return response.data;
    } catch (error: any) {
      console.error("[SSActiveWear] Error placing order:", error?.response?.data || error?.message);
      throw error;
    }
  }
}
