// Amazon Search Service using SearchAPI.io
// Documentation: https://www.searchapi.io/docs/amazon-search

import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface AmazonProduct {
  position: number;
  asin: string;
  title: string;
  link: string;
  price?: string;
  extracted_price?: number;
  original_price?: string;
  extracted_original_price?: number;
  rating?: number;
  reviews?: number;
  thumbnail?: string;
  is_prime?: boolean;
  fulfillment?: {
    standard_delivery?: {
      text: string;
      type: string;
      date: string;
    };
    fastest_delivery?: {
      text: string;
      type: string;
      date: string;
    };
  };
  more_offers?: {
    lowest_price?: string;
    extracted_lowest_price?: number;
    offers_count?: number;
  };
}

export interface AmazonSearchResponse {
  organic_results?: AmazonProduct[];
  pagination?: {
    current_page: number;
    total_pages: number;
    next_page_token?: string;
  };
}

export interface AmazonSearchOptions {
  query: string;
  maxResults?: number;
  sortBy?: 'featured' | 'price_low_to_high' | 'price_high_to_low' | 'average_review' | 'newest_arrivals' | 'bestsellers';
  priceMin?: number;
  priceMax?: number;
  amazonDomain?: string;
  language?: string;
}

class AmazonSearchService {
  private apiKey: string;
  private baseUrl = 'https://www.searchapi.io/api/v1/search';

  constructor() {
    this.apiKey = process.env.SEARCHAPI_KEY || '';
    if (!this.apiKey) {
      console.warn('SEARCHAPI_KEY not found in environment variables');
    }
  }

  async searchProducts(options: AmazonSearchOptions): Promise<AmazonProduct[]> {
    if (!this.apiKey) {
      throw new Error('Amazon Search API key not configured');
    }

    try {
      const params = new URLSearchParams({
        engine: 'amazon_search',
        q: options.query,
        api_key: this.apiKey,
      });

      // Add optional parameters
      if (options.sortBy) {
        params.append('sort_by', options.sortBy);
      }
      if (options.priceMin !== undefined) {
        params.append('price_min', options.priceMin.toString());
      }
      if (options.priceMax !== undefined) {
        params.append('price_max', options.priceMax.toString());
      }
      if (options.amazonDomain) {
        params.append('amazon_domain', options.amazonDomain);
      }
      if (options.language) {
        params.append('language', options.language);
      }

      console.log(`🔍 Amazon Search: "${options.query}"`);
      console.log(`📊 Search params:`, Object.fromEntries(params.entries()));

      const response = await fetch(`${this.baseUrl}?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Amazon Search API error: ${response.status} ${response.statusText}`);
      }

      const data: AmazonSearchResponse = await response.json();
      
      if (!data.organic_results) {
        console.log('📭 No organic results found in Amazon search');
        return [];
      }

      // Limit results to maxResults (default 10)
      const maxResults = options.maxResults || 10;
      const results = data.organic_results.slice(0, maxResults);

      console.log(`✅ Found ${results.length} Amazon products`);
      
      return results;
    } catch (error) {
      console.error('❌ Amazon Search Error:', error);
      throw error;
    }
  }

  // Evaluate product quality based on rating and reviews
  evaluateProductQuality(product: AmazonProduct): {
    score: number;
    reasons: string[];
    isRecommended: boolean;
  } {
    const reasons: string[] = [];
    let score = 0;

    // Rating evaluation (0-40 points)
    if (product.rating) {
      if (product.rating >= 4.5) {
        score += 40;
        reasons.push(`Excellent rating: ${product.rating}★`);
      } else if (product.rating >= 4.0) {
        score += 30;
        reasons.push(`Good rating: ${product.rating}★`);
      } else if (product.rating >= 3.5) {
        score += 20;
        reasons.push(`Average rating: ${product.rating}★`);
      } else {
        score += 5;
        reasons.push(`Low rating: ${product.rating}★`);
      }
    } else {
      reasons.push('No rating available');
    }

    // Review count evaluation (0-30 points)
    if (product.reviews) {
      if (product.reviews >= 1000) {
        score += 30;
        reasons.push(`Many reviews: ${product.reviews}`);
      } else if (product.reviews >= 500) {
        score += 20;
        reasons.push(`Good number of reviews: ${product.reviews}`);
      } else if (product.reviews >= 100) {
        score += 10;
        reasons.push(`Some reviews: ${product.reviews}`);
      } else {
        score += 0;
        reasons.push(`Few reviews: ${product.reviews}`);
      }
    } else {
      reasons.push('No reviews available');
    }

    // Price evaluation (0-20 points)
    if (product.extracted_price !== undefined) {
      if (product.extracted_original_price && product.extracted_original_price > product.extracted_price) {
        const discount = ((product.extracted_original_price - product.extracted_price) / product.extracted_original_price) * 100;
        score += 20;
        reasons.push(`On sale: ${discount.toFixed(0)}% off`);
      } else {
        score += 10;
        reasons.push('Regular pricing');
      }
    }

    // Prime availability (0-10 points)
    if (product.is_prime) {
      score += 10;
      reasons.push('Prime eligible');
    }

    const isRecommended = score >= 60; // Minimum 60/100 for recommendation

    return {
      score,
      reasons,
      isRecommended
    };
  }

  // Generate refined search keywords using AI based on initial results
  async generateRefinedKeywords(originalQuery: string, products: AmazonProduct[]): Promise<string[]> {
    try {
      console.log(`🤖 Generating refined keywords for: "${originalQuery}"`);
      
      // Analyze the current products to understand what was found
      const productAnalysis = products.slice(0, 5).map(p => ({
        title: p.title,
        rating: p.rating,
        reviews: p.reviews,
        price: p.extracted_price,
        isPrime: p.is_prime
      }));

      const prompt = `You are helping refine a product search query to find better results.

Original search: "${originalQuery}"

Current search results analysis:
${productAnalysis.map((p, i) => 
  `${i + 1}. "${p.title}" - Rating: ${p.rating || 'N/A'}★, Reviews: ${p.reviews || 'N/A'}, Price: $${p.price || 'N/A'}, Prime: ${p.isPrime ? 'Yes' : 'No'}`
).join('\n')}

Based on the original intent and current results, generate 1 optimal refined search query that is:
1. More specific and targeted than the current query
2. Natural and organic (not just adding random keywords)
3. Most likely to find better quality or more relevant products
4. Addresses the main weakness you see in current results

Consider factors like:
- If results are too broad, make them more specific
- If results are low quality, focus on premium/quality aspects  
- If results don't match intent, try alternative product categories
- If results are too expensive, try more affordable variations
- If results lack reviews, try more popular product terms

Return ONLY 1 refined search query, no explanation or numbering.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        max_tokens: 200
      });

      const refinementText = response.choices[0]?.message?.content?.trim() || '';
      const refinements = refinementText ? [refinementText] : [];

      console.log(`✅ Generated ${refinements.length} refined keywords:`, refinements);
      
      // If AI returns empty results, try again with a simpler prompt
      if (refinements.length === 0) {
        console.log('⚠️ AI returned no refinements, trying simpler prompt');
        const simpleResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ 
            role: "user", 
            content: `Rewrite this search query to find better products: "${originalQuery}"`
          }],
          temperature: 0.8,
          max_tokens: 50
        });

        const simpleRefinementText = simpleResponse.choices[0]?.message?.content?.trim() || '';
        const simpleRefinements = simpleRefinementText ? [simpleRefinementText] : [];

        if (simpleRefinements.length > 0) {
          console.log(`✅ Fallback AI generated ${simpleRefinements.length} refinements:`, simpleRefinements);
          return simpleRefinements;
        }
      }

      return refinements;
    } catch (error) {
      console.error('❌ Error generating refined keywords:', error);
      console.log('🚫 OpenAI completely unavailable, using generic fallback');
      
      // Only when OpenAI is completely down - very generic fallback
      return [originalQuery]; // Just return the original query
    }
  }
}

export default new AmazonSearchService(); 