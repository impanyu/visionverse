import clientPromise from './mongodb';
import { User, UserDocument } from '@/types/user';

const DATABASE_NAME = 'visionverse';
const COLLECTION_NAME = 'users';

/**
 * Get the users collection
 */
async function getUsersCollection() {
  const client = await clientPromise;
  const db = client.db(DATABASE_NAME);
  return db.collection<UserDocument>(COLLECTION_NAME);
}

/**
 * Create or get user profile
 * @param userId - NextAuth user ID
 * @param userName - User name from NextAuth
 * @param userEmail - User email from NextAuth
 * @returns Promise<UserDocument> - The user document
 */
export async function createOrGetUser(
  userId: string,
  userName: string,
  userEmail: string
): Promise<UserDocument> {
  try {
    console.log(`👤 Creating or getting user profile for: ${userId}`);
    
    const collection = await getUsersCollection();
    
    // Try to find existing user
    const existingUser = await collection.findOne({ userId });
    
    if (existingUser) {
      console.log(`✅ Found existing user profile for: ${userId}`);
      return existingUser;
    }
    
    // Create new user with default empty profile array
    const newUser: User = {
      userId,
      userName,
      userEmail,
      profile: [], // Default empty profile array
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const result = await collection.insertOne(newUser as UserDocument);
    const createdUser = await collection.findOne({ _id: result.insertedId });
    
    if (!createdUser) {
      throw new Error('Failed to retrieve created user');
    }
    
    console.log(`✅ Created new user profile for: ${userId}`);
    return createdUser;
    
  } catch (error) {
    console.error('❌ Error creating or getting user:', error);
    throw error;
  }
}

/**
 * Update user profile
 * @param userId - NextAuth user ID
 * @param profile - New profile array of strings
 * @returns Promise<UserDocument | null> - Updated user document
 */
export async function updateUserProfile(
  userId: string,
  profile: string[]
): Promise<UserDocument | null> {
  try {
    console.log(`📝 Updating user profile for: ${userId}`);
    
    const collection = await getUsersCollection();
    
    const result = await collection.findOneAndUpdate(
      { userId },
      { 
        $set: { 
          profile,
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      console.log(`⚠️ User not found for profile update: ${userId}`);
      return null;
    }
    
    console.log(`✅ Updated user profile for: ${userId}`);
    return result;
    
  } catch (error) {
    console.error('❌ Error updating user profile:', error);
    throw error;
  }
}

/**
 * Get user profile
 * @param userId - NextAuth user ID
 * @returns Promise<UserDocument | null> - User document
 */
export async function getUserProfile(userId: string): Promise<UserDocument | null> {
  try {
    const collection = await getUsersCollection();
    return await collection.findOne({ userId });
  } catch (error) {
    console.error('❌ Error getting user profile:', error);
    throw error;
  }
}

/**
 * Add profile item to user's profile array
 * @param userId - NextAuth user ID
 * @param profileItem - New profile item to add
 * @returns Promise<UserDocument | null> - Updated user document
 */
export async function addProfileItem(
  userId: string,
  profileItem: string
): Promise<UserDocument | null> {
  try {
    console.log(`➕ Adding profile item for user: ${userId}`);
    
    const collection = await getUsersCollection();
    
    // First check the current profile structure
    const existingUser = await collection.findOne({ userId });
    
    if (existingUser && typeof existingUser.profile === 'string') {
      // Convert old string profile to array format
      const oldProfile = existingUser.profile;
      const newProfile = oldProfile ? [oldProfile, profileItem] : [profileItem];
      
      const result = await collection.findOneAndUpdate(
        { userId },
        { 
          $set: { 
            profile: newProfile,
            updatedAt: new Date()
          }
        },
        { returnDocument: 'after' }
      );
      
      console.log(`🔄 Converted string profile to array for user: ${userId}`);
      return result;
    }
    
    // Normal array operation
    const result = await collection.findOneAndUpdate(
      { userId },
      { 
        $addToSet: { profile: profileItem }, // Add to array if not already present
        $set: { updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      console.log(`⚠️ User not found for profile item addition: ${userId}`);
      return null;
    }
    
    console.log(`✅ Added profile item for: ${userId}`);
    return result;
    
  } catch (error) {
    console.error('❌ Error adding profile item:', error);
    throw error;
  }
}

/**
 * Remove profile item from user's profile array
 * @param userId - NextAuth user ID
 * @param profileItem - Profile item to remove
 * @returns Promise<UserDocument | null> - Updated user document
 */
export async function removeProfileItem(
  userId: string,
  profileItem: string
): Promise<UserDocument | null> {
  try {
    console.log(`➖ Removing profile item for user: ${userId}`);
    
    const collection = await getUsersCollection();
    
    const result = await collection.findOneAndUpdate(
      { userId },
      { 
        $pull: { profile: profileItem }, // Remove from array
        $set: { updatedAt: new Date() }
      },
      { returnDocument: 'after' }
    );
    
    if (!result) {
      console.log(`⚠️ User not found for profile item removal: ${userId}`);
      return null;
    }
    
    console.log(`✅ Removed profile item for: ${userId}`);
    return result;
    
  } catch (error) {
    console.error('❌ Error removing profile item:', error);
    throw error;
  }
}

/**
 * Add query to user's profile and manage profile size
 * @param userId - NextAuth user ID
 * @param query - Search query to add
 * @returns Promise<UserDocument | null> - Updated user document
 */
export async function addQueryToProfile(
  userId: string,
  query: string
): Promise<UserDocument | null> {
  try {
    console.log(`🔍 Adding query to profile for user: ${userId}`);
    
    // First, add the query to the profile
    const updatedUser = await addProfileItem(userId, query.trim());
    
    if (!updatedUser) {
      console.log(`⚠️ User not found for query addition: ${userId}`);
      return null;
    }
    
    // Check if profile has reached the limit (100 items)
    if (updatedUser.profile.length >= 100) {
      console.log(`📊 Profile limit reached for user ${userId}. Triggering summarization...`);
      
      // Trigger profile summarization
      const summarizedUser = await summarizeUserProfile(userId);
      return summarizedUser || updatedUser;
    }
    
    return updatedUser;
    
  } catch (error) {
    console.error('❌ Error adding query to profile:', error);
    throw error;
  }
}

/**
 * Summarize user profile using AI when it exceeds 100 items
 * @param userId - NextAuth user ID
 * @returns Promise<UserDocument | null> - Updated user document with summarized profile
 */
export async function summarizeUserProfile(userId: string): Promise<UserDocument | null> {
  try {
    console.log(`🤖 Starting AI profile summarization for user: ${userId}`);
    
    const collection = await getUsersCollection();
    const user = await collection.findOne({ userId });
    
    if (!user || user.profile.length === 0) {
      console.log(`⚠️ No profile found for summarization: ${userId}`);
      return null;
    }
    
    // Use OpenAI to summarize the profile
    const { default: OpenAI } = await import('openai');
    const openai = new OpenAI({ 
      apiKey: process.env.OPENAI_API_KEY 
    });
    
    const profileItems = user.profile;
    console.log(`📝 Summarizing ${profileItems.length} profile items for user: ${userId}`);
    
    const prompt = `You are an expert user profiler. Analyze the following list of user search queries and activities to create a comprehensive user profile summary.

INSTRUCTIONS:
1. Identify and ONLY extract key user characteristics: gender, age, lifestyle, family status, marital status, occupation, income, education, location, friends, pets, social relationships, health condition, height, weight, height, weight, physical condition, income, financial status, psychological condition, etc.
2. ignore any user's activities or plans or behaviors in the summary!!!
3. newer information should override older information
4. summarize the user's profile which contains those key characteristics
5. Keep the summary under 1000 words

USER SEARCH HISTORY (most recent last):
${profileItems.map((item, index) => `${index + 1}. ${item}`).join('\n')}

Create a comprehensive user profile summary that captures:
- Demographic information (if available)
- Key characteristics that define this user

Output ONLY the summary text, no additional formatting:`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 2000
    });

    const summary = response.choices[0]?.message?.content?.trim();
    
    if (!summary) {
      console.error('❌ Failed to generate profile summary');
      return null;
    }
    
    console.log(`✅ Generated profile summary (${summary.length} chars)`);
    
    // Replace profile with summary as first item
    const result = await collection.findOneAndUpdate(
      { userId },
      { 
        $set: { 
          profile: [summary], // Summary becomes the only item
          updatedAt: new Date()
        }
      },
      { returnDocument: 'after' }
    );
    
    if (result) {
      console.log(`✅ Profile summarized and updated for user: ${userId}`);
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Error summarizing user profile:', error);
    throw error;
  }
}

/**
 * Initialize existing users - creates user profiles for users who don't have them
 * This ensures all existing users in other collections get user profiles
 */
export async function initializeExistingUsers(): Promise<void> {
  try {
    console.log('🔄 Initializing existing users...');
    
    const client = await clientPromise;
    const db = client.db(DATABASE_NAME);
    
    // Get all unique users from historical_searches collection
    const historicalSearches = db.collection('historical_searches');
    const existingUsers = await historicalSearches.aggregate([
      {
        $group: {
          _id: '$userId',
          userName: { $first: '$userName' },
          userEmail: { $first: '$userEmail' }
        }
      }
    ]).toArray();
    
    console.log(`📊 Found ${existingUsers.length} existing users in historical_searches`);
    
    // Create user profiles for each existing user
    for (const user of existingUsers) {
      if (user._id && user.userName && user.userEmail) {
        await createOrGetUser(user._id, user.userName, user.userEmail);
      }
    }
    
    console.log('✅ Existing users initialization complete');
    
  } catch (error) {
    console.error('❌ Error initializing existing users:', error);
    throw error;
  }
}