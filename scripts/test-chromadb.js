const { ChromaClient } = require('chromadb');
require('dotenv').config({ path: '.env' });

async function testChromaDB() {
  console.log('🧪 Testing ChromaDB connectivity...');
  
  try {
    const chromaUrl = process.env.CHROMA_URL || 'http://localhost:8000';
    console.log(`🔗 Connecting to ChromaDB at: ${chromaUrl}`);
    
    const chroma = new ChromaClient({ url: chromaUrl });
    
    // Test 1: Get version (basic connectivity)
    console.log('📋 Testing basic connectivity...');
    const version = await chroma.version();
    console.log(`✅ ChromaDB version: ${version}`);
    
    // Test 2: List collections
    console.log('📂 Listing existing collections...');
    const collections = await chroma.listCollections();
    console.log(`📈 Found ${collections.length} collections:`, collections.map(c => c.name));
    
    // Test 3: Check if visions collection exists
    let visionsCollection;
    try {
      visionsCollection = await chroma.getCollection({ name: 'vision_descriptions' });
      console.log('✅ "vision_descriptions" collection exists');
      
      // Get count
      const count = await visionsCollection.count();
      console.log(`📊 "vision_descriptions" collection has ${count} embeddings`);
    } catch (error) {
      if (error.message && error.message.includes('does not exist')) {
        console.log('ℹ️ "vision_descriptions" collection does not exist - this is normal after cleanup');
        
        // Test 4: Create the collection
        console.log('🏗️ Creating "vision_descriptions" collection...');
        visionsCollection = await chroma.createCollection({ 
          name: 'vision_descriptions',
          metadata: { description: 'Vision embeddings for VisionVerse app' }
        });
        console.log('✅ Created "vision_descriptions" collection successfully');
      } else {
        throw error;
      }
    }
    
    // Test 5: Test basic operations
    console.log('🔬 Testing basic operations...');
    
    // Add a test embedding with manually provided embedding vector
    const testEmbedding = new Array(1536).fill(0.1); // Dummy embedding vector
    await visionsCollection.add({
      ids: ['test-1'],
      documents: ['This is a test vision'],
      embeddings: [testEmbedding], // Provide the embedding manually
      metadatas: [{ test: true }]
    });
    console.log('✅ Added test embedding');
    
    // Query the test embedding with manual embedding
    const queryEmbedding = new Array(1536).fill(0.1); // Same dummy embedding for testing
    const results = await visionsCollection.query({
      queryEmbeddings: [queryEmbedding], // Use manual embedding for query
      nResults: 1
    });
    console.log('✅ Queried embeddings successfully');
    console.log(`🎯 Query returned ${results.ids[0]?.length || 0} results`);
    
    // Clean up test data
    await visionsCollection.delete({
      ids: ['test-1']
    });
    console.log('✅ Cleaned up test embedding');
    
    console.log('🎉 ChromaDB test completed successfully!');
    console.log('');
    console.log('Summary:');
    console.log('✅ ChromaDB is running and accessible');
    console.log('✅ Can create and manage collections');
    console.log('✅ Can add, query, and delete embeddings');
    console.log('✅ Ready for vision storage operations');
    
  } catch (error) {
    console.error('❌ ChromaDB test failed:', error);
    console.log('');
    console.log('Troubleshooting:');
    console.log('1. Make sure ChromaDB is running: chroma run --host localhost --port 8000');
    console.log('2. Check if port 8000 is available');
    console.log('3. Verify CHROMA_URL in environment variables');
  }
}

// Run the test
testChromaDB()
  .then(() => {
    console.log('✅ Test script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Test script failed:', error);
    process.exit(1);
  }); 