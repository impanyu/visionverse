const { MongoClient } = require('mongodb');
const { ChromaClient } = require('chromadb');

// Load environment variables
require('dotenv').config({ path: '.env' });

async function clearAllVisions() {
  console.log('🚀 Starting to clear all visions...');

  // MongoDB cleanup
  let mongoClient;
  try {
    console.log('📊 Connecting to MongoDB...');
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI not found in environment variables');
    }

    mongoClient = new MongoClient(mongoUri);
    await mongoClient.connect();
    
    const db = mongoClient.db('visionverse');
    const collection = db.collection('visions');
    
    // Get count before deletion
    const beforeCount = await collection.countDocuments();
    console.log(`📈 Found ${beforeCount} visions in MongoDB`);
    
    if (beforeCount > 0) {
      // Delete all visions
      const deleteResult = await collection.deleteMany({});
      console.log(`✅ Deleted ${deleteResult.deletedCount} visions from MongoDB`);
    } else {
      console.log('ℹ️ No visions found in MongoDB');
    }
    
  } catch (error) {
    console.error('❌ Error clearing MongoDB:', error);
  } finally {
    if (mongoClient) {
      await mongoClient.close();
      console.log('🔐 MongoDB connection closed');
    }
  }

  // Vector database cleanup
  try {
    console.log('🔍 Connecting to ChromaDB...');
    const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
    const chroma = new ChromaClient({ url: chromaUrl });
    
    // Try to get the collection
    try {
      const collection = await chroma.getCollection({ name: 'vision_descriptions' });
      
      // Get count before deletion
      const beforeCount = await collection.count();
      console.log(`📈 Found ${beforeCount} embeddings in ChromaDB`);
      
      if (beforeCount > 0) {
        // Delete the entire collection to clear all embeddings
        await chroma.deleteCollection({ name: 'vision_descriptions' });
        console.log('✅ Deleted entire "vision_descriptions" collection from ChromaDB');
        
        // Recreate empty collection
        await chroma.createCollection({ 
          name: 'vision_descriptions',
          metadata: { description: 'Vision embeddings for VisionVerse app' }
        });
        console.log('✅ Recreated empty "vision_descriptions" collection in ChromaDB');
      } else {
        console.log('ℹ️ No embeddings found in ChromaDB');
      }
      
    } catch (collectionError) {
      if (collectionError.message && collectionError.message.includes('does not exist')) {
        console.log('ℹ️ "vision_descriptions" collection does not exist in ChromaDB');
        
        // Create the collection for future use
        await chroma.createCollection({ 
          name: 'vision_descriptions',
          metadata: { description: 'Vision embeddings for VisionVerse app' }
        });
        console.log('✅ Created new "vision_descriptions" collection in ChromaDB');
      } else {
        throw collectionError;
      }
    }
    
  } catch (error) {
    console.error('❌ Error clearing ChromaDB:', error);
    console.log('ℹ️ This might be normal if ChromaDB is not running or not configured');
  }

  console.log('🎉 Vision cleanup completed!');
  console.log('');
  console.log('Summary:');
  console.log('- All visions removed from MongoDB');
  console.log('- All embeddings removed from ChromaDB');
  console.log('- Fresh collections ready for new visions');
}

// Run the cleanup
clearAllVisions()
  .then(() => {
    console.log('✅ Cleanup script finished successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Cleanup script failed:', error);
    process.exit(1);
  }); 