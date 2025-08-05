import clientPromise from './mongodb';
import { HistoricalSearchResult, HistoricalSearchDocument, StoreHistoricalSearchRequest } from '@/types/historical-search';

const DATABASE_NAME = 'visionverse';
const COLLECTION_NAME = 'historical_searches';

/**
 * Get the historical searches collection
 */
async function getHistoricalSearchesCollection() {
  const client = await clientPromise;
  const db = client.db(DATABASE_NAME);
  return db.collection<HistoricalSearchDocument>(COLLECTION_NAME);
}

/**
 * Store a historical search result
 * @param searchData - The search data to store
 * @param userId - User ID
 * @param userName - User name
 * @param userEmail - User email
 * @returns Promise<string> - The document ID
 */
export async function storeHistoricalSearchResult(
  searchData: StoreHistoricalSearchRequest,
  userId: string,
  userName: string,
  userEmail: string
): Promise<string> {
  try {
    console.log(`💾 Storing historical search result for user: ${userId}`);
    
    const collection = await getHistoricalSearchesCollection();
    
    const document: HistoricalSearchDocument = {
      userId,
      userName,
      userEmail,
      originalQuery: searchData.originalQuery,
      finalProducts: searchData.finalProducts,
      searchSteps: searchData.searchSteps,
      searchSummary: searchData.searchSummary,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await collection.insertOne(document);
    
    console.log(`✅ Historical search result stored with ID: ${result.insertedId}`);
    return result.insertedId.toString();
  } catch (error) {
    console.error("❌ Error storing historical search result:", error);
    throw error;
  }
}

/**
 * Get the last 3 searched product bundles for a user (for use as LLM context)
 * @param userId - User ID
 * @returns Promise<HistoricalSearchResult[]> - Array of the last 3 search results
 */
export async function getLastSearchedProductBundles(userId: string): Promise<HistoricalSearchResult[]> {
  try {
    console.log(`🔍 Retrieving last 3 searched product bundles for user: ${userId}`);
    
    const collection = await getHistoricalSearchesCollection();
    
    const results = await collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(3)
      .toArray();
    
    if (results.length === 0) {
      console.log(`📭 No previous search results found for user: ${userId}`);
      return [];
    }
    
    const historicalSearches: HistoricalSearchResult[] = results.map(result => ({
      id: result._id!.toString(),
      userId: result.userId,
      userName: result.userName,
      userEmail: result.userEmail,
      originalQuery: result.originalQuery,
      finalProducts: result.finalProducts,
      searchSteps: result.searchSteps,
      searchSummary: result.searchSummary,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    }));
    
    console.log(`✅ Found ${historicalSearches.length} historical product bundles for context`);
    historicalSearches.forEach((search, index) => {
      console.log(`   ${index + 1}. "${search.originalQuery}" → ${search.finalProducts.length} products (${search.createdAt.toLocaleDateString()})`);
    });
    
    return historicalSearches;
  } catch (error) {
    console.error("❌ Error retrieving last searched product bundles:", error);
    return []; // Return empty array on error to not break the search flow
  }
}

/**
 * Get the last searched product for a user (backward compatibility - deprecated)
 * @param userId - User ID
 * @returns Promise<HistoricalSearchResult | null> - The last search result or null
 * @deprecated Use getLastSearchedProductBundles instead
 */
export async function getLastSearchedProduct(userId: string): Promise<HistoricalSearchResult | null> {
  try {
    const bundles = await getLastSearchedProductBundles(userId);
    return bundles.length > 0 ? bundles[0] : null;
  } catch (error) {
    console.error("❌ Error retrieving last searched product:", error);
    return null;
  }
}

/**
 * Get historical search results for a user with pagination
 * @param userId - User ID
 * @param limit - Number of results to return (default: 10)
 * @param skip - Number of results to skip (default: 0)
 * @returns Promise<HistoricalSearchResult[]> - Array of historical search results
 */
export async function getHistoricalSearchResults(
  userId: string,
  limit: number = 10,
  skip: number = 0
): Promise<HistoricalSearchResult[]> {
  try {
    console.log(`📋 Retrieving historical search results for user: ${userId} (limit: ${limit}, skip: ${skip})`);
    
    const collection = await getHistoricalSearchesCollection();
    
    const results = await collection
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .toArray();
    
    const historicalSearches: HistoricalSearchResult[] = results.map(result => ({
      id: result._id!.toString(),
      userId: result.userId,
      userName: result.userName,
      userEmail: result.userEmail,
      originalQuery: result.originalQuery,
      finalProducts: result.finalProducts,
      searchSteps: result.searchSteps,
      searchSummary: result.searchSummary,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt
    }));
    
    console.log(`✅ Retrieved ${historicalSearches.length} historical search results`);
    return historicalSearches;
  } catch (error) {
    console.error("❌ Error retrieving historical search results:", error);
    return []; // Return empty array on error
  }
} 