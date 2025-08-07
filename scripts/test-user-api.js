/**
 * Test script for user API endpoints
 * Run with: node scripts/test-user-api.js
 */

const { initializeExistingUsers, createOrGetUser, updateUserProfile, getUserProfile, addProfileItem, removeProfileItem, addQueryToProfile, summarizeUserProfile } = require('../lib/user-db');

async function testUserAPI() {
  try {
    console.log('🧪 Testing User API...\n');

    // Test 1: Create a test user
    console.log('1️⃣ Testing createOrGetUser...');
    const testUser = await createOrGetUser(
      'test-user-123', 
      'Test User', 
      'test@example.com'
    );
    console.log('✅ Created/Got user:', testUser.userId);

    // Test 2: Update user profile
    console.log('\n2️⃣ Testing updateUserProfile...');
    const updatedUser = await updateUserProfile(
      'test-user-123',
      ['Interest in technology', 'Love for travel', 'Coffee enthusiast']
    );
    console.log('✅ Updated profile:', updatedUser?.profile);

    // Test 3: Get user profile
    console.log('\n3️⃣ Testing getUserProfile...');
    const retrievedUser = await getUserProfile('test-user-123');
    console.log('✅ Retrieved profile:', retrievedUser?.profile);

    // Test 4: Add profile item
    console.log('\n4️⃣ Testing addProfileItem...');
    const userWithAddedItem = await addProfileItem('test-user-123', 'Loves coding');
    console.log('✅ Added item, profile now:', userWithAddedItem?.profile);

    // Test 5: Remove profile item
    console.log('\n5️⃣ Testing removeProfileItem...');
    const userWithRemovedItem = await removeProfileItem('test-user-123', 'Love for travel');
    console.log('✅ Removed item, profile now:', userWithRemovedItem?.profile);

    // Test 6: Add multiple queries to test profile limit
    console.log('\n6️⃣ Testing addQueryToProfile...');
    await addQueryToProfile('test-user-123', 'Looking for running shoes');
    await addQueryToProfile('test-user-123', 'Need a new laptop for work');
    await addQueryToProfile('test-user-123', 'Want to buy a coffee maker');
    console.log('✅ Added multiple queries to profile');

    // Test 7: Test profile summarization (manual trigger)
    console.log('\n7️⃣ Testing summarizeUserProfile...');
    // Only run if profile has enough items
    const currentUser = await getUserProfile('test-user-123');
    if (currentUser && currentUser.profile.length >= 5) {
      const summarizedUser = await summarizeUserProfile('test-user-123');
      console.log('✅ Profile summarized:', summarizedUser?.profile[0]?.substring(0, 100) + '...');
    } else {
      console.log('⏭️ Skipping summarization - not enough profile items');
    }

    // Test 8: Initialize existing users
    console.log('\n8️⃣ Testing initializeExistingUsers...');
    await initializeExistingUsers();
    console.log('✅ Initialized existing users');

    console.log('\n🎉 All tests passed!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run if called directly
if (require.main === module) {
  testUserAPI();
}

module.exports = { testUserAPI };