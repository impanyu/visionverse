// Product Search Service using SearchAPI.io
// Amazon Search Documentation: https://www.searchapi.io/docs/amazon-search
// Google Shopping Documentation: https://www.searchapi.io/docs/google-shopping
// Google Product Offers Documentation: https://www.searchapi.io/docs/google-product-offers

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

// Google Shopping interfaces
export interface GoogleShoppingProduct {
  position: number;
  product_id: string;
  title: string;
  product_link: string;
  seller?: string;
  offers?: string;
  extracted_offers?: number;
  offers_link?: string;
  price?: string;
  extracted_price?: number;
  original_price?: string;
  extracted_original_price?: number;
  rating?: number;
  reviews?: number;
  delivery?: string;
  thumbnail?: string;
  tag?: string;
}

export interface GoogleProductOffer {
  position: number;
  seller: string;
  seller_link?: string;
  link?: string;
  price: string;
  extracted_price: number;
  original_price?: string;
  extracted_original_price?: number;
  delivery?: string;
  rating?: number;
  reviews?: number;
  seller_rating?: number;
  seller_reviews?: number;
  price_per_unit?: string;
  extracted_price_per_unit?: number;
  total_price?: string;
  extracted_total_price?: number;
}

export interface GoogleShoppingResponse {
  shopping_results?: GoogleShoppingProduct[];
  pagination?: {
    current_page: number;
    total_pages: number;
  };
}

export interface GoogleProductOffersResponse {
  offers?: GoogleProductOffer[];
  product_info?: {
    title: string;
    reviews?: number;
    rating?: number;
    thumbnail?: string;
  };
}

// Unified product interface that combines Amazon and Google Shopping products
export interface UnifiedProduct {
  position: number;
  title: string;
  link: string;
  price?: string;
  extracted_price?: number;
  original_price?: string;
  extracted_original_price?: number;
  rating?: number;
  reviews?: number;
  thumbnail?: string;
  source: 'amazon' | 'google_shopping';
  // Amazon specific
  asin?: string;
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
  // Google Shopping specific
  product_id?: string;
  seller?: string;
  delivery?: string;
  tag?: string;
}

export interface ProductSearchOptions {
  query: string;
  maxResults?: number;
  sortBy?: 'featured' | 'price_low_to_high' | 'price_high_to_low' | 'average_review' | 'newest_arrivals' | 'bestsellers';
  priceMin?: number;
  priceMax?: number;
  includeAmazon?: boolean;
  includeGoogleShopping?: boolean;
}

// Legacy interface for backward compatibility
export interface AmazonSearchOptions extends ProductSearchOptions {}

class ProductSearchService {
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

      console.log(`🔍 Amazon Search: "${options.query}"`);
      console.log(`📊 Search params:`, Object.fromEntries(params.entries()));

      const response = await fetch(`${this.baseUrl}?${params.toString()}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ SearchAPI.io Error Details:`, {
          status: response.status,
          statusText: response.statusText,
          url: `${this.baseUrl}?${params.toString()}`,
          response: errorText
        });
        throw new Error(`Amazon Search API error: ${response.status} ${response.statusText} - ${errorText}`);
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

  async searchGoogleShopping(options: ProductSearchOptions): Promise<GoogleShoppingProduct[]> {
    if (!this.apiKey) {
      throw new Error('SearchAPI key not configured');
    }

    try {
      const params = new URLSearchParams({
        engine: 'google_shopping',
        q: options.query,
        api_key: this.apiKey,
        gl: 'us',
        hl: 'en',
      });

      // Add optional parameters
      if (options.priceMin !== undefined) {
        params.append('price_min', options.priceMin.toString());
      }
      if (options.priceMax !== undefined) {
        params.append('price_max', options.priceMax.toString());
      }

      console.log(`🛒 Google Shopping Search: "${options.query}"`);
      console.log(`📊 Search params:`, Object.fromEntries(params.entries()));

      const response = await fetch(`${this.baseUrl}?${params.toString()}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Google Shopping Error Details:`, {
          status: response.status,
          statusText: response.statusText,
          url: `${this.baseUrl}?${params.toString()}`,
          response: errorText
        });
        throw new Error(`Google Shopping API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data: GoogleShoppingResponse = await response.json();
      
      if (!data.shopping_results) {
        console.log('📭 No shopping results found in Google Shopping search');
        return [];
      }

      // Limit results to maxResults (default 10)
      const maxResults = options.maxResults || 10;
      const results = data.shopping_results.slice(0, maxResults);

      console.log(`✅ Found ${results.length} Google Shopping products`);
      
      return results;
    } catch (error) {
      console.error('❌ Google Shopping Search Error:', error);
      throw error;
    }
  }

  async getProductOffers(productId: string): Promise<GoogleProductOffer[]> {
    if (!this.apiKey) {
      throw new Error('SearchAPI key not configured');
    }

    try {
      const params = new URLSearchParams({
        engine: 'google_product_offers',
        product_id: productId,
        api_key: this.apiKey,
        gl: 'us',
        hl: 'en',
      });

      console.log(`🏪 Fetching offers for product ID: ${productId}`);

      const response = await fetch(`${this.baseUrl}?${params.toString()}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Google Product Offers Error Details:`, {
          status: response.status,
          statusText: response.statusText,
          url: `${this.baseUrl}?${params.toString()}`,
          response: errorText
        });
        throw new Error(`Google Product Offers API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data: GoogleProductOffersResponse = await response.json();
      
      if (!data.offers) {
        console.log(`📭 No offers found for product ID: ${productId}`);
        console.log(`🔍 Full API response:`, JSON.stringify(data, null, 2));
        return [];
      }

      console.log(`✅ Found ${data.offers.length} offers for product ${productId}`);
      
      // Debug: Log first few offers to see what data we're getting
      if (data.offers.length > 0) {
        console.log(`🔍 Sample offer data for ${productId}:`, JSON.stringify(data.offers.slice(0, 2), null, 2));
      } else {
        console.log(`⚠️ Offers array is empty for product ${productId}`);
        console.log(`🔍 Full API response:`, JSON.stringify(data, null, 2));
      }
      
      return data.offers;
    } catch (error) {
      console.error(`❌ Product Offers Error for ${productId}:`, error);
      return []; // Return empty array instead of throwing to not break the search flow
    }
  }

  // Convert Google Shopping product to unified format
  private convertGoogleShoppingToUnified(product: GoogleShoppingProduct, offers: GoogleProductOffer[] = []): UnifiedProduct[] {
    console.log(`🔄 Converting Google product: "${product.title}"`);
    console.log(`📝 Base product data:`, {
      seller: product.seller,
      product_link: product.product_link,
      offers_link: product.offers_link,
      extracted_offers: product.extracted_offers
    });
    
    const baseProduct: UnifiedProduct = {
      position: product.position,
      title: product.title,
      link: product.product_link,
      price: product.price,
      extracted_price: product.extracted_price,
      original_price: product.original_price,
      extracted_original_price: product.extracted_original_price,
      rating: product.rating,
      reviews: product.reviews,
      thumbnail: product.thumbnail,
      source: 'google_shopping',
      product_id: product.product_id,
      seller: product.seller,
      delivery: product.delivery,
      tag: product.tag,
    };

    // If no offers, return just the base product (but use offers_link if available)
    if (offers.length === 0) {
      return [baseProduct];
    }

    // Convert each offer to a separate product
    return offers.map((offer, index) => {
      // Priority:link > product_link do not change offer.link, it is correct!!!
      const finalLink = offer.link || baseProduct.link;
      
      console.log(`🔗 Offer ${index + 1} for "${product.title}":`);
      console.log(`   seller_link: ${offer.seller_link || 'N/A'}`);
      console.log(`   offers_link: ${product.offers_link || 'N/A'}`);
      console.log(`   final_link: ${finalLink}`);
      console.log(`   seller: ${offer.seller || 'N/A'}`);
      
      return {
        ...baseProduct,
        position: product.position + index * 0.1, // Slight position adjustment to maintain order
        link: finalLink, // Use best available link
        price: offer.price,
        extracted_price: offer.extracted_price,
        original_price: offer.original_price,
        extracted_original_price: offer.extracted_original_price,
        seller: offer.seller,
        delivery: offer.delivery,
        rating: offer.rating || baseProduct.rating,
        reviews: offer.reviews || baseProduct.reviews,
      };
    });
  }

  // Convert Amazon product to unified format
  private convertAmazonToUnified(product: AmazonProduct): UnifiedProduct {
    return {
      position: product.position,
      title: product.title,
      link: product.link,
      price: product.price,
      extracted_price: product.extracted_price,
      original_price: product.original_price,
      extracted_original_price: product.extracted_original_price,
      rating: product.rating,
      reviews: product.reviews,
      thumbnail: product.thumbnail,
      source: 'amazon',
      asin: product.asin,
      is_prime: product.is_prime,
      fulfillment: product.fulfillment,
      more_offers: product.more_offers,
    };
  }

  // Search Amazon products and convert to unified format
  async searchAmazonProducts(options: ProductSearchOptions): Promise<UnifiedProduct[]> {
    try {
      const amazonProducts = await this.searchProducts(options);
      const unifiedProducts = amazonProducts.map(product => this.convertAmazonToUnified(product));
      console.log(`🛒 Amazon: Fetched ${amazonProducts.length} products (limit: ${options.maxResults || 'unlimited'})`);
      return unifiedProducts;
    } catch (error) {
      console.error('❌ Amazon search failed:', error);
      return [];
    }
  }

  // Search Google Shopping products with offers and convert to unified format
  async searchGoogleShoppingProducts(options: ProductSearchOptions): Promise<UnifiedProduct[]> {
    try {
      const googleProducts = await this.searchGoogleShopping(options);
      const allUnifiedProducts: UnifiedProduct[] = [];
      
              // For each Google Shopping product, fetch its offers and convert to unified format
        for (const googleProduct of googleProducts) {
          console.log(`🔍 Processing Google product: "${googleProduct.title}" (ID: ${googleProduct.product_id})`);
          console.log(`🔍 Base product seller: ${googleProduct.seller || 'N/A'}`);
          
          const offers = await this.getProductOffers(googleProduct.product_id);
          console.log(`📊 Offers received: ${offers.length} offers`);
          
          if (offers.length === 0) {
            console.log(`⚠️ No offers found for "${googleProduct.title}" - will show as single product with seller: ${googleProduct.seller || 'N/A'}`);
          } else {
            console.log(`✅ Found ${offers.length} offers for "${googleProduct.title}" - will split into individual products:`);
            offers.forEach((offer, i) => {
              console.log(`   ${i + 1}. ${offer.seller || 'Unknown seller'} - $${offer.extracted_price || offer.price || 'N/A'}`);
            });
          }
          
          const unifiedProducts = this.convertGoogleShoppingToUnified(googleProduct, offers);
          allUnifiedProducts.push(...unifiedProducts);
          console.log(`✅ Created ${unifiedProducts.length} unified products from this Google product`);
          
          // Debug: Log the resulting products
          unifiedProducts.forEach((product, i) => {
            console.log(`   Product ${i + 1}: "${product.title}" - Seller: ${product.seller || 'N/A'} - Price: $${product.extracted_price || 'N/A'}`);
          });
        }
      
      console.log(`🛒 Google Shopping: Fetched ${googleProducts.length} base products (limit: ${options.maxResults || 'unlimited'}), expanded to ${allUnifiedProducts.length} total products`);
      return allUnifiedProducts;
    } catch (error) {
      console.error('❌ Google Shopping search failed:', error);
      return [];
    }
  }

  // Calculate optimal search limits for each source
  private calculateSearchLimits(maxResults: number, includeAmazon: boolean, includeGoogleShopping: boolean): {
    amazonLimit: number;
    googleShoppingLimit: number;
  } {
    if (includeAmazon && includeGoogleShopping) {
      // Split budget: 60% Amazon, 40% Google Shopping (since Google Shopping expands with offers)
      const amazonLimit = Math.ceil(maxResults * 0.6);
      const googleShoppingLimit = Math.ceil(maxResults * 0.4 / 3); // Divide by 3 to account for average offers expansion
      return { amazonLimit, googleShoppingLimit };
    } else if (includeAmazon) {
      return { amazonLimit: maxResults, googleShoppingLimit: 0 };
    } else if (includeGoogleShopping) {
      return { amazonLimit: 0, googleShoppingLimit: Math.ceil(maxResults / 3) }; // Account for offers expansion
    } else {
      return { amazonLimit: 0, googleShoppingLimit: 0 };
    }
  }

  // Main search method that combines Amazon and Google Shopping
  async searchAllProducts(options: ProductSearchOptions): Promise<UnifiedProduct[]> {
    const includeAmazon = options.includeAmazon !== false; // Default true
    const includeGoogleShopping = options.includeGoogleShopping !== false; // Default true
    const maxResults = options.maxResults || 20;
    
    // Calculate optimal search limits for each source
    const { amazonLimit, googleShoppingLimit } = this.calculateSearchLimits(
      maxResults, 
      includeAmazon, 
      includeGoogleShopping
    );

    const allProducts: UnifiedProduct[] = [];

    // Search Amazon products
    if (includeAmazon && amazonLimit > 0) {
      const amazonOptions = { ...options, maxResults: amazonLimit };
      const amazonProducts = await this.searchAmazonProducts(amazonOptions);
      allProducts.push(...amazonProducts);
    }

    // Search Google Shopping products
    if (includeGoogleShopping && googleShoppingLimit > 0) {
      const googleOptions = { ...options, maxResults: googleShoppingLimit };
      const googleProducts = await this.searchGoogleShoppingProducts(googleOptions);
      
      // Add Google Shopping products but respect total budget
      for (const product of googleProducts) {
        if (allProducts.length >= maxResults) {
          break;
        }
        allProducts.push(product);
      }
    }

    // Sort by position and apply final limit
    const sortedProducts = allProducts.sort((a, b) => a.position - b.position);
    const limitedProducts = sortedProducts.slice(0, maxResults);

    // Log final results
    const amazonCount = limitedProducts.filter(p => p.source === 'amazon').length;
    const googleShoppingCount = limitedProducts.filter(p => p.source === 'google_shopping').length;
    console.log(`🎯 Final results: ${limitedProducts.length}/${maxResults} products (${amazonCount} Amazon + ${googleShoppingCount} Google Shopping)`);

    return limitedProducts;
  }

  // Evaluate product quality based on rating and reviews
  evaluateProductQuality(product: UnifiedProduct): {
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
        score += 5;
        reasons.push(`Average rating: ${product.rating}★`);
      } else {
        score += 0;
        reasons.push(`Low rating: ${product.rating}★`);
      }
    } else {
      reasons.push('No rating available');
    }

    // Review count evaluation (0-40 points)
    if (product.reviews) {
      if (product.reviews >= 1000) {
        score += 40;
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

    // Prime availability (0-20 points)
    if (product.source === 'amazon') {
      if (product.is_prime) {
        score += 20;
        reasons.push('Prime eligible');
      }
    } else {
      // For non-Amazon products (e.g., Google Shopping), give full prime score
      score += 20;
      reasons.push('Fast delivery available');
    }

    const isRecommended = score >= 60; // Minimum 60/100 for recommendation

    return {
      score,
      reasons,
      isRecommended
    };
  }

  // Generate refined search keywords using AI based on initial results
  async generateRefinedKeywords(originalQuery: string, products: Array<(UnifiedProduct | AmazonProduct) & { evaluation: any; source: 'amazon' | 'local' | 'google_shopping' }>, priceConstraints?: { min?: number; max?: number }): Promise<string[]> {
    try {
      console.log(`🤖 Generating refined keywords for: "${originalQuery}"`);
      
      // Analyze the current products to understand what was found
      const productAnalysis = products.slice(0, 8).map(p => ({
        title: p.title,
        rating: p.rating,
        reviews: p.reviews,
        price: p.extracted_price,
        isPrime: p.is_prime,
        source: p.source,
        qualityScore: p.evaluation?.score || 0,
        isRecommended: p.evaluation?.isRecommended || false
      }));

      // Build price constraints text for the prompt
      const priceConstraintsText = priceConstraints && (priceConstraints.min !== undefined || priceConstraints.max !== undefined) 
        ? `\n\nCRITICAL PRICE CONSTRAINTS: The user has set a specific price range of $${priceConstraints.min || 'any'} - $${priceConstraints.max || 'any'}. You MUST NOT include any price-related terms (like "under $X", "cheap", "budget", "expensive", "affordable", etc.) in your refined query that would conflict with this price range. The API will handle price filtering automatically.` 
        : '';

      const prompt = `You are helping refine a product search query to find better results.

Original search: "${originalQuery}"${priceConstraintsText}

Current search results analysis (from both Amazon and local stores):
${productAnalysis.map((p, i) => 
  `${i + 1}. "${p.title}"
     • Source: ${p.source === 'amazon' ? 'Amazon' : p.source === 'google_shopping' ? 'Google Shopping' : 'Local Store'}
     • Rating: ${p.rating || 'N/A'}★ (${p.reviews || 'N/A'} reviews)
     • Price: $${p.price || 'N/A'}
     • Prime: ${p.isPrime ? 'Yes' : 'No'}
     • Quality Score: ${p.qualityScore}/100
     • Recommended: ${p.isRecommended ? 'Yes' : 'No'}`
).join('\n\n')}

Analysis Summary:
- Total products found: ${productAnalysis.length}
- Amazon products: ${productAnalysis.filter(p => p.source === 'amazon').length}
- Google Shopping products: ${productAnalysis.filter(p => p.source === 'google_shopping').length}
- Local products: ${productAnalysis.filter(p => p.source === 'local').length}
- Recommended products: ${productAnalysis.filter(p => p.isRecommended).length}
- Average quality score: ${Math.round(productAnalysis.reduce((sum, p) => sum + p.qualityScore, 0) / productAnalysis.length)}

Based on the original intent and current results, generate 1 optimal refined search query that is:
1. More specific and targeted than the current query
2. More specific means narrow down the search scope, adding more specific keywords about categories, features, price ranges, etc.
3. Do not fabricate any keywords, narrowing down should be reasonable and based on the user's profile, not guessing anything about the user
4. Natural and organic (not just adding random keywords)
5. Most likely to find better quality or more relevant products
6. Addresses the main weakness you see in current results
7. If you find any products are relevant or interesting, you can explore more about their type, category, features, etc by generating related keywords
8. CRITICAL: Do NOT include any price-related terms (like "under $X", "over $Y", "cheap", "budget", "expensive", "affordable", "premium", etc.) in your refined query${priceConstraints ? ' as the user has set specific price constraints that will be handled by the API automatically' : ''}

Consider factors like:
- If no products are recommended (quality score < 60), focus on quality/feature aspects (NOT price terms)
- If results are too broad, make them more specific with category/feature keywords
- If results don't match intent, try alternative product categories
- If results lack reviews, try more popular product terms

Return ONLY 1 refined search query, no explanation or numbering.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
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
          model: "gpt-4o",
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

export default new ProductSearchService(); 