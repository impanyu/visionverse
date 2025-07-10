# Vector Database Setup Guide

This guide explains how to set up and use the vector database functionality in VisionVerse.

## Overview

VisionVerse now includes **semantic search** capabilities using:
- **Chroma** - Open source vector database (completely free)
- **OpenAI Embeddings** - For creating vector representations of vision descriptions
- **MongoDB** - Stores the vector IDs alongside vision documents

## Features

### ✅ **Automatic Embedding Storage**
- When users create visions (via form or direct creation), embeddings are automatically generated
- Both the form-based creation and the `create_vision_direct` tool store vectors

### ✅ **Semantic Search** 
- Users can search their visions by meaning, not just keywords
- Example: Search "fitness app" to find visions about "health tracking mobile application"
- Results are ranked by semantic similarity

### ✅ **User Isolation**
- Each user only sees their own vectors and search results
- Full privacy and data separation

### ✅ **Tool Integration**
- `create_vision_direct`: Creates vision + stores embedding automatically
- `create_vision_form`: Form-based creation with file upload + embedding storage  
- `list_my_visions`: Lists all user visions
- `search_my_visions`: Semantic search through user's visions

## Prerequisites

1. **Python 3.9+** (for Chroma server)
2. **OpenAI API Key** (for embeddings)
3. **MongoDB** (already required)

## Installation Steps

### 1. Install Chroma Server

```bash
# Install Chroma via pip
pip3 install chromadb

# Start Chroma server
export PATH="/Users/$(whoami)/Library/Python/3.9/bin:$PATH"
chroma run --host localhost --port 8000
```

The server will run at `http://localhost:8000`

### 2. Environment Variables

Add to your `.env.local`:

```env
# OpenAI API (for vector embeddings)
OPENAI_API_KEY=your-openai-api-key-here

# MongoDB (already configured)
MONGODB_URI=mongodb://localhost:27017/visionverse
```

### 3. Node.js Dependencies

The required packages are already installed:
- `chromadb` - Chroma client
- `mongodb` - MongoDB driver

## How It Works

### 1. Vision Creation with Embeddings

**Both creation methods** now store embeddings automatically:

#### Direct Creation Tool
```typescript
// User says: "Create a fitness tracking app"
// Result: Vision + embedding stored automatically
```

#### Form-Based Creation  
```typescript
// User fills form with description + file upload
// Result: Vision + file + embedding stored automatically
```

### 2. Semantic Search

Users can search their visions by meaning:

```typescript
// User asks: "Find my fitness apps" or "search workout tracking" 
// Result: Shows all semantically similar visions with scores
```

### 3. Vector Management

- **Automatic Storage**: Embeddings created when visions are saved
- **User Isolation**: Search only within user's own vectors  
- **Deletion Support**: Vectors removed when visions are deleted
- **Metadata**: Stores user ID, vision ID, creation date

## API Endpoints

### Create Vision with Embeddings
```
POST /api/create_vision
```
- Automatically stores embeddings for both JSON and FormData requests
- Returns vision with `vectorId` field

### Search Similar Visions
```
POST /api/search_visions
Body: { "query": "search text", "limit": 10 }
```
- Returns similar visions with similarity scores
- Filtered by current user

## Assistant Integration

Users can interact naturally:

### **Create Visions**
- *"Create a mobile app for fitness tracking"* → `create_vision_direct` tool
- *"I want to create something"* → `create_vision_form` tool

### **List Visions**  
- *"Show my visions"* → `list_my_visions` tool
- *"What have I created?"* → `list_my_visions` tool

### **Search Visions**
- *"Find my fitness apps"* → `search_my_visions` tool  
- *"Search for mobile applications"* → `search_my_visions` tool
- *"Show me anything about tracking"* → `search_my_visions` tool

## Testing

### Test Vector Database
Visit: `http://localhost:3000/test-vector`

This page allows you to:
- Test semantic search functionality
- View similarity scores  
- Verify vector database integration

### Test Assistant Tools
Visit: `http://localhost:3000/`

Try these phrases:
- *"Create a social media app"* (tests direct creation + embedding)
- *"Show my visions"* (tests listing)
- *"Find apps I've created"* (tests search)

## Cost Considerations

- **Chroma**: Completely free (open source, runs locally)
- **OpenAI Embeddings**: ~$0.0001 per 1K tokens (text-embedding-3-small)
- **Storage**: Local files and MongoDB (no cloud costs)

## Architecture Benefits

1. **Semantic Search**: Find similar visions by meaning, not just keywords
2. **User Privacy**: All vectors are isolated by user ID  
3. **Scalable**: Chroma can handle millions of vectors
4. **Deletion Support**: Vectors can be removed by ID when visions are deleted
5. **Free**: No ongoing cloud costs for vector storage
6. **Automatic**: No manual work required - embeddings created automatically

## Troubleshooting

### Chroma Server Issues
```bash
# Check if Chroma is running
curl http://localhost:8000

# Check process
ps aux | grep chroma

# Restart Chroma server
pkill -f chroma
export PATH="/Users/$(whoami)/Library/Python/3.9/bin:$PATH"
chroma run --host localhost --port 8000
```

### OpenAI API Issues
- Verify `OPENAI_API_KEY` in `.env.local`
- Check API quotas at platform.openai.com
- Test with: `curl -H "Authorization: Bearer $OPENAI_API_KEY" https://api.openai.com/v1/models`

### Vector Sync Issues
- Vectors are automatically created when visions are saved
- If vectors are missing, re-create the visions
- Check Chroma logs for embedding errors
- Check browser console for API errors

### Search Not Working
- Ensure Chroma server is running on port 8000
- Check if OpenAI API key is configured
- Verify user has created visions with descriptions
- Check network logs in browser developer tools

## Future Enhancements

Potential improvements:
1. **Batch Processing**: Create embeddings for existing visions in bulk
2. **Alternative Models**: Use local embedding models (no API costs)  
3. **Advanced Search**: Filter by date, file type, tags
4. **Recommendations**: "You might also like" based on vectors
5. **Search Analytics**: Track popular search terms
6. **Export/Import**: Backup and restore vector collections 