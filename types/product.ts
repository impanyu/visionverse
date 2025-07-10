import { ObjectId } from "mongodb";

export interface Product {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  productDescription: string;
  filePath: string;
  url: string; // Product URL - now required
  price?: number; // Price in cents (e.g., 1000 = $10.00)
  onSale?: boolean; // Whether the product is on sale, defaults to false
  vectorId?: string;
  linkedVision?: { [visionId: string]: number }; // Dictionary mapping vision ID to similarity score (only one entry)
  clicks?: { [visionId: string]: number }; // Dictionary mapping vision IDs to click counts
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductDocument extends Omit<Product, 'id'> {
  _id?: ObjectId;
}

export interface CreateProductRequest {
  productDescription: string;
  filePath: string;
  url: string; // Product URL - now required
}

export interface CreateProductResponse {
  success: boolean;
  message: string;
  product: Product;
  linkedVision?: {
    id: string;
    visionDescription: string;
    similarityScore: number;
  };
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