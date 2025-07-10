import { ObjectId } from "mongodb";

export interface Vision {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  visionDescription: string;
  filePath: string;
  price?: number; // Price in cents (e.g., 1000 = $10.00)
  onSale?: boolean; // Whether the vision is on sale, defaults to false
  vectorId?: string;
  linkedProducts?: { [productId: string]: number }; // Dictionary mapping product IDs to similarity scores
  clicks?: { [productId: string]: number }; // Dictionary mapping product IDs to click counts
  supportedBy?: string[]; // Array of user IDs who have supported this vision
  supportCount?: number; // Total number of supports (derived from supportedBy.length)
  createdAt: Date;
  updatedAt: Date;
}

export interface VisionDocument extends Omit<Vision, 'id'> {
  _id?: ObjectId;
}

export interface CreateVisionRequest {
  visionDescription: string;
  filePath: string;
  price?: number; // Price in cents
}

export interface CreateVisionResponse {
  success: boolean;
  message: string;
  vision: Vision;
  isDuplicate?: boolean;
  similarityScore?: number;
  duplicateReason?: string;
  linkedProducts?: { id: string; productDescription: string; similarityScore: number }[];
}

export interface GetVisionsResponse {
  success: boolean;
  visions: Vision[];
  pagination: {
    total: number;
    skip: number;
    limit: number;
    hasMore: boolean;
  };
} 