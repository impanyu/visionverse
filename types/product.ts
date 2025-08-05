import { ObjectId } from "mongodb";

export interface Product {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  productDescription: string;
  filePath: string;
  url?: string; // Product URL - optional
  price?: number; // Price in cents (e.g., 1000 = $10.00)
  onSale?: boolean; // Whether the product is on sale, defaults to false
  vectorId?: string;

  createdAt: Date;
  updatedAt: Date;
}

export interface ProductDocument extends Omit<Product, 'id'> {
  _id?: ObjectId;
}

export interface CreateProductRequest {
  productDescription: string;
  filePath: string;
  url?: string; // Product URL - optional
}

export interface CreateProductResponse {
  success: boolean;
  message: string;
  product: Product;
}

export interface GetProductsResponse {
  success: boolean;
  products: Product[];
  pagination: {
    total: number;
    skip: number;
    limit: number;
    hasMore: boolean;
  };
} 