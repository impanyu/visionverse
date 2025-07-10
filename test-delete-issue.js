const { MongoClient, ObjectId } = require('mongodb');

async function testDeleteIssue() {
  console.log('🧪 Testing Delete Issue - Manual Database Check');
  
  // Connect to MongoDB
  const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017');
  await client.connect();
  
  const db = client.db('visionverse');
  const collection = db.collection('products');
  
  console.log('\n📊 BEFORE any operations:');
  const allProducts = await collection.find({}).toArray();
  console.log(`Total products: ${allProducts.length}`);
  
  // Group by user
  const userGroups = {};
  allProducts.forEach(product => {
    if (!userGroups[product.userId]) {
      userGroups[product.userId] = [];
    }
    userGroups[product.userId].push(product);
  });
  
  console.log('\n👥 Products by user:');
  Object.keys(userGroups).forEach(userId => {
    console.log(`  User ${userId}: ${userGroups[userId].length} products`);
    userGroups[userId].forEach((product, index) => {
      console.log(`    ${index + 1}. ${product._id}: ${product.productDescription.substring(0, 50)}...`);
    });
  });
  
  // Find the user with products
  const userWithProducts = Object.keys(userGroups).find(userId => userGroups[userId].length > 0);
  
  if (userWithProducts && userGroups[userWithProducts].length > 1) {
    console.log(`\n🗑️ SIMULATING DELETION for user ${userWithProducts}:`);
    const productToDelete = userGroups[userWithProducts][0];
    console.log(`Will delete: ${productToDelete._id} - ${productToDelete.productDescription.substring(0, 50)}...`);
    
    // Simulate deletion
    const deleteResult = await collection.deleteOne({ _id: productToDelete._id });
    console.log(`Delete result: ${deleteResult.deletedCount} document(s) deleted`);
    
    // Check immediately after deletion
    console.log('\n📊 IMMEDIATELY after deletion:');
    const remainingProducts = await collection.find({ userId: userWithProducts }).toArray();
    console.log(`User ${userWithProducts} now has ${remainingProducts.length} products:`);
    remainingProducts.forEach((product, index) => {
      console.log(`  ${index + 1}. ${product._id}: ${product.productDescription.substring(0, 50)}...`);
    });
    
    // Wait and check again
    console.log('\n⏳ Waiting 2 seconds and checking again...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const remainingProducts2 = await collection.find({ userId: userWithProducts }).toArray();
    console.log(`User ${userWithProducts} still has ${remainingProducts2.length} products:`);
    remainingProducts2.forEach((product, index) => {
      console.log(`  ${index + 1}. ${product._id}: ${product.productDescription.substring(0, 50)}...`);
    });
    
  } else {
    console.log('\n❌ Cannot test deletion - need at least 2 products for one user');
  }
  
  await client.close();
}

// Run the test
testDeleteIssue().catch(console.error); 