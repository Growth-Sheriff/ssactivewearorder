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

export interface SSInventory {
  sku: string;
  warehouses: {
    warehouseAbbr: string;
    qty: number;
  }[];
}

export class SSActiveWearClient {
  private client: AxiosInstance;

  constructor() {
    const userId = process.env.SSACTIVEWEAR_USER;
    const apiKey = process.env.SSACTIVEWEAR_KEY;

    if (!userId || !apiKey) {
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
    });
  }

  async getStyles(search?: string): Promise<SSStyle[]> {
    try {
      const endpoint = search ? `/styles?search=${encodeURIComponent(search)}` : "/styles/";
      const response = await this.client.get(endpoint);
      return response.data;
    } catch (error) {
      console.error("Error fetching styles:", error);
      throw error;
    }
  }

  async getStyleDetails(styleId: number): Promise<SSStyle[]> {
     try {
      const response = await this.client.get(`/styles/${styleId}`);
      return response.data;
    } catch (error) {
       console.error(`Error fetching style ${styleId}:`, error);
      throw error;
    }
  }

  async getInventory(skus: string[]): Promise<SSInventory[]> {
      try {
          const skuList = skus.join(",");
          const response = await this.client.get(`/inventory/${skuList}`);
          return response.data;
      } catch (error) {
          console.error("Error fetching inventory:", error);
          throw error;
      }
  }

  async getProducts(styleId: number): Promise<any[]> {
    try {
      const response = await this.client.get(`/products?style=${styleId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching products for style ${styleId}:`, error);
      throw error;
    }
  }


  async placeOrder(orderData: any): Promise<any> {
    try {
      const response = await this.client.post("/orders/", orderData);
      return response.data;
    } catch (error) {
      console.error("Error placing order:", error);
      throw error;
    }
  }
}
