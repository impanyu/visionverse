# VisionVerse API Documentation

## Create Vision Endpoint

### Overview
The `create_vision` endpoint allows authenticated users to create and store vision records in MongoDB. This is the primary endpoint for vision creation, handling both data storage and response generation.

### Authentication
All endpoints require authentication via NextAuth.js JWT tokens. Users must be signed in to access these endpoints.

### Endpoints

#### POST `/api/create_vision`
Creates a new vision record in the database.

**Request Body:**
```json
{
  "visionDescription": "string (required) - Description of the vision",
  "filePath": "string (required) - Path to associated file"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Vision created successfully",
  "vision": {
    "id": "string - MongoDB ObjectId as string",
    "userId": "string - User ID from auth token",
    "userName": "string - User name from auth token",
    "userEmail": "string - User email from auth token",
    "visionDescription": "string - Vision description",
    "filePath": "string - File path",
    "createdAt": "string - ISO date string",
    "updatedAt": "string - ISO date string"
  }
}
```

**Error Responses:**
- `401 Unauthorized` - User not authenticated
- `400 Bad Request` - Missing or invalid required fields
- `500 Internal Server Error` - Database or server error

#### GET `/api/create_vision`
Retrieves vision records with optional filtering and pagination.

**Query Parameters:**
- `userId` (optional) - Filter by specific user ID
- `limit` (optional) - Number of records to return (default: 10)
- `skip` (optional) - Number of records to skip for pagination (default: 0)

**Response:**
```json
{
  "success": true,
  "visions": [
    {
      "id": "string",
      "userId": "string",
      "userName": "string",
      "userEmail": "string",
      "visionDescription": "string",
      "filePath": "string",
      "createdAt": "string",
      "updatedAt": "string"
    }
  ],
  "pagination": {
    "total": "number - Total count of matching records",
    "skip": "number - Number of records skipped",
    "limit": "number - Number of records returned",
    "hasMore": "boolean - Whether more records exist"
  }
}
```

### Chat Router Endpoint

#### POST `/api/chat`
Main chat router that analyzes user intent and provides appropriate responses.

**Request Body:**
```json
{
  "messages": "array - Chat message history",
  "system": "string (optional) - System prompt",
  "tools": "object (optional) - Available tools"
}
```

**Response (Vision Creation):**
```json
{
  "type": "vision_creation_ui",
  "message": "I'd love to help you create a vision! Please provide the details below:",
  "ui_components": {
    "title": "Create Your Vision",
    "description": "Describe your vision and optionally upload supporting files",
    "form_fields": [...],
    "submit_button": {
      "text": "Create Vision",
      "endpoint": "/api/create_vision"
    }
  }
}
```

**Response (Regular Chat):**
- Streaming text response for regular conversations

### Setup Instructions

#### 1. Install MongoDB Driver
```bash
npm install mongodb
```

#### 2. Environment Variables
Add the following to your `.env.local` file:
```bash
MONGODB_URI="mongodb://localhost:27017/visionverse"
# or for MongoDB Atlas:
# MONGODB_URI="mongodb+srv://username:password@cluster.mongodb.net/visionverse"
```

#### 3. Database Schema
The application uses a `visions` collection in the `visionverse` database with the following structure:

```typescript
interface VisionDocument {
  _id?: ObjectId;
  userId: string;
  userName: string;
  userEmail: string;
  visionDescription: string;
  filePath: string;
  createdAt: Date;
  updatedAt: Date;
}
```

### Usage Examples

#### Using the API utility functions:

```typescript
import { createVision, getVisions } from "@/lib/api/visions";

// Create a new vision
const newVision = await createVision({
  visionDescription: "A mobile app for tracking fitness goals with AI-powered recommendations",
  filePath: "/uploads/fitness-app-mockup.png"
});

// Get all visions for the current user
const userVisions = await getVisions({
  limit: 10,
  skip: 0
});

// Get visions for a specific user
const specificUserVisions = await getVisions({
  userId: "user123",
  limit: 5,
  skip: 0
});
```

#### Using fetch directly:

```typescript
// Create vision
const response = await fetch("/api/create_vision", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    visionDescription: "My amazing vision",
    filePath: "/path/to/file.jpg"
  }),
});

const result = await response.json();

// Get visions
const getResponse = await fetch("/api/create_vision?limit=10&skip=0");
const visions = await getResponse.json();
```

### System Flow

1. **User Input** → Chat API analyzes intent
2. **If Vision Creation Detected** → Returns vision creation UI
3. **User Fills Form** → Submits directly to `/api/create_vision`
4. **Vision Stored** → MongoDB saves with user metadata
5. **Success Response** → User receives confirmation

### Security Features
- JWT token authentication required
- User context automatically added to records
- Input validation for required fields
- MongoDB injection protection through typed queries
- Error handling with appropriate HTTP status codes

### Error Handling
All endpoints return appropriate HTTP status codes and error messages:
- Authentication errors return 401
- Validation errors return 400 with descriptive messages
- Server errors return 500 with generic error message (detailed errors logged server-side)

### Database Indexes (Recommended)
For better performance, consider adding these indexes to your MongoDB collection:

```javascript
// In MongoDB shell or MongoDB Compass
db.visions.createIndex({ userId: 1, createdAt: -1 });
db.visions.createIndex({ createdAt: -1 });
```

This will optimize queries for user-specific visions and chronological sorting.

### Removed Endpoints

The following endpoints have been removed in the simplified version:
- `/api/show_vision_creation` - No longer needed
- `/api/detect_vision_intent` - Intent detection moved to chat API 