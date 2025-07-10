#!/usr/bin/env node

/**
 * Migration script to upgrade all embeddings from text-embedding-3-small to text-embedding-3-large
 * 
 * This script will:
 * 1. Connect to MongoDB to get all visions and products
 * 2. Re-generate embeddings using the new text-embedding-3-large model
 * 3. Update the vector database with the new embeddings
 * 
 * Run with: node scripts/migrate-embeddings.js
 */

const { MongoClient } = require('mongodb');
const { ChromaClient } = require('chromadb');
const OpenAI = require('openai');
require('dotenv').config({ path: '.env' });

// Initialize clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const chroma = new ChromaClient({
  path: "http://localhost:8000",
});

const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/visionverse';

/**
 * Generate embedding using OpenAI's new large model
 */
async function generateEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text,
    dimensions: 3072,
  });
  return response.data[0].embedding;
}

/**
 * Custom embedding function for Chroma
 */
class ManualEmbeddingFunction {
  constructor() {}
  
  async generate(texts) {
    throw new Error("This embedding function should not be called - embeddings are provided manually");
  }
}

const manualEmbedder = new ManualEmbeddingFunction();

/**
 * Get or create collection with new embeddings
 */
async function getOrCreateCollection(name) {
  try {
    // Try to delete existing collection first
    try {
      await chroma.deleteCollection({ name });
      console.log(`🗑️ Deleted existing ${name} collection`);
    } catch (e) {
      // Collection doesn't exist, that's fine
    }
    
    // Create new collection
    return await chroma.createCollection({
      name,
      embeddingFunction: manualEmbedder,
    });
  } catch (error) {
    console.error(`❌ Error creating collection ${name}:`, error);
    throw error;
  }
}

/**
 * Migrate vision embeddings
 */
async function migrateVisionEmbeddings(db) {
  console.log("\n🔄 Starting vision embeddings migration...");
  
  const collection = db.collection('visions');
  const visions = await collection.find({}).toArray();
  
  console.log(`📊 Found ${visions.length} visions to migrate`);
  
  if (visions.length === 0) {
    console.log("ℹ️ No visions found, skipping vision migration");
    return;
  }
  
  // Create new vector collection
  const vectorCollection = await getOrCreateCollection('vision_descriptions');
  
  let migrated = 0;
  let errors = 0;
  
  for (const vision of visions) {
    try {
      if (!vision.visionDescription || vision.visionDescription.trim() === '') {
        console.log(`⚠️ Skipping vision ${vision._id} - no description`);
        continue;
      }
      
      console.log(`🔄 Migrating vision ${vision._id}: "${vision.visionDescription.substring(0, 50)}..."`);
      
      // Generate new embedding
      const embedding = await generateEmbedding(vision.visionDescription.trim());
      
      // Store in vector database
      await vectorCollection.add({
        ids: [vision._id.toString()],
        embeddings: [embedding],
        documents: [vision.visionDescription.trim()],
        metadatas: [{
          userId: vision.userId || 'unknown',
          createdAt: vision.createdAt ? vision.createdAt.toISOString() : new Date().toISOString(),
          description: vision.visionDescription.substring(0, 100) + (vision.visionDescription.length > 100 ? "..." : "")
        }]
      });
      
      // Update MongoDB with new vectorId
      await collection.updateOne(
        { _id: vision._id },
        { $set: { vectorId: vision._id.toString() } }
      );
      
      migrated++;
      console.log(`✅ Migrated vision ${vision._id} (${migrated}/${visions.length})`);
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Error migrating vision ${vision._id}:`, error.message);
      errors++;
    }
  }
  
  console.log(`\n📊 Vision migration complete:`);
  console.log(`   ✅ Migrated: ${migrated}`);
  console.log(`   ❌ Errors: ${errors}`);
}

/**
 * Migrate product embeddings
 */
async function migrateProductEmbeddings(db) {
  console.log("\n🔄 Starting product embeddings migration...");
  
  const collection = db.collection('products');
  const products = await collection.find({}).toArray();
  
  console.log(`📊 Found ${products.length} products to migrate`);
  
  if (products.length === 0) {
    console.log("ℹ️ No products found, skipping product migration");
    return;
  }
  
  // Create new vector collection
  const vectorCollection = await getOrCreateCollection('product_descriptions');
  
  let migrated = 0;
  let errors = 0;
  
  for (const product of products) {
    try {
      if (!product.productDescription || product.productDescription.trim() === '') {
        console.log(`⚠️ Skipping product ${product._id} - no description`);
        continue;
      }
      
      console.log(`🔄 Migrating product ${product._id}: "${product.productDescription.substring(0, 50)}..."`);
      
      // Generate new embedding
      const embedding = await generateEmbedding(product.productDescription.trim());
      
      // Store in vector database
      await vectorCollection.add({
        ids: [product._id.toString()],
        embeddings: [embedding],
        documents: [product.productDescription.trim()],
        metadatas: [{
          userId: product.userId || 'unknown',
          createdAt: product.createdAt ? product.createdAt.toISOString() : new Date().toISOString(),
          description: product.productDescription.substring(0, 100) + (product.productDescription.length > 100 ? "..." : "")
        }]
      });
      
      // Update MongoDB with new vectorId
      await collection.updateOne(
        { _id: product._id },
        { $set: { vectorId: product._id.toString() } }
      );
      
      migrated++;
      console.log(`✅ Migrated product ${product._id} (${migrated}/${products.length})`);
      
      // Small delay to avoid rate limits
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ Error migrating product ${product._id}:`, error.message);
      errors++;
    }
  }
  
  console.log(`\n📊 Product migration complete:`);
  console.log(`   ✅ Migrated: ${migrated}`);
  console.log(`   ❌ Errors: ${errors}`);
}

/**
 * Main migration function
 */
async function main() {
  console.log("🚀 Starting embedding migration to text-embedding-3-large");
  console.log("   This will upgrade all embeddings for better semantic understanding");
  console.log("   Phrases like 'walking shoe' and 'shoe for walking' will now be more similar\n");
  
  // Check environment
  if (!process.env.OPENAI_API_KEY) {
    console.error("❌ OPENAI_API_KEY not found in environment variables");
    process.exit(1);
  }
  
  let mongoClient;
  
  try {
    // Connect to MongoDB
    console.log("🔗 Connecting to MongoDB...");
    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    const db = mongoClient.db();
    console.log("✅ Connected to MongoDB");
    
    // Check Chroma connection
    console.log("🔗 Checking Chroma connection...");
    await chroma.heartbeat();
    console.log("✅ Connected to Chroma");
    
    // Migrate visions
    await migrateVisionEmbeddings(db);
    
    // Migrate products
    await migrateProductEmbeddings(db);
    
    console.log("\n🎉 Migration completed successfully!");
    console.log("   Your embeddings are now using text-embedding-3-large for better semantic understanding");
    console.log("   You should see improved similarity detection for phrases like:");
    console.log("   - 'walking shoe' ↔ 'shoe for walking'");
    console.log("   - 'fitness app' ↔ 'application for fitness'");
    console.log("   - 'mobile game' ↔ 'game for mobile devices'");
    
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    if (mongoClient) {
      await mongoClient.close();
      console.log("🔐 Disconnected from MongoDB");
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main }; 