import { ObjectId } from "mongodb";

export interface HistoricalSearchResult {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  originalQuery: string;
  finalProducts: Array<{
    title: string;
    description?: string;
    price: string;
    extracted_price?: number;
    original_price?: string;
    extracted_original_price?: number;
    rating?: number;
    reviews?: number;
    link: string;
    thumbnail?: string;
    source: 'amazon' | 'local' | 'google_shopping';
    asin?: string;
    product_id?: string;
    is_prime?: boolean;
    seller?: string;
    delivery?: string;
    evaluation: {
      score: number;
      reasons: string[];
      isRecommended: boolean;
    };
    product_description?: string; // Added to track which Gemini recommendation this product came from
    necessity_score?: number; // Added to track Gemini necessity score
  }>;
  searchSteps: Array<{
    keywords: string;
    amazonResults: number;
    googleShoppingResults?: number;
    localResults?: number;
    sheinResults?: number;
    refinementReason?: string;
    stepType?: 'intent' | 'search' | 'refinement';
    priceRange?: {
      min?: number;
      max?: number;
    };
  }>;
  searchSummary: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HistoricalSearchDocument extends Omit<HistoricalSearchResult, 'id'> {
  _id?: ObjectId;
}

export interface StoreHistoricalSearchRequest {
  originalQuery: string;
  finalProducts: HistoricalSearchResult['finalProducts'];
  searchSteps: HistoricalSearchResult['searchSteps'];
  searchSummary: string;
} 