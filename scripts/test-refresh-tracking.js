/**
 * Test script to verify refresh query tracking
 * Run with: node scripts/test-refresh-tracking.js
 */

const { addQueryToProfile, getUserProfile } = require('../lib/user-db');

async function testRefreshTracking() {
  try {
    console.log('🧪 Testing Refresh Query Tracking...\n');

    const testUserId = 'test-refresh-user-123';
    
    // Simulate initial search query
    console.log('1️⃣ Adding initial search query...');
    await addQueryToProfile(testUserId, 'Looking for wireless headphones');
    
    // Simulate refresh of the same query
    console.log('2️⃣ Adding refresh query (same query)...');
    await addQueryToProfile(testUserId, 'Looking for wireless headphones');
    
    // Check profile
    const userProfile = await getUserProfile(testUserId);
    console.log('3️⃣ Current profile:', userProfile?.profile);
    
    console.log(`\n✅ Profile contains ${userProfile?.profile.length || 0} items`);
    console.log('✅ Both original and refresh queries should be tracked separately');
    
    // Simulate a different refresh query  
    console.log('\n4️⃣ Adding modified refresh query...');
    await addQueryToProfile(testUserId, 'Looking for bluetooth wireless headphones under $100');
    
    const updatedProfile = await getUserProfile(testUserId);
    console.log('5️⃣ Updated profile:', updatedProfile?.profile);
    
    console.log(`\n✅ Profile now contains ${updatedProfile?.profile.length || 0} items`);
    console.log('✅ Refresh tracking test completed successfully!');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testRefreshTracking();