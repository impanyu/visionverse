# VisionVerse Utility Scripts

## Clear All Visions Script

The `clear-all-visions.js` script completely removes all visions from both the MongoDB database and the ChromaDB vector database.

### Usage

Run the script using npm:

```bash
npm run clear-visions
```

Or run it directly with Node.js:

```bash
node scripts/clear-all-visions.js
```

### What it does

1. **MongoDB Cleanup:**
   - Connects to your MongoDB database using `MONGODB_URI` from environment variables
   - Counts existing visions in the `visions` collection
   - Deletes all visions from the collection
   - Reports the number of deleted documents

2. **ChromaDB Cleanup:**
   - Connects to your ChromaDB instance using `CHROMA_URL` (defaults to `http://localhost:8000`)
   - Deletes the entire `visions` collection to remove all embeddings
   - Recreates a fresh empty `visions` collection for future use

### Requirements

- Node.js environment with access to your `.env.local` file
- Valid `MONGODB_URI` in your environment variables
- ChromaDB running (optional - script will continue if ChromaDB is not available)

### Safety Notes

⚠️ **Warning: This operation is irreversible!**

- All vision data will be permanently deleted
- All vector embeddings will be permanently deleted
- Make sure you have backups if you need to preserve any data

### Environment Variables

The script requires these environment variables (from `.env.local`):

- `MONGODB_URI` - Connection string to your MongoDB database
- `CHROMA_URL` - URL to your ChromaDB instance (optional, defaults to localhost:8000)

### Output

The script provides detailed console output showing:
- Connection status for both databases
- Number of items found before deletion
- Number of items successfully deleted
- Any errors encountered during the process 