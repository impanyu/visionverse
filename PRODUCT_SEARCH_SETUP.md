# Intelligent Product Search Setup

## Overview

The VisionVerse intelligent product search feature automatically searches Amazon and local products when users enter general queries like "birthday gift for wife" or "wireless headphones".

## Features

✅ **Multi-Source Search**: Searches both Amazon (via SearchAPI.io) and local VisionVerse products  
✅ **Intelligent Refinement**: Up to 3 iterations of keyword refinement for better results  
✅ **Quality Evaluation**: Scores products based on ratings, reviews, pricing, and Prime availability  
✅ **Visual Search Flow**: Shows search steps in connected boxes with result counts  
✅ **Smart Recommendations**: Automatically picks the best product or shows alternatives  

## Environment Setup

### 1. Get SearchAPI.io API Key

1. Visit [SearchAPI.io](https://www.searchapi.io)
2. Sign up for an account
3. Get your API key from the dashboard
4. The service provides access to Amazon Search API with the structure documented at: https://www.searchapi.io/docs/amazon-search

### 2. Add Environment Variable

Add to your `.env.local` file:

```bash
# SearchAPI.io for Amazon product search
SEARCHAPI_KEY=your-searchapi-key-here
```

### 3. Restart Development Server

```bash
npm run dev
```

## Usage

### Default Behavior

When users type queries that don't match specific VisionVerse commands, the system automatically treats them as product searches:

**Triggers Product Search:**
- "birthday gift for wife" 
- "wireless headphones"
- "coffee maker under $100"
- "gift for dad"

**Won't Trigger Product Search (uses other tools):**
- "create a vision" (→ vision creation)
- "list my products" (→ product list)
- "manage my shops" (→ shop management)

### Search Flow

1. **Initial Search**: Searches Amazon + local products with original query
2. **Quality Evaluation**: Scores each product (0-100) based on:
   - ⭐ Rating (4.5★+ = excellent, 4.0★+ = good)
   - 📊 Review count (1000+ = many, 100+ = good)
   - 💰 Pricing (sale price gets bonus points)
   - 🚚 Prime eligibility (bonus points)
3. **Refinement**: If no quality product found, refines keywords and searches again
4. **Recommendation**: Shows best product with quality score and reasoning

### Search Keywords Generation

The system intelligently refines search terms:
- **Quality focus**: "birthday gift for wife" → "birthday gift for wife premium"
- **Specificity**: "birthday gift for wife" → "birthday gift for wife gift box"  
- **Budget**: "birthday gift for wife" → "birthday gift for wife under $50"

## Search Result Display

### Connected Search Flow
- Each search iteration shown in blue boxes
- Arrow connections show refinement flow
- Result counts for Amazon and local products

### Recommended Product Card
- Product image, title, rating, reviews
- Price (with sale price highlighting)
- Quality score with reasoning tags
- Source badge (Amazon/Local)
- Prime eligibility indicator
- Direct link to product

### Alternative Products
- Up to 4 additional options
- Sorted by quality score
- Quick view links

## API Integration

### Amazon Search API (SearchAPI.io)

```typescript
// Example API call structure
const response = await fetch('https://www.searchapi.io/api/v1/search', {
  params: {
    engine: 'amazon_search',
    q: 'birthday gift for wife',
    sort_by: 'average_review',
    api_key: process.env.SEARCHAPI_KEY
  }
});
```

**Supported Parameters:**
- `q`: Search query
- `sort_by`: featured, price_low_to_high, price_high_to_low, average_review, newest_arrivals, bestsellers
- `price_min`/`price_max`: Price range filtering
- `amazon_domain`: amazon.com, amazon.co.uk, etc.

### Local Product Search

Uses existing ChromaDB vector search to find semantically similar products created by VisionVerse users.

## Quality Evaluation System

### Scoring Algorithm (0-100 points)

**Rating (0-40 points):**
- 4.5★+: 40 points (Excellent)
- 4.0★+: 30 points (Good)  
- 3.5★+: 20 points (Average)
- <3.5★: 5 points (Low)

**Reviews (0-30 points):**
- 1000+: 30 points (Many reviews)
- 100+: 20 points (Good number)
- 10+: 10 points (Some reviews)
- <10: 5 points (Few reviews)

**Pricing (0-20 points):**
- On sale: 20 points
- Regular price: 10 points

**Prime (0-10 points):**
- Prime eligible: 10 points

### Recommendation Threshold

Products need **60+ points** to be automatically recommended. Below 60 points, the system will try keyword refinement.

## Testing

### Test Queries

Try these queries to test the system:

```
"birthday gift for wife"
"wireless headphones under $100"  
"coffee maker"
"laptop for gaming"
"gift for dad who likes fishing"
```

### Expected Behavior

1. **Immediate Response**: Product search starts automatically
2. **Loading State**: Shows "Searching for products..." with progress indicators
3. **Search Flow**: Displays search iterations with result counts
4. **Recommendation**: Shows best product with quality evaluation
5. **Alternatives**: Lists additional options

## Troubleshooting

### No Results Found
- Check SEARCHAPI_KEY is set correctly
- Verify API key has sufficient credits
- Try different search terms

### Low Quality Results
- System will automatically refine keywords
- May show "No ideal product found" after 3 iterations
- Still shows best available option

### Local Products Not Found
- Ensure ChromaDB is running on port 8000
- Check MongoDB connection for product data
- Local products need vector embeddings to be searchable

## Cost Considerations

- SearchAPI.io charges per API call
- Each search iteration = 1 API call
- Maximum 3 calls per user query
- Monitor usage in SearchAPI.io dashboard 