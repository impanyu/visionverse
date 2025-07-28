import { ObjectId } from "mongodb";

export interface Shop {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  platform: string; // e.g., "Amazon", "eBay", "Shopify", "Etsy", etc.
  name: string; // Shop display name
  url: string; // Shop URL
  createdAt: Date;
  updatedAt: Date;
}

export interface ShopDocument extends Omit<Shop, 'id'> {
  _id?: ObjectId;
}

export interface CreateShopRequest {
  platform: string;
  name: string;
  url: string;
}

export interface CreateShopResponse {
  success: boolean;
  message: string;
  shop: Shop;
}

export interface GetShopsResponse {
  success: boolean;
  shops: Shop[];
}

// Popular platforms for dropdown selection
export const SHOP_PLATFORMS = [
  "Amazon",
  "eBay", 
  "Shopify",
  "Etsy",
  "WooCommerce",
  "BigCommerce",
  "Wix",
  "Squarespace",
  "Facebook Marketplace",
  "Instagram Shop",
  "Other"
] as const;

export type ShopPlatform = typeof SHOP_PLATFORMS[number]; 