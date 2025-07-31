import { ObjectId } from "mongodb";

export interface HistoricalSearchResult {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  originalQuery: string;
  finalProduct: {
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
  };
  searchSteps: Array<{
    keywords: string;
    amazonResults: number;
    googleShoppingResults?: number;
    localResults: number;
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
  finalProduct: HistoricalSearchResult['finalProduct'];
  searchSteps: HistoricalSearchResult['searchSteps'];
  searchSummary: string;
} 