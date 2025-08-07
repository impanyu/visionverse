# User Collection Setup

## Overview
This document describes the new `users` collection in MongoDB that stores user profiles.

## Collection Structure

### Database: `visionverse`
### Collection: `users`

## Document Schema

```typescript
interface User {
  _id?: string;
  userId: string;      // NextAuth user ID (unique)
  userName: string;    // User's display name
  userEmail: string;   // User's email address
  profile: string[];   // User profile (array of strings)
  createdAt: Date;     // When user profile was created
  updatedAt: Date;     // When profile was last updated
}
```

## API Endpoints

### GET `/api/user/profile`
- **Purpose**: Get current user's profile
- **Authentication**: Required (NextAuth JWT)
- **Returns**: User profile data
- **Auto-creates**: User profile if it doesn't exist

### PUT `/api/user/profile`
- **Purpose**: Replace current user's entire profile array
- **Authentication**: Required (NextAuth JWT)
- **Body**: `{ "profile": ["string1", "string2", "string3"] }`
- **Returns**: Updated user profile data

### POST `/api/user/profile/add`
- **Purpose**: Add a single item to user's profile array
- **Authentication**: Required (NextAuth JWT)
- **Body**: `{ "profileItem": "new profile item" }`
- **Returns**: Updated user profile data
- **Note**: Uses `$addToSet` to prevent duplicates

### POST `/api/user/profile/remove`
- **Purpose**: Remove a single item from user's profile array
- **Authentication**: Required (NextAuth JWT)
- **Body**: `{ "profileItem": "item to remove" }`
- **Returns**: Updated user profile data

### POST `/api/user/initialize`
- **Purpose**: Initialize profiles for all existing users
- **Authentication**: Required (NextAuth JWT)
- **Use**: One-time migration for existing users
- **Process**: Scans `historical_searches` collection and creates user profiles

## Features

### 1. Automatic User Creation
- User profiles are automatically created when users interact with the system
- Integration in `/api/chat` route ensures all users get profiles
- No manual user registration required

### 2. Existing User Migration
- `initializeExistingUsers()` function migrates existing users
- Scans `historical_searches` collection for user data
- Creates profiles for users who don't have them

### 3. Profile Management
- Array-based profile system for multiple profile items
- Add/remove individual items without replacing entire profile
- Duplicate prevention with MongoDB `$addToSet`
- Easy to extend with additional fields
- Automatic timestamp management

### 4. Intelligent Query Tracking
- **Automatic Query Addition**: Every search query is automatically added to user's profile
- **Refresh Query Tracking**: Search refreshes also append queries to profile
- **Profile Growth**: User interests and patterns build over time

### 5. AI-Powered Profile Summarization
- **Automatic Trigger**: When profile reaches 100 items, AI summarization is triggered
- **Smart Analysis**: Uses OpenAI GPT-4 to analyze user patterns and preferences
- **Behavior Insights**: Identifies demographics, interests, shopping patterns, and trends
- **Temporal Awareness**: Recent patterns override older contradictory patterns
- **Compact Summary**: 100+ items condensed into one comprehensive summary (max 1000 words)
- **Profile Reset**: Summary becomes first item, all other items removed

### 6. Personalized AI Context
- **Chat Personalization**: User profile context is added to AI conversations
- **Gemini Integration**: Search recommendations use profile context for better results
- **Adaptive Responses**: AI provides more relevant suggestions based on user history

## Usage Examples

### Frontend Usage (JavaScript)
```javascript
// Get user profile
const response = await fetch('/api/user/profile');
const { user } = await response.json();
console.log('User profile array:', user.profile);

// Replace entire profile array
const updateResponse = await fetch('/api/user/profile', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    profile: ['Interest in technology', 'Love for travel', 'Coffee enthusiast'] 
  })
});

// Add single profile item
const addResponse = await fetch('/api/user/profile/add', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ profileItem: 'Loves photography' })
});

// Remove single profile item
const removeResponse = await fetch('/api/user/profile/remove', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ profileItem: 'Love for travel' })
});
```

### Backend Usage (Node.js)
```javascript
import { 
  createOrGetUser, 
  updateUserProfile, 
  getUserProfile, 
  addProfileItem, 
  removeProfileItem,
  addQueryToProfile,
  summarizeUserProfile
} from '@/lib/user-db';

// Create or get user (creates with empty profile array)
const user = await createOrGetUser(userId, userName, userEmail);

// Replace entire profile array
await updateUserProfile(userId, ['Interest 1', 'Interest 2', 'Interest 3']);

// Add single profile item (prevents duplicates)
await addProfileItem(userId, 'New interest');

// Remove single profile item
await removeProfileItem(userId, 'Old interest');

// Add search query to profile (with auto-summarization at 100 items)
await addQueryToProfile(userId, 'Looking for wireless headphones');

// Manually trigger profile summarization
await summarizeUserProfile(userId);

// Get profile
const userProfile = await getUserProfile(userId);
console.log('Profile items:', userProfile?.profile);
```

## Integration Points

### 1. Chat API (`/api/chat`)
- **Profile Creation**: Automatically creates user profiles on first interaction
- **Query Tracking**: Every search query is automatically added to user profile
- **Profile Context**: User profile is injected into AI conversation context
- **Gemini Integration**: Profile context enhances product/service recommendations
- **Non-blocking**: Profile operations don't fail chat if there are errors

### 2. Authentication Flow
- Leverages NextAuth.js for user identification
- Uses JWT tokens to extract user information
- No separate user registration process needed

### 3. Existing Collections
- Links to existing collections via `userId` field
- Compatible with `products`, `services`, `visions`, `historical_searches`
- Maintains data integrity across collections

## Migration Notes

### For New Installations
- User profiles are created automatically
- No manual migration needed

### For Existing Installations
1. Run the initialization endpoint: `POST /api/user/initialize`
2. This creates profiles for all existing users
3. Future users are created automatically

## Database Indexes

Recommended indexes for optimal performance:
```javascript
// Unique index on userId
db.users.createIndex({ "userId": 1 }, { unique: true })

// Index on email for lookups
db.users.createIndex({ "userEmail": 1 })
```

## Security

- All endpoints require NextAuth.js authentication
- User can only access/modify their own profile
- No admin endpoints for user management (yet)
- Profile data is not encrypted (consider for sensitive data)
- Array items are stored as plain strings
- No validation on individual profile item content

## Future Enhancements

Potential future additions:
- User preferences/settings
- Profile pictures/avatars
- User roles and permissions
- Privacy settings
- Profile sharing/visibility controls
- Profile item categories/tags
- Profile item validation/sanitization
- Profile item search/filtering
- Bulk profile operations