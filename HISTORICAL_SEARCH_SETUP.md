# Historical Search Results Feature

This feature stores and utilizes users' historical product search results to improve future search intent analysis.

## Overview

The system now maintains a comprehensive history of all product searches, including:
- User's original search query
- Final selected product with all details (title, price, rating, etc.)
- Search steps and refinements performed
- Search summary and recommendation score

## MongoDB Collection

### Collection Name: `historical_searches`

### Document Structure:
```typescript
{
  _id: ObjectId,
  userId: string,
  userName: string,
  userEmail: string,
  originalQuery: string,
  finalProduct: {
    title: string,
    description?: string,
    price: string,
    extracted_price?: number,
    rating?: number,
    reviews?: number,
    link: string,
    thumbnail?: string,
    source: 'amazon' | 'local' | 'google_shopping',
    asin?: string,
    product_id?: string,
    is_prime?: boolean,
    seller?: string,
    delivery?: string,
    evaluation: {
      score: number,
      reasons: string[],
      isRecommended: boolean
    }
  },
  searchSteps: Array<SearchStep>,
  searchSummary: string,
  createdAt: Date,
  updatedAt: Date
}
```

## How It Works

### 1. Storage Process
- Every time a user successfully finds a product through the intelligent search
- The complete search result is stored in the `historical_searches` collection
- Includes all product details, search steps, and evaluation scores

### 2. Intent Analysis Enhancement
- Before each new search, the system retrieves the user's last searched product
- This information is included in the LLM prompt for intent analysis
- The LLM uses this context to better understand user preferences and patterns

### 3. Prioritization Logic
- **Highest Priority**: Last searched product (most recent behavior)
- **Medium Priority**: Recent historical queries
- **Lowest Priority**: Older historical queries

## Key Benefits

### 🎯 **Improved Search Relevance**
- Future searches are informed by actual purchase decisions
- Better understanding of user's price range preferences
- Category and feature preferences are learned over time

### 📊 **Enhanced User Profiling**
- Tracks evolution of user preferences
- Distinguishes between one-time searches and patterns
- Adapts to changing user behavior over time

### 🔄 **Contextual Refinement**
- Search refinements consider past successful searches
- Reduces unnecessary search iterations
- More targeted product recommendations

## Example Usage Flow

1. **User searches**: "laptop for work"
2. **System retrieves**: Last searched product was "gaming mouse, $80, high-end"
3. **LLM infers**: User might prefer higher-quality tech products
4. **Refined query**: "professional laptop high-performance work"
5. **After selection**: Stores complete search result for future reference

## API Functions

### `storeHistoricalSearchResult(searchData, userId, userName, userEmail)`
Stores a complete search result after successful product selection.

### `getLastSearchedProduct(userId)`
Retrieves the most recent product search result for a user.

### `getHistoricalSearchResults(userId, limit, skip)`
Retrieves paginated historical search results for analytics or user dashboard.

## Privacy & Data Management

- Historical searches are tied to user accounts
- Data is used only for improving search experience
- Users maintain control over their search history
- Automatic cleanup policies can be implemented if needed

## Future Enhancements

- User dashboard to view search history
- Export/delete historical data functionality
- Advanced analytics and preference insights
- Collaborative filtering based on similar users' searches 