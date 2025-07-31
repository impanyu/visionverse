import { ChromaClient, Collection } from "chromadb";
import OpenAI from "openai";

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Initialize Chroma client
const chroma = new ChromaClient({
  path: "http://localhost:8000", // Chroma server URL
});

// Collection name for vision descriptions
const COLLECTION_NAME = "vision_descriptions";
// Collection name for product descriptions
const PRODUCT_COLLECTION_NAME = "product_descriptions";
// Collection name for historical product queries
const HISTORICAL_QUERIES_COLLECTION_NAME = "historical_product_queries";

// Custom embedding function that tells Chroma we handle embeddings manually
class ManualEmbeddingFunction {
  constructor() {}
  
  // This method will never be called since we provide embeddings manually
  async generate(texts: string[]): Promise<number[][]> {
    throw new Error("This embedding function should not be called - embeddings are provided manually");
  }
}

const manualEmbedder = new ManualEmbeddingFunction();

/**
 * Generate embedding using OpenAI
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large", // Upgraded from small to large for better semantic understanding
    input: text,
    dimensions: 3072, // Use full dimensions for maximum accuracy (3072 for large model)
  });
  return response.data[0].embedding;
}

/**
 * Get or create the visions collection
 */
async function getCollection(): Promise<Collection> {
  try {
    // Try to get existing collection
    return await chroma.getCollection({
      name: COLLECTION_NAME,
      embeddingFunction: manualEmbedder,
    });
  } catch (error) {
    // Create collection if it doesn't exist
    return await chroma.createCollection({
      name: COLLECTION_NAME,
      embeddingFunction: manualEmbedder,
    });
  }
}

/**
 * Get or create the products collection
 */
async function getProductCollection(): Promise<Collection> {
  try {
    // Try to get existing collection
    return await chroma.getCollection({
      name: PRODUCT_COLLECTION_NAME,
      embeddingFunction: manualEmbedder,
    });
  } catch (error) {
    // Create collection if it doesn't exist
    return await chroma.createCollection({
      name: PRODUCT_COLLECTION_NAME,
      embeddingFunction: manualEmbedder,
    });
  }
}

/**
 * Get or create the historical queries collection
 */
async function getHistoricalQueriesCollection(): Promise<Collection> {
  try {
    // Try to get existing collection
    return await chroma.getCollection({
      name: HISTORICAL_QUERIES_COLLECTION_NAME,
      embeddingFunction: manualEmbedder,
    });
  } catch (error) {
    // Create collection if it doesn't exist
    return await chroma.createCollection({
      name: HISTORICAL_QUERIES_COLLECTION_NAME,
      embeddingFunction: manualEmbedder,
    });
  }
}

/**
 * Store a vision description embedding in the vector database
 * @param visionId - Unique ID for the vision (should match MongoDB ObjectId)
 * @param description - Vision description text
 * @param userId - User ID for isolation
 * @returns Promise<string> - The vector ID (same as visionId for easy deletion)
 */
export async function storeVisionEmbedding(
  visionId: string,
  description: string,
  userId: string
): Promise<string> {
  try {
    const collection = await getCollection();
    
    // Generate embedding using OpenAI
    const embedding = await generateEmbedding(description);
    
    // Store in Chroma with metadata
    await collection.add({
      ids: [visionId],
      embeddings: [embedding],
      documents: [description],
      metadatas: [{
        userId,
        createdAt: new Date().toISOString(),
        description: description.substring(0, 100) + (description.length > 100 ? "..." : "")
      }]
    });
    
    console.log(`✅ Stored embedding for vision ${visionId}`);
    return visionId;
  } catch (error) {
    console.error("❌ Error storing vision embedding:", error);
    throw error;
  }
}

/**
 * Store a product description embedding in the vector database
 * @param productId - Unique ID for the product (should match MongoDB ObjectId)
 * @param description - Product description text
 * @param userId - User ID for isolation
 * @returns Promise<string> - The vector ID (same as productId for easy deletion)
 */
export async function storeProductEmbedding(
  productId: string,
  description: string,
  userId: string
): Promise<string> {
  try {
    const collection = await getProductCollection();
    
    // Generate embedding using OpenAI
    const embedding = await generateEmbedding(description);
    
    // Store in Chroma with metadata
    await collection.add({
      ids: [productId],
      embeddings: [embedding],
      documents: [description],
      metadatas: [{
        userId,
        createdAt: new Date().toISOString(),
        description: description.substring(0, 100) + (description.length > 100 ? "..." : "")
      }]
    });
    
    console.log(`✅ Stored embedding for product ${productId}`);
    return productId;
  } catch (error) {
    console.error("❌ Error storing product embedding:", error);
    throw error;
  }
}

/**
 * Search for similar vision descriptions across all users
 * @param query - Search query text
 * @param userId - User ID (kept for backward compatibility but not used for filtering)
 * @param limit - Maximum number of results (default: 5)
 * @returns Promise with Chroma query format
 */
export async function searchSimilarVisions(
  query: string,
  userId: string,
  limit: number = 5
): Promise<{
  ids: string[][];
  distances?: number[][];
  documents?: string[][];
  metadatas?: any[][];
}> {
  try {
    const collection = await getCollection();
    
    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);
    
    // Search in Chroma for similar visions (across ALL users)
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit, // No need to get extra results since we're not filtering by user
      include: ["documents", "metadatas", "distances"]
    });
    
    console.log(`🔍 Found ${results.ids?.[0]?.length || 0} similar visions across all users`);
    
    return {
      ids: results.ids || [[]],
      distances: results.distances?.map(arr => arr.filter(d => d !== null)) || [[]],
      documents: results.documents?.map(arr => arr.filter(d => d !== null)) || [[]],
      metadatas: results.metadatas || [[]]
    };
  } catch (error) {
    console.error("❌ Error searching vision embeddings:", error);
    throw error;
  }
}

/**
 * Find the most similar vision for a product description
 * @param productDescription - Product description text
 * @param userId - User ID for isolation
 * @param limit - Maximum number of results (default: 5)
 * @returns Promise with Chroma query format
 */
export async function findSimilarVisionsForProduct(
  productDescription: string,
  userId: string,
  limit: number = 5
): Promise<{
  ids: string[][];
  distances?: number[][];
  documents?: string[][];
  metadatas?: any[][];
}> {
  try {
    const collection = await getCollection(); // Use vision collection
    
    // Generate embedding for the product description
    const queryEmbedding = await generateEmbedding(productDescription);
    
    // Search in Chroma for similar visions (across ALL users)
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit, // No need to get extra results since we're not filtering by user
      include: ["documents", "metadatas", "distances"]
    });
    
    console.log(`🔍 Found ${results.ids?.[0]?.length || 0} similar visions across all users for product linking`);
    
    return {
      ids: results.ids || [[]],
      distances: results.distances?.map(arr => arr.filter(d => d !== null)) || [[]],
      documents: results.documents?.map(arr => arr.filter(d => d !== null)) || [[]],
      metadatas: results.metadatas || [[]]
    };
  } catch (error) {
    console.error("❌ Error finding similar visions for product:", error);
    throw error;
  }
}

/**
 * Find the most similar products for a vision description
 * @param visionDescription - Vision description text
 * @param userId - User ID for isolation
 * @param limit - Maximum number of results (default: 5)
 * @returns Promise with Chroma query format
 */
export async function findSimilarProductsForVision(
  visionDescription: string,
  userId: string,
  limit: number = 5
): Promise<{
  ids: string[][];
  distances?: number[][];
  documents?: string[][];
  metadatas?: any[][];
}> {
  try {
    console.log(`🔍 findSimilarProductsForVision called with:`);
    console.log(`   Description: "${visionDescription}"`);
    console.log(`   User ID: "${userId}" (searching across ALL users)`);
    console.log(`   Limit: ${limit}`);
    
    const collection = await getProductCollection(); // Use product collection
    
    // Check total count in product collection
    const totalCount = await collection.count();
    console.log(`📊 Total products in product collection: ${totalCount}`);
    
    // Get all products to see what we're working with
    if (totalCount > 0) {
      const allProducts = await collection.get({
        include: ["documents", "metadatas"]
      });
      console.log(`📋 All products in vector DB:`, {
        totalCount: allProducts.ids?.length || 0,
        ids: allProducts.ids,
        documents: allProducts.documents,
        userIds: allProducts.metadatas?.map((m: any) => m?.userId)
      });
    }
    
    // Generate embedding for the vision description
    console.log(`🤖 Generating embedding for: "${visionDescription}"`);
    const queryEmbedding = await generateEmbedding(visionDescription);
    console.log(`✅ Generated embedding with ${queryEmbedding.length} dimensions`);
    
    // Search in Chroma for similar products (across ALL users)
    console.log(`🔍 Searching ChromaDB for similar products across all users...`);
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit, // No need to get extra results since we're not filtering by user
      include: ["documents", "metadatas", "distances"]
    });
    
    console.log(`🔍 Raw ChromaDB results:`, {
      foundIds: results.ids?.[0]?.length || 0,
      ids: results.ids?.[0],
      distances: results.distances?.[0],
      documents: results.documents?.[0],
      metadatas: results.metadatas?.[0]
    });
    
    console.log(`🔍 Found ${results.ids?.[0]?.length || 0} similar products across all users for vision linking`);
    
    return {
      ids: results.ids || [[]],
      distances: results.distances?.map(arr => arr.filter(d => d !== null)) || [[]],
      documents: results.documents?.map(arr => arr.filter(d => d !== null)) || [[]],
      metadatas: results.metadatas || [[]]
    };
  } catch (error) {
    console.error("❌ Error finding similar products for vision:", error);
    throw error;
  }
}

/**
 * Delete a vision embedding
 * @param visionId - The vision ID to delete
 * @returns Promise<void>
 */
export async function deleteVisionEmbedding(visionId: string): Promise<void> {
  try {
    const collection = await getCollection();
    
    await collection.delete({
      ids: [visionId]
    });
    
    console.log(`🗑️ Deleted embedding for vision ${visionId}`);
  } catch (error) {
    console.error("❌ Error deleting vision embedding:", error);
    throw error;
  }
}

/**
 * Delete a product embedding
 * @param productId - The product ID to delete
 * @returns Promise<void>
 */
export async function deleteProductEmbedding(productId: string): Promise<void> {
  try {
    const collection = await getProductCollection();
    
    await collection.delete({
      ids: [productId]
    });
    
    console.log(`🗑️ Deleted embedding for product ${productId}`);
  } catch (error) {
    console.error("❌ Error deleting product embedding:", error);
    throw error;
  }
}

/**
 * Get embedding statistics
 */
export async function getEmbeddingStats() {
  const collection = await getCollection();
  
  const count = await collection.count();
  
  return {
    totalEmbeddings: count,
    collectionName: COLLECTION_NAME,
  };
}

/**
 * Debug function to see all embeddings in the collection
 */
export async function debugAllEmbeddings() {
  try {
    const collection = await getCollection();
    const count = await collection.count();
    
    console.log(`📊 Total embeddings in collection: ${count}`);
    
    if (count > 0) {
      const allData = await collection.get({
        include: ["documents", "metadatas", "embeddings"]
      });
      
      console.log(`📋 All embeddings:`, {
        ids: allData.ids,
        documents: allData.documents,
        metadatas: allData.metadatas
      });
      
      return allData;
    }
    
    return null;
  } catch (error) {
    console.error("❌ Error debugging embeddings:", error);
    throw error;
  }
}

/**
 * Search for similar vision descriptions across all users
 * @param query - Search query text
 * @param limit - Maximum number of results (default: 5)
 * @returns Promise with Chroma query format
 */
export async function searchAllVisions(
  query: string,
  limit: number = 5
): Promise<{
  ids: string[][];
  distances?: number[][];
  documents?: string[][];
  metadatas?: any[][];
}> {
  try {
    const collection = await getCollection();
    
    // Generate embedding for the search query
    const queryEmbedding = await generateEmbedding(query);
    
    // Search in Chroma without user filtering
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      include: ["documents", "metadatas", "distances"]
    });
    
    console.log(`🔍 Found ${results.ids?.[0]?.length || 0} similar visions across all users`);
    
    return {
      ids: results.ids || [[]],
      distances: results.distances?.map(arr => arr.filter(d => d !== null)) || [[]],
      documents: results.documents?.map(arr => arr.filter(d => d !== null)) || [[]],
      metadatas: results.metadatas || [[]]
    };
  } catch (error) {
    console.error("❌ Error searching all vision embeddings:", error);
    throw error;
  }
}

// Type definitions
export interface SearchResult {
  visionId: string;
  description: string;
  similarity: number;
  metadata: {
    userId: string;
    createdAt: string;
    description: string;
  };
}

/**
 * Store a historical product query in the vector database
 * @param query - The user's search query
 * @param userId - User ID
 * @returns Promise<string> - The vector ID
 */
export async function storeHistoricalQuery(
  query: string,
  userId: string
): Promise<string> {
  try {
    console.log(`💾 Storing historical query: "${query}" for user: ${userId}`);
    
    const collection = await getHistoricalQueriesCollection();
    
    // Generate embedding using OpenAI
    console.log(`🤖 Generating embedding for: "${query}"`);
    const embedding = await generateEmbedding(query);
    console.log(`✅ Generated embedding with ${embedding.length} dimensions`);
    
    // Create unique ID for this query
    const queryId = `${userId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Store in Chroma with metadata
    await collection.add({
      ids: [queryId],
      embeddings: [embedding],
      documents: [query],
      metadatas: [{
        userId: userId,
        createdAt: new Date().toISOString(),
        query: query
      }]
    });
    
    console.log(`✅ Historical query stored with ID: ${queryId}`);
    return queryId;
  } catch (error) {
    console.error("❌ Error storing historical query:", error);
    throw error;
  }
}

/**
 * Search for similar historical queries for a specific user
 * @param query - Current search query to find similar historical queries for
 * @param userId - User ID to search within
 * @param limit - Maximum number of results to return (default: 10)
 * @returns Promise with similar historical queries
 */
export async function searchSimilarHistoricalQueries(
  query: string,
  userId: string,
  limit: number = 10
): Promise<{
  ids: string[][];
  distances: number[][];
  documents: string[][];
  metadatas: any[][];
}> {
  try {
    console.log(`🔍 Searching for similar historical queries for user: ${userId}, query: "${query}"`);
    
    const collection = await getHistoricalQueriesCollection();
    
    // Generate embedding for the current query
    console.log(`🤖 Generating embedding for: "${query}"`);
    const queryEmbedding = await generateEmbedding(query);
    console.log(`✅ Generated embedding with ${queryEmbedding.length} dimensions`);
    
    console.log(`🔍 Searching historical queries collection for user: ${userId}...`);
    
    // Search in ChromaDB with user filtering
    const results = await collection.query({
      queryEmbeddings: [queryEmbedding],
      nResults: limit,
      where: { userId: userId }, // Filter by user
      include: ["documents", "metadatas", "distances"]
    });
    
    console.log(`🔍 Raw historical queries results: {
      foundIds: ${results.ids?.[0]?.length || 0},
      distances: [${results.distances?.[0]?.slice(0, 3).map(d => d?.toFixed(8)).join(', ')}...]
    }`);
    
    // Filter out the exact same query (distance very close to 0)
    const filteredResults = {
      ids: [[]] as string[][],
      distances: [[]] as number[][],
      documents: [[]] as string[][],
      metadatas: [[]] as any[][]
    };
    
    if (results.ids?.[0] && results.distances?.[0] && results.documents?.[0] && results.metadatas?.[0]) {
      for (let i = 0; i < results.ids[0].length; i++) {
        const distance = results.distances[0][i];
        const document = results.documents[0][i];
        
        // Skip if it's exactly the same query (very low distance) or if distance is null
        if (distance != null && distance > 0.05 && document && document.toLowerCase() !== query.toLowerCase()) {
          filteredResults.ids[0].push(results.ids[0][i]);
          filteredResults.distances[0].push(distance);
          filteredResults.documents[0].push(document);
          filteredResults.metadatas[0].push(results.metadatas[0][i]);
        }
      }
    }
    
    console.log(`🔍 Found ${filteredResults.ids[0].length} similar historical queries for user`);
    
    return filteredResults;
  } catch (error) {
    console.error("❌ Error searching historical queries:", error);
    throw error;
  }
}