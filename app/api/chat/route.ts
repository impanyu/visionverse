import { openai } from "@ai-sdk/openai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import { streamText } from "ai";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import clientPromise from "@/lib/mongodb";
import { VisionDocument, Vision } from "@/types/vision";
import { storeVisionEmbedding, searchSimilarVisions, searchAllVisions, storeHistoricalQuery, searchSimilarHistoricalQueries } from "@/lib/vector-db";
import { storeHistoricalSearchResult, getLastSearchedProduct, getLastSearchedProductBundles } from "@/lib/historical-search-db";
import amazonSearchService, { AmazonProduct, UnifiedProduct } from "@/lib/amazon-search";
import OpenAI from 'openai';
import { ProductSearchResult, SearchStep } from "@/components/product-search-ui";
import { ObjectId } from "mongodb";
import { ProductDocument, Product } from "@/types/product";
import { ServiceDocument, Service } from "@/types/service";

// Removed edge runtime since MongoDB requires Node.js modules
export const maxDuration = 30;

// Function to calculate distance between two coordinates in miles
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3959; // Earth's radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c; // Distance in miles
}

// In-memory store to track active searches by user ID
const activeSearches = new Map<string, { timestamp: number; searchId: string }>();

// Clean up old search records (older than 40 seconds)
const cleanupActiveSearches = () => {
  const now = Date.now();
  const timeoutThreshold = now - 40 * 1000; // 40 seconds - longer than frontend timeout
  
  for (const [userId, search] of activeSearches.entries()) {
    if (search.timestamp < timeoutThreshold) {
      activeSearches.delete(userId);
      console.log(`🧹 Cleaned up timed-out search record for user: ${userId} (search was running for ${Math.round((now - search.timestamp) / 1000)}s)`);
    }
  }
};

// Helper function to handle product search refresh requests
async function handleProductSearchRefresh(refreshRequest: any, token: any, searchOption: string = 'both') {
  console.log(`🔄 Handling refresh: iteration ${refreshRequest.refreshFromIteration}, type ${refreshRequest.refreshType}`);
  console.log(`🎯 Refresh: Using search option: ${searchOption}`);
  
  const originalQuery = refreshRequest.originalQuery;
  
  // Track refresh query in user profile
  try {
    const { addQueryToProfile } = await import('@/lib/user-db');
    const userId = token.id as string;
    
    // Add refresh query to user profile
    await addQueryToProfile(userId, originalQuery);
    console.log(`👤 Profile: Added refresh query to user profile: "${originalQuery}"`);
  } catch (error) {
    console.error('⚠️ Profile: Error adding refresh query to profile:', error);
    // Don't block refresh if profile update fails
  }
  const refreshFromIteration = refreshRequest.refreshFromIteration;
  const refreshType = refreshRequest.refreshType;
  const searchStepsUpToRefresh = refreshRequest.searchStepsUpToRefresh || [];
  const allProductsUpToRefresh = refreshRequest.allProductsUpToRefresh || [];

  try {
    // Store the original query in historical collection (fire and forget)
    storeHistoricalQuery(originalQuery, token.id as string).catch(error => {
      console.warn('⚠️ Failed to store historical query:', error);
    });

    let searchSteps: SearchStep[] = [...searchStepsUpToRefresh];
    let allProducts: Array<any & { evaluation: any; source: 'amazon' | 'local' | 'google_shopping' }> = [...allProductsUpToRefresh];
    let bestProduct: (any & { evaluation: any; source: 'amazon' | 'local' | 'google_shopping' }) | null = null;
    let currentQuery = originalQuery;
    
    // Get session ID for consistency
    const sessionId = refreshRequest.sessionId || `session_${Date.now()}`;

    if (refreshType === 'product') {
      // Re-select best product from all accumulated products
      console.log(`🔄 Re-selecting best product from ${allProducts.length} accumulated products`);
      
      if (allProducts.length > 0) {
        try {
          // Use AI to select the most appropriate product from all accumulated products
          const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          
          const selectionPrompt = `You are an expert product selector. From the following list of products found across multiple search iterations, choose the single most appropriate product based on the user's original query: "${originalQuery}".

Products:
${allProducts.map((p, i) => 
  `${i + 1}. Title: "${p.title}"
 • Price: ${p.price || 'N/A'}
 • Rating: ${p.rating || 'N/A'} (${p.reviews || 0} reviews)
 • Source: ${p.source === 'amazon' ? 'Amazon' : p.source === 'google_shopping' ? 'Google Shopping' : 'Other Store'}
 • Recommend Score: ${p.evaluation.score}/100
 • Recommend Reasons: ${p.evaluation.reasons.join(', ')}`
).join('\n\n')}

Instructions:
1. Consider the user's specific intent from their original query
2. Evaluate relevance, quality, price appropriateness, and user reviews
3. Consider if the product truly matches what the user is looking for
4. Don't just pick the highest scored product - consider context and appropriateness
5. If NONE of these products are truly appropriate for the user's query, respond with -1
6. Otherwise, respond with ONLY the number (1, 2, 3, etc.) of the most appropriate product

Select the product number (or -1 if none are appropriate):`;

          const selectionResponse = await openaiClient.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: selectionPrompt }],
            temperature: 0.4,
            max_tokens: 10
          });

          const selectedNumber = parseInt(selectionResponse.choices[0]?.message?.content?.trim() || '1');
          
          if (selectedNumber === -1) {
            console.log(`❌ AI determined no products are appropriate for "${originalQuery}" after refresh`);
            // Fall back to highest scored product
            const sortedProducts = allProducts.sort((a, b) => b.evaluation.score - a.evaluation.score);
            bestProduct = sortedProducts[0] || null;
          } else {
            const selectedIndex = Math.max(1, Math.min(selectedNumber, allProducts.length)) - 1;
            bestProduct = allProducts[selectedIndex] || allProducts[0];
            console.log(`🎯 AI re-selected product ${selectedNumber}: "${bestProduct?.title}" after refresh`);
          }
        } catch (error) {
          console.error('⚠️ Error in AI product re-selection:', error);
          // Fall back to highest scored product
          const sortedProducts = allProducts.sort((a, b) => b.evaluation.score - a.evaluation.score);
          bestProduct = sortedProducts[0] || null;
        }
      }
    } else {
      // refreshType === 'search' - restart from specific iteration
      console.log(`🔄 Restarting search from iteration ${refreshFromIteration}`);
      
      // Determine the current query based on iteration
      if (refreshFromIteration === 0) {
        // Restart from beginning - regenerate user intent
        const lastSearchedProductBundles = await getLastSearchedProductBundles(token.id as string);
        
        try {
          console.log(`🕒 Re-analyzing user intent from original query...`);
          const historicalQueries = await searchSimilarHistoricalQueries(originalQuery, token.id as string, 30);
          
                  if (historicalQueries.documents[0] && historicalQueries.documents[0].length > 0) {
          // Sort historical queries by timestamp (most recent first)
          const queriesWithMetadata = historicalQueries.documents[0].map((hQuery, i) => ({
            query: hQuery,
            distance: historicalQueries.distances[0][i],
            timestamp: historicalQueries.metadatas[0][i]?.createdAt || '',
            metadata: historicalQueries.metadatas[0][i]
          }));
          
          queriesWithMetadata.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
          
          // Get user profile for intent prompt
          let userProfileContext = '';
          try {
            const { getUserProfile } = await import('@/lib/user-db');
            const userProfile = await getUserProfile(token.id as string);
            
            if (userProfile && userProfile.profile.length > 0) {
              const profileItems = userProfile.profile;
              userProfileContext = `\n\nThis user has profile as follows: ${profileItems.join(', ')}.`;
            }
          } catch (error) {
            console.error('⚠️ Profile: Error loading user profile for intent:', error);
          }
          
          // Use LLM to regenerate intent
          const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
          
          const intentPrompt = `Rewrite search query using user profile and conversational context.

Current query: "${originalQuery}"

USER PROFILE:
${userProfileContext}


CONVERSATIONAL CONTEXT (recent bundles):
${lastSearchedProductBundles.length > 0 ? 
lastSearchedProductBundles.map((search, index) => 
  `${index + 1}. "${search.originalQuery}" → ${search.finalProducts.length} products`
).join('\n')
: 'No recent searches.'}

Use user'sprofile and context for conversation flow. Keep core intent unchanged.

Return ONLY the rewritten query, no explanation.`;

            const intentResponse = await openaiClient.chat.completions.create({
              model: "gpt-4o",
              messages: [{ role: "user", content: intentPrompt }],
              temperature: 0.4,
              max_tokens: 100
            });

            const suggestedQuery = intentResponse.choices[0]?.message?.content?.trim();
            if (suggestedQuery && suggestedQuery !== originalQuery) {
              currentQuery = suggestedQuery;
              console.log(`🧠 Refreshed intent-based query: "${currentQuery}"`);
            }
          }
        } catch (error) {
          console.error('⚠️ Error in intent refresh analysis:', error);
          currentQuery = originalQuery;
        }
      } else {
        // Use the keywords from the previous iteration for refinement
        const previousStep = searchStepsUpToRefresh[refreshFromIteration - 1];
        if (previousStep) {
          currentQuery = previousStep.keywords;
          console.log(`🔄 Using previous step query for refinement: "${currentQuery}"`);
        }
      }

      // Continue the search process from the determined starting point
      // This is a simplified version - in a full implementation, you'd continue the iterative search
      // For now, just perform one search iteration from the current query
      
      // Set search flags based on search option
      const search_product = searchOption === 'product' || searchOption === 'both';
      const search_service = searchOption === 'service' || searchOption === 'both';
      
      console.log(`🎯 Refresh: search_product=${search_product}, search_service=${search_service}`);

      let searchProducts: any[] = [];
      let localServices: any[] = [];
      let googleMapsServices: any[] = [];

      // Search products if enabled
      if (search_product) {
        console.log(`🛍️ Refresh: Searching products...`);
        const products = await amazonSearchService.searchAllProducts({
          query: currentQuery,
          maxResults: 20,
          sortBy: 'featured',
          includeAmazon: true,
          includeGoogleShopping: true
        });
        searchProducts = products;
        
        allProducts.push(...searchProducts.map(p => ({
          ...p,
          evaluation: amazonSearchService.evaluateProductQuality(p)
        })));
      }

      // Search services if enabled (simplified for refresh)
      if (search_service) {
        console.log(`🏪 Refresh: Services search not implemented in refresh - skipping`);
        // Note: Service search in refresh would require more complex implementation
        // For now, we'll only support product refresh to maintain consistency
      }

      // Add this iteration to search steps
      const amazonCount = searchProducts.filter(p => p.source === 'amazon').length;
      const googleShoppingCount = searchProducts.filter(p => p.source === 'google_shopping').length;
      
      searchSteps.push({
        keywords: currentQuery,
        amazonResults: amazonCount,
        googleShoppingResults: googleShoppingCount,
        localResults: localServices.length,
        googleMapsResults: googleMapsServices.length,
        stepType: refreshFromIteration === 0 ? 'search' : 'refinement'
      });

      // Select best product from accumulated results
      const recommendedProducts = allProducts.filter(p => p.evaluation.isRecommended);
      if (recommendedProducts.length > 0) {
        bestProduct = recommendedProducts[0]; // Simplified selection
      }
    }

    let searchSummary: string;
    if (searchOption === 'service') {
      searchSummary = `Refreshed search with "service only" option - service refresh not yet implemented in refresh functionality.`;
    } else if (bestProduct && bestProduct.title) {
      searchSummary = `Refreshed search found "${bestProduct.title}" with a recommend score of ${bestProduct.evaluation.score}/100.`;
    } else if (searchOption === 'product') {
      searchSummary = `Refreshed product search completed but no suitable product was found.`;
    } else {
      searchSummary = `Refreshed search completed but no suitable product was found.`;
    }

    const result: ProductSearchResult = {
      originalQuery,
      searchSteps,
      recommendedProduct: bestProduct || undefined,
      recommendedProducts: bestProduct ? [bestProduct] : [],
      searchSummary,
      sessionId,
      allAccumulatedProducts: allProducts
    };

    // Store the search result if a product was found
    if (bestProduct) {
      try {
        await storeHistoricalSearchResult(
          {
            originalQuery,
            finalProducts: [{
              title: bestProduct.title,
              description: bestProduct.description,
              price: bestProduct.price,
              extracted_price: bestProduct.extracted_price,
              original_price: bestProduct.original_price,
              extracted_original_price: bestProduct.extracted_original_price,
              rating: bestProduct.rating,
              reviews: bestProduct.reviews,
              link: bestProduct.link,
              thumbnail: bestProduct.thumbnail,
              source: bestProduct.source,
              asin: bestProduct.asin,
              product_id: bestProduct.product_id,
              is_prime: bestProduct.is_prime,
              seller: bestProduct.seller,
              delivery: bestProduct.delivery,
              evaluation: bestProduct.evaluation
            }],
            searchSteps,
            searchSummary
          },
          token.id as string,
          token.name || '',
          token.email || ''
        );
      } catch (error) {
        console.error('⚠️ Failed to store refreshed search result:', error);
      }
    }

    return {
      type: "product_search",
      result,
      ui: {
        type: "product_search",
        title: "Refreshed Product Search Results",
        description: `Refreshed search for "${originalQuery}"`
      }
    };

  } catch (error) {
    console.error("Error in refresh product search:", error);
    return {
      type: "error",
      ui: {
        type: "error",
        title: "Refresh Failed",
        description: error instanceof Error ? error.message : 'Unknown error occurred during refresh'
      }
    };
  }
}

export async function POST(req: Request) {
  // Check authentication using JWT token
  const token = await getToken({ 
    req: req as any, 
    secret: process.env.NEXTAUTH_SECRET 
  });
  
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Initialize user profile (creates user if doesn't exist)
  try {
    const { createOrGetUser } = await import('@/lib/user-db');
    const userId = token.id as string;
    const userName = token.name as string || 'Unknown User';
    const userEmail = token.email as string || 'unknown@example.com';
    
    console.log(`🔧 DEBUG: Attempting to create/get user profile for ${userId}`);
    const user = await createOrGetUser(userId, userName, userEmail);
    console.log(`✅ DEBUG: User profile initialized successfully for ${userId}, profile length: ${user.profile?.length || 0}`);
  } catch (error) {
    console.error('❌ CRITICAL: Error initializing user profile:', error);
    console.error('❌ CRITICAL: This means user profile features will not work!');
    console.error('❌ CRITICAL: Check MongoDB connection and users collection');
    // Don't block the chat flow if user profile creation fails
  }

  const { messages, system, tools } = await req.json();

  // Add debugging for received messages
  console.log("🎯 API: Received messages count:", messages?.length || 0);
  if (messages && messages.length > 0) {
    const lastUserMessage = messages.slice().reverse().find((m: any) => m.role === 'user');
    if (lastUserMessage) {
      console.log("🎯 API: Last user message:", typeof lastUserMessage.content === 'string' ? lastUserMessage.content : 'complex content');
      console.log("🎯 API: This should trigger product search if it's a product query");
    }
  }

  // Check for specific button commands that should force tool usage
  const lastMessage = messages[messages.length - 1];
  
  // Debug: Write conversation history to file for easy checking
  try {
    const fs = require('fs');
    const path = require('path');
    
    const userMessages = messages.filter((msg: any) => msg.role === 'user');
    const debugContent = [
      `🚨 CONVERSATION HISTORY DEBUG - ${new Date().toISOString()}`,
      `📊 Total messages: ${messages.length}`,
      `👤 User messages: ${userMessages.length}`,
      '',
      '📝 USER MESSAGE HISTORY:',
      ...userMessages.map((msg: any, idx: number) => {
        const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        return `  [${idx + 1}/${userMessages.length}] ${content}`;
      }),
      '',
      '🔍 LATEST MESSAGE:',
      `  ${typeof lastMessage?.content === 'string' ? lastMessage.content : JSON.stringify(lastMessage?.content)}`,
      '',
      '='.repeat(80)
    ].join('\n');
    
    const debugFilePath = path.join(process.cwd(), 'conversation-debug.txt');
    fs.writeFileSync(debugFilePath, debugContent);
    console.log(`🚨 CONVERSATION HISTORY saved to: conversation-debug.txt (${userMessages.length} user messages)`);
  } catch (error) {
    console.error('Failed to write conversation debug file:', error);
  }
  
  // Extract search option from request headers
  const searchOption = req.headers.get('X-Search-Option') || 'both';
  console.log(`🎯 API: Search option from headers: ${searchOption}`);
  
  // Extract user location from request headers
  const userLocationHeader = req.headers.get('X-User-Location');
  let userLocation: {lat: number, lng: number} | null = null;
  if (userLocationHeader) {
    try {
      userLocation = JSON.parse(userLocationHeader);
      console.log(`📍 API: User location from headers:`, userLocation);
    } catch (error) {
      console.warn('⚠️ API: Failed to parse user location header:', error);
    }
  }
  
  // Handle both string and array content types
  let userMessage = '';
  let originalUserMessage = '';
  
  if (lastMessage?.content) {
    if (typeof lastMessage.content === 'string') {
      originalUserMessage = lastMessage.content;
      userMessage = lastMessage.content.toLowerCase();
      console.log(`🔍 API: String message content: "${lastMessage.content}"`);
    } else if (Array.isArray(lastMessage.content)) {
      // Extract text from content parts array
      const extractedText = lastMessage.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join(' ');
      
      originalUserMessage = extractedText;
      userMessage = extractedText.toLowerCase();
      console.log(`🔍 API: Array message content: "${extractedText}"`);
    }
  }
  
  let forcedTool = null;
  let refreshRequest = null;
  
  // Check for refresh requests first
  if (typeof lastMessage.content === 'string' && lastMessage.content.startsWith('REFRESH_PRODUCT_SEARCH:')) {
    try {
      const refreshData = lastMessage.content.replace('REFRESH_PRODUCT_SEARCH:', '');
      refreshRequest = JSON.parse(refreshData);
      forcedTool = 'intelligent_product_search';
    } catch (error) {
      console.error('Error parsing refresh request:', error);
    }
  } else if (typeof lastMessage.content === 'string' && lastMessage.content.startsWith('PRICE_RANGE_SEARCH:')) {
    try {
      console.log(`🔄 Backend: Received PRICE_RANGE_SEARCH request`);
      const priceRangeData = lastMessage.content.replace('PRICE_RANGE_SEARCH:', '');
      console.log(`🔄 Backend: Price range data:`, priceRangeData);
      refreshRequest = JSON.parse(priceRangeData);
      refreshRequest.type = 'price_range_search'; // Mark as price range search
      forcedTool = 'intelligent_product_search';
      console.log(`🔄 Backend: Parsed refresh request:`, refreshRequest);
      console.log(`🔄 Backend: Forced tool set to:`, forcedTool);
    } catch (error) {
      console.error('Error parsing price range search request:', error);
    }
  } else if (userMessage.includes('create vision') || userMessage.includes('create a vision') || userMessage.includes('new vision')) {
    forcedTool = 'create_vision_form';
  } else if (userMessage.includes('list my visions') || userMessage.includes('show my visions') || userMessage.includes('my visions')) {
    forcedTool = 'list_my_visions';
  } else if (userMessage.includes('list my products') || userMessage.includes('show my products') || userMessage.includes('my products')) {
    forcedTool = 'list_my_products';
  } else if (userMessage.includes('create product') || userMessage.includes('create a product') || userMessage.includes('new product') || userMessage.includes('add product') || userMessage.includes('add a product')) {
    forcedTool = 'create_product_form';
  } else if (userMessage.includes('list my services') || userMessage.includes('show my services') || userMessage.includes('my services') || userMessage.includes('manage my services')) {
    forcedTool = 'list_my_services';
  } else if (userMessage.includes('create service') || userMessage.includes('create a service') || userMessage.includes('new service') || userMessage.includes('add service') || userMessage.includes('add a service')) {
    forcedTool = 'create_service_form';
  } else if (userMessage.includes('delete product') && userMessage.match(/delete product\s+([a-f0-9]{24})/)) {
    forcedTool = 'delete_product';
  } else if (userMessage.includes('delete service') && userMessage.match(/delete service\s+([a-f0-9]{24})/)) {
    forcedTool = 'delete_service';

  } else {
    // Default behavior: treat as product search if not explicitly asking for other tools
    const visionKeywords = ['vision', 'idea', 'dream', 'concept', 'design'];
    const productKeywords = ['product', 'list', 'show', 'manage', 'create'];
    const shopKeywords = ['shop', 'store'];
    
    const hasVisionKeyword = visionKeywords.some(keyword => userMessage.includes(keyword));
    const hasProductKeyword = productKeywords.some(keyword => userMessage.includes(keyword));
    const hasShopKeyword = shopKeywords.some(keyword => userMessage.includes(keyword));
    
    // For general user input, let AI decide naturally (like landing page)
    console.log("🤖 API: General user input - letting AI choose appropriate tool naturally");
  }

  // Enhanced system prompt with user context
  const userName = token.name || token.email || "User";

  
  let enhancedSystem = `${system || "You are a helpful assistant."}\n\nUser context: You are chatting with ${userName}. 

🚨🚨🚨 ABSOLUTELY CRITICAL: ZERO TEXT WITH TOOLS! 🚨🚨🚨

WHEN YOU CALL ANY TOOL:
❌ NO TEXT BEFORE THE TOOL CALL
❌ NO TEXT AFTER THE TOOL CALL  
❌ NO EXPLANATIONS
❌ NO DESCRIPTIONS
❌ NO JSON OUTPUT
❌ NO "Here are some..." messages
❌ NO ANYTHING - JUST THE TOOL CALL

EXAMPLES OF FORBIDDEN RESPONSES:
❌ "Here are some swimming pool options for home use: [tool call]"
❌ "[tool call] These products should meet your needs."
❌ "I found these products: [tool call]"
❌ "[tool call] \n\n{'products': [...]}"

✅ CORRECT RESPONSE: [tool call only]

TOOL = COMPLETE RESPONSE. STAY SILENT!

TOOL USAGE RULES:

1. When the user asks to create a VISION, idea, complaint, dream, or design:
   - If they provide ANY description/content (even brief), IMMEDIATELY use create_vision_direct - DO NOT generate any text
   - If they ask to create a vision with NO description at all, IMMEDIATELY use create_vision_form - DO NOT generate any text

2. When the user asks to create or add a PRODUCT:
   - If they provide ANY description/content (even brief), IMMEDIATELY use create_product_direct - DO NOT generate any text  
   - If they ask to add or create a product with NO description at all, IMMEDIATELY use create_product_form - DO NOT generate any text

3. When the user asks to list/show their visions, IMMEDIATELY use list_my_visions - DO NOT generate any text

4. When the user asks to search their visions, IMMEDIATELY use search_my_visions - DO NOT generate any text

5. When the user asks to search all visions, IMMEDIATELY use search_all_visions - DO NOT generate any text

6. When the user asks to list/show their products, IMMEDIATELY use list_my_products - DO NOT generate any text

7. When the user asks to create or add a SERVICE:
   - If they provide ANY description/content (even brief), IMMEDIATELY use create_service_direct - DO NOT generate any text
   - If they ask to add or create a service with NO description at all, IMMEDIATELY use create_service_form - DO NOT generate any text

8. When the user asks to list/show their services, IMMEDIATELY use list_my_services - DO NOT generate any text

9. When the user searches for products or services, IMMEDIATELY use intelligent_product_search:
   - Pass the user's exact message as the query argument!!!
   - DO NOT modify or parse the user's message - use it exactly as provided !!!
   - For example, if the user says "I want something", the query should be exactly "I want something", do not remove any words or phrases from the user's message


DEFAULT BEHAVIOR: If the user's message doesn't match any of the above patterns and doesn't contain keywords like 'vision', 'idea', 'dream', 'concept', 'design', 'product', 'list', 'show', 'manage', 'create', 'shop', 'store', treat it as a search query for both products and services. 

🚨 Pay Attention: For ANY search (explicit or default), the search scope is automatically handled!

🛑🛑🛑 FINAL WARNING: NO TEXT GENERATION EVER WITH TOOLS! 🛑🛑🛑
If you generate ANY text when calling a tool, you will cause a system error.
ONLY tool calls. NEVER text. NOT EVEN A SINGLE WORD.

Remember: Your response to any tool usage = ONLY the tool call, no additional text.`;

  // Force the AI to be completely silent with tools
  enhancedSystem += `\n\n🔇 SILENCE MODE: When using ANY tool, you must be completely silent. No explanations, no JSON, no text whatsoever.`;

  // Search option is now handled automatically in the tool - no AI instruction needed

  // Add extra instruction if tool is being forced
  // Simple approach - let AI choose tools naturally based on context

  // For product searches, limit conversation history to prevent "nothing shown" on subsequent searches
  let processedMessages = messages;
  const lastUserMessage = messages[messages.length - 1];
  
  // Extract text content from the last user message (handle both string and complex content)
  let userTextContent = '';
  if (lastUserMessage) {
    if (typeof lastUserMessage.content === 'string') {
      userTextContent = lastUserMessage.content;
    } else if (Array.isArray(lastUserMessage.content)) {
      // Extract text from content array (handle complex message format)
      const textParts = lastUserMessage.content.filter((part: any) => part.type === 'text').map((part: any) => part.text);
      userTextContent = textParts.join(' ');
    }
    }
  
  console.log(`🔍 API: Extracted user text content: "${userTextContent}"`);
  
  const isProductSearchKeyword = userTextContent && (
    userTextContent.toLowerCase().includes('search') ||
    userTextContent.toLowerCase().includes('find') ||
    userTextContent.toLowerCase().includes('product') ||
    !userTextContent.toLowerCase().match(/\b(vision|idea|dream|concept|design|list|show|manage|create|shop|store)\b/)
  );

  // If this looks like a normal product search, force the intelligent_product_search tool
  if (!forcedTool && isProductSearchKeyword) {
    forcedTool = 'intelligent_product_search';
    console.log(`✅ Forcing tool: ${forcedTool} (detected product search)`);
  }

  if (isProductSearchKeyword && messages.length > 3) {
    // Keep only the last 3 messages for product searches to ensure consistent performance
    processedMessages = messages.slice(-3);
    console.log(`🔄 API: Trimmed conversation from ${messages.length} to ${processedMessages.length} messages for product search consistency`);
  }
  
  // Debug: Log if this is detected as a product search
  console.log(`🔍 API: Detected product search: ${isProductSearchKeyword}, Messages: ${messages.length}, Will trim: ${isProductSearchKeyword && messages.length > 3}`);

  // Track if vision tools are being used
  console.log("🤖 API: About to call streamText with:");
  console.log("🤖 API: System message length:", enhancedSystem?.length || 0);
  console.log("🤖 API: Messages count:", processedMessages?.length || 0);
  console.log(`🤖 API: Tool choice: ${forcedTool ? `FORCED ${forcedTool}` : 'auto (natural AI decision)'}`);
  console.log("🤖 API: Available tools:", Object.keys({
    ...frontendTools(tools),
    create_vision_direct: "create_vision_direct",
    create_product_form: "create_product_form",
    create_product_direct: "create_product_direct", 
    list_my_products: "list_my_products",
    show_product: "show_product",
    delete_product: "delete_product",
    product_created_with_list: "product_created_with_list",
    product_deleted_with_list: "product_deleted_with_list",
    create_service_form: "create_service_form",
    list_my_services: "list_my_services",
    show_service: "show_service",
    delete_service: "delete_service",
    intelligent_product_search: "intelligent_product_search"
  }));
  
  // Add debugging for the last few messages
  if (processedMessages && processedMessages.length > 0) {
    console.log("🤖 API: Last 3 messages:");
    const lastThree = processedMessages.slice(-3);
    lastThree.forEach((msg: any, idx: number) => {
      console.log(`  [${idx}] ${msg.role}: ${typeof msg.content === 'string' ? msg.content.substring(0, 100) : 'complex content'}`);
      if (msg.tool_calls) {
        console.log(`    Tool calls: ${JSON.stringify(msg.tool_calls)}`);
      }
    });
  }
  
  // Debug: Log what we're sending to the AI
  console.log(`🤖 API: Sending to AI - Last message content: "${userTextContent}" (forcedTool=${forcedTool || 'none'})`);
  console.log(`🤖 API: System prompt contains "NEVER GENERATE TEXT WITH TOOLS": ${enhancedSystem.includes('NEVER GENERATE TEXT WITH TOOLS')}`);

  let result;
  try {
    console.log(`🤖 API: Calling streamText...`);
    result = streamText({
    model: openai('gpt-4.1'),
    system: enhancedSystem,
      messages: processedMessages,
      // Force intelligent_product_search tool for product searches to prevent verbose text
      toolChoice: forcedTool ? { type: "tool", toolName: forcedTool } : "auto",
      onStepFinish: async (step) => {
        // Debug: Check if AI generates text with tool calls
        if (step.text && step.toolCalls && step.toolCalls.length > 0) {
          console.error(`🚨 AI VIOLATED RULE: Generated text with tool calls!`);
          console.error(`🚨 Text: "${step.text}"`);
          console.error(`🚨 Tool calls: ${step.toolCalls.length}`);
          
          // Check if the text looks like JSON
          if (step.text.includes('{') || step.text.includes('[') || step.text.includes('}')) {
            console.error(`🚨 The text appears to be JSON format - this is what the user is seeing!`);
          }
        }
        
        // Also log any text generation during tool calls
        if (step.toolCalls && step.toolCalls.length > 0) {
          console.log(`🔧 Tool calls made: ${step.toolCalls.map(tc => tc.toolName).join(', ')}`);
          if (step.text) {
            console.warn(`⚠️ Text generated with tools: "${step.text}"`);
          } else {
            console.log(`✅ No text generated with tools - good!`);
          }
        }
      },
    tools: {
      ...frontendTools(tools),
      create_vision_direct: {
        description: "Create a vision directly with the provided description. Use this when the user provides a description.",
        parameters: z.object({
          visionDescription: z.string().describe("The vision description provided by the user"),
          imageFile: z.string().optional().describe("Base64 encoded image file if provided"),
        }),
        execute: async ({ visionDescription, imageFile }) => {
          try {
            // Connect to MongoDB
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<VisionDocument>("visions");

            // DUPLICATION DETECTION: Search for similar visions first
            let duplicateVision = null;
            let similarityScore = 0;
            
            try {
              // Search for similar visions using vector database
              const vectorResults = await searchSimilarVisions(
                visionDescription.trim(),
                token.id as string,
                5 // Get top 5 similar visions
              );

              // Check if we found any similar visions
              if (vectorResults.ids[0] && vectorResults.ids[0].length > 0 && vectorResults.distances && vectorResults.distances[0]) {
                // Get the most similar vision (first result)
                const mostSimilarId = vectorResults.ids[0][0];
                const distance = vectorResults.distances[0][0];
                
                // Convert ChromaDB's squared L2 distance to cosine similarity
                // For normalized embeddings: squared_L2 = 2 * (1 - cosine_similarity)
                // So: cosine_similarity = 1 - (squared_L2 / 2)
                similarityScore = 1 - (distance / 2);
                
                console.log(`Most similar vision found: ${mostSimilarId}, similarity: ${similarityScore.toFixed(3)}`);
                
                // If similarity is > 0.6, consider it a duplicate
                if (similarityScore > 0.6) {
                  // Get the full vision document from MongoDB
                  const existingVision = await collection.findOne({ 
                    _id: new ObjectId(mostSimilarId),
                    userId: token.id as string 
                  });
                  
                  if (existingVision) {
                    duplicateVision = existingVision;
                    console.log(`Duplicate vision detected! Similarity: ${similarityScore.toFixed(3)}`);
                  }
                }
              }
            } catch (searchError) {
              console.error("Error during duplication detection:", searchError);
              // Continue with creation if search fails
            }

            // If duplicate found, return it instead of creating new vision
            if (duplicateVision) {
              // Get updated vision list for display
              const visions = await collection
                .find({ userId: token.id as string })
                .sort({ createdAt: -1 })
                .limit(20)
                .toArray();

              const visionsWithStringIds = visions.map(vision => ({
                ...vision,
                id: vision._id?.toString() || "",
                _id: undefined,
              }));

              const duplicateWithStringId = {
                ...duplicateVision,
                id: duplicateVision._id?.toString() || "",
                _id: undefined,
              };

              return {
                type: "vision_duplicate_found",
                duplicate: duplicateWithStringId,
                visions: visionsWithStringIds,
                similarityScore: similarityScore,
                success: true,
                suppressOutput: true,
                ui: {
                  type: "vision_duplicate_found",
                  title: "Identical Vision Found - Creation Prevented",
                  description: `A very similar vision already exists (similarity: ${(similarityScore * 100).toFixed(1)}%). Creation has been prevented to avoid duplicates.`,
                  duplicate: duplicateWithStringId,
                  visions: visionsWithStringIds,
                  similarityScore: similarityScore,
                  attemptedDescription: visionDescription.trim()
                }
              };
            }

            // No duplicate found, proceed with normal creation
            // Insert vision into MongoDB first to get the ID
            const visionData: Omit<VisionDocument, '_id'> = {
              userId: token.id as string,
              userName: token.name || "Unknown User",
              userEmail: token.email || "unknown@example.com",
              visionDescription: visionDescription.trim(),
              filePath: (imageFile || "/no-file").trim(),
              onSale: false, // Default to false
              createdAt: new Date(),
              updatedAt: new Date(),
            };

            // Insert vision into MongoDB
            const result = await collection.insertOne(visionData);
            const visionId = result.insertedId.toString();

            // Store embedding in vector database
            let vectorId: string | undefined;
            try {
              vectorId = await storeVisionEmbedding(
                visionId,
                visionDescription.trim(),
                token.id as string
              );
              
              // Update the vision document with vectorId
              await collection.updateOne(
                { _id: result.insertedId },
                { $set: { vectorId: vectorId } }
              );
              
              console.log("Stored embedding with vector ID:", vectorId);
            } catch (error) {
              console.error("Error storing embedding:", error);
              // Continue without vector storage if it fails
            }

            // PRODUCT LINKING: Find the top 3 most similar products for this vision
            console.log("🔗 STARTING PRODUCT LINKING PHASE (DIRECT CREATION)");
            let linkedProducts: { [productId: string]: number } = {};
            let linkedProductsInfo: { id: string; productDescription: string; similarityScore: number }[] = [];
            
            console.log(`🔍 Searching for similar products for vision: "${visionDescription.trim()}"`);
            console.log(`🔍 User ID: ${token.id} (searching across ALL users)`);
            
            try {
              // Import the vector database function we need
              const { findSimilarProductsForVision } = await import("@/lib/vector-db");
              
              // Search for similar products using vector database with retry logic
              let vectorResults: Awaited<ReturnType<typeof findSimilarProductsForVision>> | null = null;
              let attempt = 0;
              const maxAttempts = 5;
              
              while (attempt < maxAttempts) {
                attempt++;
                console.log(`🔍 Vector search attempt ${attempt}/${maxAttempts}`);
                
                vectorResults = await findSimilarProductsForVision(
                  visionDescription.trim(),
                  token.id as string,
                  5 // Get top 5 similar products
                );

                // If we found results or this is the last attempt, break
                if ((vectorResults.ids[0] && vectorResults.ids[0].length > 0) || attempt === maxAttempts) {
                  console.log(`🔍 Attempt ${attempt}: Found ${vectorResults.ids[0]?.length || 0} results`);
                  break;
                }
                
                // Wait longer before retrying (only if we have more attempts)
                if (attempt < maxAttempts) {
                  const waitTime = attempt * 2000; // Progressive delay: 2s, 4s, 6s, 8s
                  console.log(`⏳ No results found, waiting ${waitTime/1000} seconds before retry...`);
                  await new Promise(resolve => setTimeout(resolve, waitTime));
                }
              }

              // Check if we found any similar products
              if (vectorResults && vectorResults.ids[0] && vectorResults.ids[0].length > 0 && vectorResults.distances && vectorResults.distances[0]) {
                console.log(`✅ Found ${vectorResults.ids[0].length} similar products in vector search`);
                
                // Process all results and filter by similarity threshold
                const productCollection = db.collection<ProductDocument>("products");
                
                for (let i = 0; i < vectorResults.ids[0].length && Object.keys(linkedProducts).length < 3; i++) {
                  const productId = vectorResults.ids[0][i];
                  const distance = vectorResults.distances[0][i];
                  
                  // Convert ChromaDB's squared L2 distance to cosine similarity
                  // For normalized embeddings: squared_L2 = 2 * (1 - cosine_similarity)
                  // So: cosine_similarity = 1 - (squared_L2 / 2)
                  const similarityScore = 1 - (distance / 2);
                  
                  console.log(`📦 Product ${productId}: distance: ${distance}, similarity: ${similarityScore.toFixed(3)}`);
                  
                  // Only link if similarity score is 0.5 or higher
                  if (similarityScore >= 0.5) {
                    // Get the full product document from MongoDB (across all users)
                    const existingProduct = await productCollection.findOne({ 
                      _id: new ObjectId(productId)
                      // Removed userId filter to allow cross-user linking
                    });
                    
                    if (existingProduct) {
                      linkedProducts[productId] = similarityScore;
                      linkedProductsInfo.push({
                        id: productId,
                        productDescription: existingProduct.productDescription,
                        similarityScore: similarityScore
                      });
                      console.log(`🔗 Vision will be linked to product: ${productId} (similarity: ${similarityScore.toFixed(3)})`);
                    }
                  } else {
                    console.log(`❌ Similarity score ${similarityScore.toFixed(3)} is below threshold 0.5 - not linking vision to product ${productId}`);
                  }
                }
                
                // Update the vision document with linked products
                if (Object.keys(linkedProducts).length > 0) {
                  try {
                    await collection.updateOne(
                      { _id: result.insertedId },
                      { $set: { linkedProducts: linkedProducts } }
                    );
                    console.log(`Added ${Object.keys(linkedProducts).length} linked products to vision ${visionId}`);
                  } catch (error) {
                    console.error("Error updating vision's linkedProducts:", error);
                    // Continue even if this fails
                  }
                }

                // Vision-product linking removed - visions are now independent
              } else {
                console.log(`❌ No similar products found for vision in vector search`);
              }
            } catch (searchError) {
              console.error("❌ Error during product linking:", searchError);
              // Continue with creation if search fails
            }
            
            const visionWithStringId = {
              ...visionData,
              id: visionId,
              linkedProducts,
              vectorId,
              _id: undefined,
            };

            // After successful creation, get the updated vision list
            const visions = await collection
              .find({ userId: token.id as string })
              .sort({ createdAt: -1 })
              .limit(20)
              .toArray();

            // Convert ObjectId to string for JSON response
            const visionsWithStringIds = visions.map(vision => ({
              ...vision,
              id: vision._id?.toString() || "",
              _id: undefined,
            }));

            return {
              type: "vision_created_with_list",
              vision: visionWithStringId,
              visions: visionsWithStringIds,
              linkedProducts: linkedProductsInfo,
              success: true,
              suppressOutput: true,
              ui: {
                type: "vision_created_with_list",
                title: "Vision Created Successfully!",
                description: `Your vision has been saved! ${Object.keys(linkedProducts).length > 0 ? `Linked to ${Object.keys(linkedProducts).length} product(s).` : 'No similar products found for linking.'}`,
                vision: visionWithStringId,
                visions: visionsWithStringIds,
                linkedProducts: linkedProductsInfo
              }
            };
          } catch (error) {
            console.error('Error creating vision:', error);
            return {
              type: "vision_created",
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              suppressOutput: true,
              ui: {
                type: "error_card",
                title: "Failed to Create Vision",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },
      create_vision_form: {
        description: "Show the vision creation form when the user wants to create something but provides no description",
        parameters: z.object({
          message: z.string().describe("A message to show to the user explaining why you're showing the form"),
        }),
        execute: async ({ message }) => {
          return {
            type: "vision_creation_ui",
            message: message,
            ui_components: {
              title: "Create Your Vision",
              description: "Describe your vision and optionally upload supporting files",
              form_fields: [
                {
                  type: "textarea",
                  name: "visionDescription",
                  label: "Vision Description",
                  placeholder: "Describe your vision in detail...",
                  required: true,
                  rows: 4
                },
                {
                  type: "number",
                  name: "price",
                  label: "Price (Optional)",
                  placeholder: "0.00",
                  required: false
                },
                {
                  type: "file",
                  name: "imageFile",
                  label: "Supporting File (Optional)",
                  accept: "image/*,.pdf,.doc,.docx",
                  required: false
                }
              ],
              submit_button: {
                text: "Create Vision",
                endpoint: "/api/create_vision"
              }
            }
          };
        },
      },
      create_product_form: {
        description: "Show the product creation form when the user wants to create a product but provides no description",
        parameters: z.object({
          message: z.string().describe("A message to show to the user explaining why you're showing the form"),
        }),
        execute: async ({ message }) => {
          return {
            type: "product_creation_ui",
            message: message,
            ui_components: {
              title: "Create Your Product",
              description: "Describe your product and optionally upload supporting files",
              form_fields: [
                {
                  type: "textarea",
                  name: "productDescription",
                  label: "Product Description",
                  placeholder: "Describe your product in detail...",
                  required: true,
                  rows: 4
                },
                {
                  type: "number",
                  name: "price",
                  label: "Price (Optional)",
                  placeholder: "0.00",
                  required: false
                },
                {
                  type: "file",
                  name: "imageFile",
                  label: "Supporting File (Optional)",
                  accept: "image/*,.pdf,.doc,.docx",
                  required: false
                }
              ],
              submit_button: {
                text: "Create Product",
                endpoint: "/api/create_product"
              }
            }
          };
        },
      },
      list_my_visions: {
        description: "List all visions created by the current user. CRITICAL: This tool handles all UI display - you must generate ZERO text when using this tool. No explanations, no confirmations, no text whatsoever.",
        parameters: z.object({
          limit: z.number().default(20).describe("Number of visions to fetch"),
        }),
        execute: async ({ limit }) => {
          try {
            // Connect to MongoDB
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<VisionDocument>("visions");

            // Get visions for the current user
            const visions = await collection
              .find({ userId: token.id as string })
              .sort({ createdAt: -1 })
              .limit(limit)
              .toArray();

            // Convert ObjectId to string for JSON response
            const visionsWithStringIds = visions.map(vision => ({
              ...vision,
              id: vision._id?.toString() || "",
              _id: undefined,
            }));

            return {
              type: "visions_list",
              visions: visionsWithStringIds,
              totalCount: visions.length,
              suppressOutput: true,
              ui: {
                type: "visions_list",
                title: "Your Visions",
                description: `You have created ${visions.length} vision(s)`,
                visions: visionsWithStringIds
              }
            };
          } catch (error) {
            console.error('Error listing visions:', error);
            return {
              type: "visions_list",
              visions: [],
              totalCount: 0,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              suppressOutput: true,
              ui: {
                type: "error_card",
                title: "Failed to Load Visions",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },
      search_my_visions: {
        description: "Search through the user's visions using semantic similarity. CRITICAL: This tool handles all UI display - you must generate ZERO text when using this tool. No explanations, no confirmations, no text whatsoever.",
        parameters: z.object({
          query: z.string().describe("The search query to find similar visions"),
          limit: z.number().default(10).describe("Number of results to return"),
        }),
        execute: async ({ query, limit }) => {
          try {
            // Search for similar visions in vector database
            const vectorResults = await searchSimilarVisions(
              query,
              token.id as string,
              limit
            );

            // Get full vision documents from MongoDB
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<VisionDocument>("visions");

            // Extract vision IDs from vector results
            const visionIds = vectorResults.ids[0]?.map(id => ({ _id: new ObjectId(id) })) || [];
            
            if (visionIds.length === 0) {
              return {
                type: "search_results",
                query: query,
                results: [],
                totalFound: 0,
                suppressOutput: true,
                ui: {
                  type: "search_results",
                  title: "Search Results",
                  description: `No visions found matching "${query}"`,
                  query: query,
                  results: []
                }
              };
            }

            // Get vision documents
            const visions = await collection
              .find({ $or: visionIds })
              .toArray();

            // Map results with similarity scores and filter for good matches
            const resultsWithScores = vectorResults.ids[0].map((id, index) => {
              const vision = visions.find(v => v._id?.toString() === id);
              const distance = vectorResults.distances?.[0]?.[index];
              const document = vectorResults.documents?.[0]?.[index];
              
              if (vision && distance !== undefined) {
                // Convert ChromaDB's squared L2 distance to cosine similarity
                // For normalized embeddings: squared_L2 = 2 * (1 - cosine_similarity)
                // So: cosine_similarity = 1 - (squared_L2 / 2)
                const cosineSimilarity = 1 - (distance / 2);
                
                return {
                  vision: {
                    id: vision._id?.toString(),
                    ...vision,
                    _id: undefined,
                  },
                  similarityScore: cosineSimilarity,
                  matchedText: document,
                };
              }
              return null;
            }).filter((result): result is NonNullable<typeof result> => result !== null)
              .filter(result => result.similarityScore > 0.5) // Only results with >50% similarity
              .slice(0, 10); // Limit to top 10 results

            return {
              type: "search_results",
              query: query,
              results: resultsWithScores,
              totalFound: resultsWithScores.length,
              suppressOutput: true,
              ui: {
                type: "search_results",
                title: "Search Results",
                description: `Found ${resultsWithScores.length} vision(s) matching "${query}"`,
                query: query,
                results: resultsWithScores
              }
            };

          } catch (error) {
            console.error('Error searching visions:', error);
            return {
              type: "search_results",
              query: query,
              results: [],
              totalFound: 0,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              suppressOutput: true,
              ui: {
                type: "error_card",
                title: "Search Failed",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },
      search_all_visions: {
        description: "Search through all users' visions using semantic similarity. CRITICAL: This tool handles all UI display - you must generate ZERO text when using this tool. No explanations, no confirmations, no text whatsoever.",
        parameters: z.object({
          query: z.string().describe("The search query to find similar visions across all users"),
          limit: z.number().default(10).describe("Number of results to return"),
        }),
        execute: async ({ query, limit }) => {
          try {
            // Search for similar visions across all users in vector database
            const vectorResults = await searchAllVisions(query, limit);

            // Get full vision documents from MongoDB
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<VisionDocument>("visions");

            // Extract vision IDs from vector results
            const visionIds = vectorResults.ids[0]?.map(id => ({ _id: new ObjectId(id) })) || [];
            
            if (visionIds.length === 0) {
              return {
                type: "search_all_results",
                query: query,
                results: [],
                totalFound: 0,
                suppressOutput: true,
                ui: {
                  type: "search_all_results",
                  title: "Search Results (All Users)",
                  description: `No visions found matching "${query}" across all users`,
                  query: query,
                  results: []
                }
              };
            }

            // Get vision documents
            const visions = await collection
              .find({ $or: visionIds })
              .toArray();

            // Map results with similarity scores and filter for good matches
            const resultsWithScores = vectorResults.ids[0].map((id, index) => {
              const vision = visions.find(v => v._id?.toString() === id);
              const distance = vectorResults.distances?.[0]?.[index];
              const document = vectorResults.documents?.[0]?.[index];
              
              if (vision && distance !== undefined) {
                // Convert ChromaDB's squared L2 distance to cosine similarity
                // For normalized embeddings: squared_L2 = 2 * (1 - cosine_similarity)
                // So: cosine_similarity = 1 - (squared_L2 / 2)
                const cosineSimilarity = 1 - (distance / 2);
                
                return {
                  vision: {
                    id: vision._id?.toString(),
                    ...vision,
                    _id: undefined,
                  },
                  similarityScore: cosineSimilarity,
                  matchedText: document,
                };
              }
              return null;
            }).filter((result): result is NonNullable<typeof result> => result !== null)
              .filter(result => result.similarityScore > 0.5) // Only results with >50% similarity
              .slice(0, 10); // Limit to top 10 results

            return {
              type: "search_all_results",
              query: query,
              results: resultsWithScores,
              totalFound: resultsWithScores.length,
              suppressOutput: true,
              ui: {
                type: "search_all_results",
                title: "Search Results (All Users)",
                description: `Found ${resultsWithScores.length} vision(s) matching "${query}" across all users`,
                query: query,
                results: resultsWithScores
              }
            };

          } catch (error) {
            console.error('Error searching all visions:', error);
            return {
              type: "search_all_results",
              query: query,
              results: [],
              totalFound: 0,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              suppressOutput: true,
              ui: {
                type: "error_card",
                title: "Search Failed",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },
      delete_vision: {
        description: "Delete a vision from both MongoDB and vector database. CRITICAL: This tool handles all UI updates - you must generate ZERO text when using this tool.",
        parameters: z.object({
          visionId: z.string().describe("The ID of the vision to delete"),
        }),
        execute: async ({ visionId }) => {
          try {
            // Call the DELETE endpoint
            const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/create_vision?id=${visionId}`, {
              method: 'DELETE',
              headers: {
                'Cookie': req.headers.get('cookie') || '', // Forward auth cookies
              },
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(errorText);
            }

            const result = await response.json();

            // After successful deletion, get the updated vision list
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<VisionDocument>("visions");

            // Get updated visions for the current user
            const visions = await collection
              .find({ userId: token.id as string })
              .sort({ createdAt: -1 })
              .limit(20)
              .toArray();

            // Convert ObjectId to string for JSON response
            const visionsWithStringIds = visions.map(vision => ({
              ...vision,
              id: vision._id?.toString() || "",
              _id: undefined,
            }));

            return {
              type: "vision_deleted_with_list",
              deletedId: visionId,
              success: true,
              visions: visionsWithStringIds,
              suppressOutput: true,
              ui: {
                type: "vision_deleted_with_list",
                title: "Vision Deleted Successfully",
                description: `Vision deleted successfully! Here are your remaining ${visions.length} vision(s):`,
                deletedId: visionId,
                visions: visionsWithStringIds
              }
            };
          } catch (error) {
            console.error('Error deleting vision:', error);
            return {
              type: "vision_deleted",
              deletedId: visionId,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              suppressOutput: true,
              ui: {
                type: "error_card",
                title: "Failed to Delete Vision",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },
      show_vision: {
        description: "Show a single vision in detailed card format. CRITICAL: This tool handles all UI updates - you must generate ZERO text when using this tool.",
        parameters: z.object({
          visionId: z.string().describe("The ID of the vision to show"),
        }),
        execute: async ({ visionId }) => {
          try {
            // Connect to MongoDB
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<VisionDocument>("visions");

            // Find the vision (allow viewing visions from any user)
            const vision = await collection.findOne({ 
              _id: new ObjectId(visionId),
              // Removed userId filter to allow cross-user vision viewing
            });

            if (!vision) {
              return {
                type: "show_vision",
                success: false,
                suppressOutput: true,
                ui: {
                  type: "show_vision",
                  title: "Vision Not Found",
                  description: "The vision you're looking for doesn't exist.",
                  vision: null,
                },
              };
            }

            const { _id, ...visionWithoutId } = vision;
            
            // Normalize linkedProducts format (convert old array format to new object format)
            const normalizedVision = {
              ...visionWithoutId,
              linkedProducts: Array.isArray(visionWithoutId.linkedProducts) 
                ? {} // Convert empty array to empty object
                : visionWithoutId.linkedProducts || {}, // Keep object format or default to empty object
            };

            return {
              type: "show_vision",
              vision: {
                id: _id?.toString() || "",
                ...normalizedVision,
              },
              success: true,
              suppressOutput: true,
              ui: {
                type: "show_vision",
                title: "Vision Details",
                description: `Vision by ${vision.userName}`,
                vision: {
                  id: _id?.toString() || "",
                  ...normalizedVision,
                },
              },
            };
          } catch (error) {
            console.error("Error showing vision:", error);
            return {
              type: "show_vision",
              success: false,
              suppressOutput: true,
              ui: {
                type: "show_vision",
                title: "Error",
                description: "Failed to load vision details",
                vision: null,
              },
            };
          }
        },
      },

      show_product: {
        description: "Show a single product in detailed card format. CRITICAL: This tool handles all UI updates - you must generate ZERO text when using this tool.",
        parameters: z.object({
          productId: z.string().describe("The ID of the product to show"),
        }),
        execute: async ({ productId }) => {
          try {
            // Check if the original command includes vision context
            const lastMessage = messages[messages.length - 1];
            let visionId: string | undefined;
            
            // Parse vision context from message content
            if (lastMessage?.content) {
              let messageText = '';
              if (typeof lastMessage.content === 'string') {
                messageText = lastMessage.content;
              } else if (Array.isArray(lastMessage.content)) {
                messageText = lastMessage.content
                  .filter((part: any) => part.type === 'text')
                  .map((part: any) => part.text)
                  .join(' ');
              }
              
              // Look for pattern: "show product {productId} from vision {visionId}"
              const visionMatch = messageText.match(/from vision ([a-f0-9]{24})/i);
              if (visionMatch) {
                visionId = visionMatch[1];
                console.log(`🔗 Vision context detected: ${visionId}`);
              }
            }

            // Connect to MongoDB
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<ProductDocument>("products");

            // Find the product (allow viewing products from any user)
            const product = await collection.findOne({ 
              _id: new ObjectId(productId),
              // Removed userId filter to allow cross-user product viewing
            });

            if (!product) {
              return {
                type: "show_product",
                success: false,
                suppressOutput: true,
                ui: {
                  type: "show_product",
                  title: "Product Not Found",
                  description: "The product you're looking for doesn't exist.",
                  product: null,
                  visionId,
                },
              };
            }

            const { _id, ...productWithoutId } = product;
            
            return {
              type: "show_product",
              product: {
                id: _id?.toString() || "",
                ...productWithoutId,
              },
              success: true,
              suppressOutput: true,
              ui: {
                type: "show_product",
                title: "Product Details",
                description: `Product by ${product.userName}${visionId ? ` (from vision ${visionId.slice(-8)})` : ''}`,
                product: {
                  id: _id?.toString() || "",
                  ...productWithoutId,
                },
                visionId, // Pass vision context to UI
              },
            };
          } catch (error) {
            console.error("Error showing product:", error);
            return {
              type: "show_product",
              success: false,
              suppressOutput: true,
              ui: {
                type: "show_product",
                title: "Error",
                description: "Failed to load product details",
                product: null,
              },
            };
          }
        },
      },
      create_product_direct: {
        description: "Create a new product directly with description, file path, and price. CRITICAL: This tool handles all UI display - you must generate ZERO text when using this tool. No explanations, no confirmations, no text whatsoever.",
        parameters: z.object({
          productDescription: z.string().describe("The description of the product"),
          filePath: z.string().default("/no-file").describe("The file path for the product image"),
          price: z.number().optional().describe("The price of the product in dollars (will be converted to cents)"),
        }),
        execute: async ({ productDescription, filePath, price }) => {
          try {
            const requestBody = {
              productDescription,
              filePath,
              price: price ? Math.round(price * 100) : undefined, // Convert to cents
            };

            const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/create_product`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Cookie': req.headers.get('cookie') || '', // Forward auth cookies
              },
              body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(errorText);
            }

            const result = await response.json();

            // After successful creation, get the updated product list
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<ProductDocument>("products");

            // Get updated products for the current user
            const products = await collection
              .find({ userId: token.id as string })
              .sort({ createdAt: -1 })
              .limit(20)
              .toArray();

            // Convert ObjectId to string for JSON response
            const productsWithStringIds = products.map(product => ({
              ...product,
              id: product._id?.toString() || "",
              _id: undefined,
            }));

            return {
              type: "product_created_with_list",
              product: result.product,
              linkedVision: result.linkedVision,
              products: productsWithStringIds,
              success: true,
              suppressOutput: true,
              ui: {
                type: "product_created_with_list",
                title: "Product Created Successfully",
                description: `Product created successfully! ${result.linkedVision ? `Linked to vision: ${result.linkedVision.visionDescription} (similarity: ${(result.linkedVision.similarityScore * 100).toFixed(1)}%)` : 'No similar vision found for linking.'}`,
                product: result.product,
                linkedVision: result.linkedVision,
                products: productsWithStringIds
              }
            };
          } catch (error) {
            console.error('Error creating product:', error);
            return {
              type: "product_created",
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              suppressOutput: true,
              ui: {
                type: "error_card",
                title: "Failed to Create Product",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },
      list_my_products: {
        description: "List all products created by the current user. CRITICAL: This tool handles all UI display - you must generate ZERO text when using this tool. No explanations, no confirmations, no text whatsoever.",
        parameters: z.object({
          limit: z.number().default(20).describe("Maximum number of products to return"),
          skip: z.number().default(0).describe("Number of products to skip for pagination"),
        }),
        execute: async ({ limit, skip }) => {
          try {
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<ProductDocument>("products");

            // Get products for the current user
            const products = await collection
              .find({ userId: token.id as string })
              .sort({ createdAt: -1 })
              .skip(skip)
              .limit(limit)
              .toArray();

            // Convert ObjectId to string for JSON response
            const productsWithStringIds = products.map(product => ({
              ...product,
              id: product._id?.toString() || "",
              _id: undefined,
            }));

            // Get total count for pagination
            const totalCount = await collection.countDocuments({ userId: token.id as string });

            return {
              type: "products_list",
              products: productsWithStringIds,
              totalCount,
              limit,
              skip,
              hasMore: skip + limit < totalCount,
              suppressOutput: true,
              ui: {
                type: "products_list",
                title: "My Products",
                description: `You have ${totalCount} product(s) total. Showing ${products.length} products:`,
                products: productsWithStringIds,
                pagination: {
                  total: totalCount,
                  skip,
                  limit,
                  hasMore: skip + limit < totalCount,
                }
              }
            };
          } catch (error) {
            console.error('Error listing products:', error);
            return {
              type: "products_list",
              products: [],
              totalCount: 0,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              suppressOutput: true,
              ui: {
                type: "error_card",
                title: "Failed to Load Products",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },
      delete_product: {
        description: "Delete a product from both MongoDB and vector database. CRITICAL: This tool handles all UI updates - you must generate ZERO text when using this tool.",
        parameters: z.object({
          productId: z.string().describe("The ID of the product to delete"),
        }),
        execute: async ({ productId }) => {
          try {
            // Call the DELETE endpoint
            const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/create_product?id=${productId}`, {
              method: 'DELETE',
              headers: {
                'Cookie': req.headers.get('cookie') || '', // Forward auth cookies
              },
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(errorText);
            }

            const result = await response.json();

            // After successful deletion, get the updated product list
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<ProductDocument>("products");

            // Get updated products for the current user
            const products = await collection
              .find({ userId: token.id as string })
              .sort({ createdAt: -1 })
              .limit(20)
              .toArray();

            // Convert ObjectId to string for JSON response
            const productsWithStringIds = products.map(product => ({
              ...product,
              id: product._id?.toString() || "",
              _id: undefined,
            }));

            return {
              type: "product_deleted_with_list",
              deletedId: productId,
              success: true,
              products: productsWithStringIds,
              suppressOutput: true,
              ui: {
                type: "product_deleted_with_list",
                title: "Product Deleted Successfully",
                description: `Product deleted successfully! Here are your remaining ${products.length} product(s):`,
                deletedId: productId,
                products: productsWithStringIds
              }
            };
          } catch (error) {
            console.error('Error deleting product:', error);
            return {
              type: "product_deleted",
              deletedId: productId,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              suppressOutput: true,
              ui: {
                type: "error_card",
                title: "Failed to Delete Product",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },

      intelligent_product_search: {
        description: "Search for products and/or services across Amazon, local stores, and local services with intelligent keyword refinement and quality evaluation.",
        parameters: z.object({
          query: z.string().describe("A clear, complete search query based on the user's current input for finding relevant products and/or services"),
        }),
        execute: async ({ query }) => {
          // Read search option from request headers
          const search_option = req.headers.get('X-Search-Option') || 'both';
          
          // Set search flags based on search_option
          const search_product = search_option === 'product' || search_option === 'both';
          const search_service = search_option === 'service' || search_option === 'both';
          
          // Declare searchTimeout outside try-catch for proper scope
          let searchTimeout: NodeJS.Timeout | null = null;
          
          try {
            console.log(`🎯 Backend: TOOL CALLED - intelligent_product_search`);
            console.log(`🔍 Backend: Starting intelligent search for: "${query}"`);
            console.log(`🔍 Backend: Search option: ${search_option}, search_product: ${search_product}, search_service: ${search_service}`);
            console.log(`🔍 Backend: refreshRequest:`, refreshRequest);
            console.log(`🔍 Backend: User ID: ${token.id}`);
            
            // Track user query in profile
            try {
              const { addQueryToProfile } = await import('@/lib/user-db');
              const userId = token.id as string;
              
              console.log(`🔧 DEBUG: Attempting to add query to profile for user ${userId}: "${query}"`);
              // Add query to user profile (handles both new queries and refresh queries)
              const updatedUser = await addQueryToProfile(userId, query);
              if (updatedUser) {
                console.log(`✅ Profile: Added query to user profile: "${query}", new profile length: ${updatedUser.profile?.length || 0}`);
              } else {
                console.error(`❌ Profile: addQueryToProfile returned null for user ${userId}`);
              }
            } catch (error) {
              console.error('❌ CRITICAL: Error adding query to profile:', error);
              console.error('❌ CRITICAL: User profile tracking is not working!');
              console.error('❌ CRITICAL: Check if users collection exists and MongoDB is connected');
              // Don't block search if profile update fails
            }
            
            // Clean up old search records
            cleanupActiveSearches();
            
            // Check for concurrent searches from the same user (unless it's a refresh)
            if (!refreshRequest && activeSearches.has(token.id as string)) {
              const existingSearch = activeSearches.get(token.id as string);
              const searchDuration = Math.round((Date.now() - existingSearch!.timestamp) / 1000);
              console.log(`🚫 Backend: Blocking concurrent search for user ${token.id}. Existing search: ${existingSearch?.searchId} (running for ${searchDuration}s)`);
              
              return {
                type: 'product_search' as const,
                result: {
                  originalQuery: query,
                  searchSteps: [{
                    keywords: `⚠️ SEARCH BLOCKED: ${query}`,
                    amazonResults: 0,
                    googleShoppingResults: 0,
                    refinementReason: `🚫 Another search is already in progress (running for ${searchDuration}s). Please wait for it to complete or try again in a few moments.`,
                    stepType: 'intent' as const
                  }],
                  recommendedProducts: [],
                  recommendedProduct: null,
                  searchSummary: `⚠️ Search blocked: Another product search is currently in progress. Please wait for the current search to complete before starting a new one.`,
                  sessionId: `blocked_${Date.now()}`,
                  allAccumulatedProducts: [],
                  suggestedKeywords: ['try again later', 'wait for current search', 'refresh page if stuck']
                }
              };
            }
            
                          // Register this search
              const searchId = `search_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              activeSearches.set(token.id as string, {
                timestamp: Date.now(),
                searchId
              });
              console.log(`✅ Backend: Registered new search ${searchId} for user ${token.id}`);
              
              // Set up timeout to automatically clean up this search if it takes too long
              searchTimeout = setTimeout(() => {
                if (activeSearches.has(token.id as string) && activeSearches.get(token.id as string)?.searchId === searchId) {
                  console.log(`⏰ Backend: Force cleaning up timed-out search ${searchId} for user ${token.id} after 60 seconds`);
                  activeSearches.delete(token.id as string);
                }
              }, 60000); // 60 seconds - longer than typical searches but still prevents indefinite blocking
              
              // Check if this is a refresh request
            if (refreshRequest) {
              if (refreshRequest.type === 'price_range_search') {
                console.log(`💰 Backend: Processing PRICE RANGE SEARCH:`, refreshRequest);
                console.log(`💰 Backend: User specified range: $${refreshRequest.priceMin} - $${refreshRequest.priceMax}`);
                // Handle price range search - start fresh search with price constraints
                query = refreshRequest.query; // Use the original query
                console.log(`🔍 Backend: Starting fresh search with FIXED price range: $${refreshRequest.priceMin} - $${refreshRequest.priceMax}`);
                console.log(`🔍 Backend: Using original query: "${query}"`);
                console.log(`🔒 Backend: Price constraints will be LOCKED throughout all iterations`);
                // Continue with normal search flow but with price constraints
              } else {
                console.log(`🔄 Backend: Processing refresh request:`, refreshRequest);
                console.log(`🎯 Backend: Passing search option to refresh: ${search_option}`);
                return await handleProductSearchRefresh(refreshRequest, token, search_option || 'both');
              }
            } else {
              console.log(`🔍 Backend: No refresh request, performing normal search`);
            }
            
            // Store the current query in historical collection (fire and forget)
            storeHistoricalQuery(query, token.id as string).catch(error => {
              console.warn('⚠️ Failed to store historical query:', error);
            });
            
                          // Search for similar historical queries to understand user intent
              let rewrittenQuery = query;
            let suggestedKeywords: string[] = [];
              const searchSteps: SearchStep[] = [];
              let historyTime = 0;
              let intentTime = 0;
              
              // Get last searched product bundles for context
              const historyStart = Date.now();
              const lastSearchedProductBundles = await getLastSearchedProductBundles(token.id as string);
              
              try {
                console.log(`🕒 Searching for similar historical queries...`);
                const historicalQueries = await searchSimilarHistoricalQueries(query, token.id as string, 30);
                historyTime = Date.now() - historyStart;
              
              console.log(`📚 BACKEND: Historical queries search result:`, {
                hasDocuments: !!historicalQueries.documents[0],
                queryCount: historicalQueries.documents[0]?.length || 0
              });
              
              if (historicalQueries.documents[0] && historicalQueries.documents[0].length > 0) {
                console.log(`📚 Found ${historicalQueries.documents[0].length} similar historical queries:`);
                
                // Sort historical queries by timestamp (most recent first)
                const queriesWithMetadata = historicalQueries.documents[0].map((hQuery, i) => ({
                  query: hQuery,
                  distance: historicalQueries.distances[0][i],
                  timestamp: historicalQueries.metadatas[0][i]?.createdAt || '',
                  metadata: historicalQueries.metadatas[0][i]
                }));
                
                // Sort by timestamp (newest first)
                queriesWithMetadata.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
                
                queriesWithMetadata.forEach((item, i) => {
                  const timeAgo = item.timestamp ? new Date(item.timestamp).toLocaleDateString() : 'unknown';
                  console.log(`  ${i + 1}. "${item.query}" (distance: ${item.distance?.toFixed(4)}, date: ${timeAgo})`);
                });
                
                // Check if this is a comparative query
                const comparativeTerms = ['more expensive', 'cheaper', 'more costly', 'less expensive', 'pricier', 'budget', 'premium', 'better', 'higher quality', 'lower quality', 'upgraded', 'downgrade', 'similar but', 'like this but', 'alternative', 'compare', 'versus'];
                const isComparativeQuery = comparativeTerms.some(term => query.toLowerCase().includes(term));
                
                if (isComparativeQuery && lastSearchedProductBundles.length > 0) {
                  console.log(`🔄 COMPARATIVE QUERY DETECTED: "${query}"`);
                  const latestBundle = lastSearchedProductBundles[0];
                  console.log(`📊 Reference bundle: "${latestBundle.originalQuery}" with ${latestBundle.finalProducts.length} products`);
                  latestBundle.finalProducts.forEach((product, index) => {
                    console.log(`   ${index + 1}. "${product.title}" ($${product.price})`);
                  });
                } else {
                  console.log(`🔍 Standard query processing: "${query}"`);
                }

                // Use LLM to reason about user intent and rewrite query
                console.log(`🔧 DEBUG: Starting intent rewriting for query: "${query}"`);
                const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                                
                // Get user profile for personalized context
                let userProfileContext = '';
                console.log(`🔧 DEBUG: Loading user profile for intent rewriting...`);
                try {
                  const { getUserProfile } = await import('@/lib/user-db');
                  const userProfile = await getUserProfile(token.id as string);
                  
                  if (userProfile && userProfile.profile.length > 0) {
                    // Create profile context for the AI using all current profile items
                    const profileItems = userProfile.profile; // Use all current profile items
                    userProfileContext = `this user has profile as follows: ${profileItems.join(', ')}.`;
                    console.log(`👤 Profile: userProfileContext: ${userProfileContext}`);
                    console.log(`👤 Profile: Added user context with ${profileItems.length} profile items`);
                  }
                } catch (error) {
                  console.error('⚠️ Profile: Error loading user profile for context:', error);
                  console.log(`🔧 DEBUG: Profile loading failed, continuing with empty profile context`);
                  // Continue without profile context if there's an error
                }
                
                const intentPrompt = `You need to understand the user's intent and rewrite the query to best achieve the user's goal.

Current query: "${query}"

USER PROFILE:
${userProfileContext}



CONVERSATIONAL CONTEXT (recent searches):
${lastSearchedProductBundles.length > 0 ? 
lastSearchedProductBundles.map((search, index) => `
${index + 1}. "${search.originalQuery}" → ${search.finalProducts.length} products (${search.createdAt.toLocaleDateString()})
   Key items: ${search.finalProducts.slice(0, 2).map(p => `"${p.title}" ($${p.price})`).join(', ')}${search.finalProducts.length > 2 ? ` +${search.finalProducts.length - 2} more` : ''}
`).join('')
: 'No recent searches.'}

COMPARATIVE QUERY RULES:
${lastSearchedProductBundles.length > 0 && (() => {
  const latestBundle = lastSearchedProductBundles[0];
  const bundlePrices = latestBundle.finalProducts.map(p => parseFloat((p.price || '').replace(/[$,]/g, '')) || 0);
  const avgPrice = bundlePrices.reduce((sum, price) => sum + price, 0) / bundlePrices.length;
  const totalPrice = bundlePrices.reduce((sum, price) => sum + price, 0);
  
  return `If query contains "more expensive/cheaper/better":
- "More expensive" → above $${Math.ceil(avgPrice * 1.25)} (avg) or $${Math.ceil(totalPrice * 1.25)} (total)
- "Cheaper" → under $${Math.floor(avgPrice * 0.75)} (avg) or $${Math.floor(totalPrice * 0.75)} (total)
- Reference: Last bundle $${totalPrice.toFixed(2)} total`;
})() || 'No price reference available.'}

TASK:
1. Summerize the user profile and only keep important profiles such as the user's name, age, gender, occupation, family status, marital status, health condition, height, weight, physical condition, income, financial status, psychological condition, etc., ignore the user's behaviors or activities or plans in the summary!!!
2. After the original query, append the user profile
3. Only use CONTEXT when it is helpful for comparison references
4. Generate 8-15 relevant keywords

Guidelines:
- Always keep ALL the exact words in the original query!!!!


Pay attention: don't let the personalized information to be too long and distort or undermine the original query


Respond in JSON:
{
  "rewritten_query": ${query} + "(user profile)",
  "suggested_keywords": ["keyword1", "keyword2", ...]
}

`;

                console.log(`🔧 DEBUG: About to call OpenAI for intent rewriting...`);
                console.log(`🔧 DEBUG: Profile context length: ${userProfileContext.length} chars`);
                const intentStart = Date.now();
                const intentResponse = await openaiClient.chat.completions.create({
                  model: "gpt-4.1",
                  messages: [{ role: "user", content: intentPrompt }],
                  temperature: 0.4,
                  max_tokens: 600
                });
                intentTime = Date.now() - intentStart;
                console.log(`🔧 DEBUG: OpenAI intent response received in ${intentTime}ms`);

                const responseContent = intentResponse.choices[0]?.message?.content?.trim();
                
                if (responseContent) {
                  console.log(`🔍 BACKEND: Raw intent response (${intentTime}ms):`, responseContent);
                  try {
                    // Strip markdown code blocks if present
                    let cleanJson = responseContent.trim();
                    if (cleanJson.startsWith('```json')) {
                      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                    } else if (cleanJson.startsWith('```')) {
                      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                    }
                    
                    console.log(`🔍 BACKEND: Cleaned JSON for parsing:`, cleanJson);
                    const intentData = JSON.parse(cleanJson);
                    // Handle both field names for backward compatibility
                    const rewrittenFromIntent = intentData.rewritten_query || intentData.modified_query;
                    
                    console.log(`🔍 Intent analysis result:`, { 
                      original: query, 
                      rewritten: rewrittenFromIntent, 
                      different: rewrittenFromIntent !== query,
                      fieldFound: intentData.rewritten_query ? 'rewritten_query' : intentData.modified_query ? 'modified_query' : 'none'
                    });
                    
                    if (rewrittenFromIntent && rewrittenFromIntent !== query) {
                      rewrittenQuery = rewrittenFromIntent;
                      if (isComparativeQuery) {
                        console.log(`🔄 COMPARATIVE REWRITE SUCCESS:`);
                        console.log(`   Original: "${query}"`);
                        console.log(`   Enhanced: "${rewrittenQuery}"`);
                        const latestBundle = lastSearchedProductBundles.length > 0 ? lastSearchedProductBundles[0] : null;
                        const firstProduct = latestBundle?.finalProducts?.[0];
                        console.log(`   Reference: $${firstProduct?.price || 'N/A'} ${firstProduct?.title || 'N/A'} (from ${latestBundle?.finalProducts.length || 0} product bundle)`);
                      } else {
                        console.log(`🧠 Intent-based rewritten query: "${rewrittenQuery}"`);
                      }
                    }
                    
                    if (intentData.suggested_keywords && Array.isArray(intentData.suggested_keywords)) {
                      suggestedKeywords = intentData.suggested_keywords;
                      console.log(`🏷️ BACKEND: Generated suggested keywords:`, suggestedKeywords);
                    } else {
                      console.log(`🏷️ BACKEND: No suggested keywords found in response:`, intentData);
                    }
                    
                    // Add the intent step to search steps if we have a rewritten query
                    if (rewrittenQuery !== query) {
                      searchSteps.push({
                        keywords: rewrittenQuery,
                        amazonResults: 0,
                        googleShoppingResults: 0,
                        refinementReason: `Intent-based rewrite from ${historicalQueries.documents[0].length} historical queries`,
                        stepType: 'intent'
                      });
                    }
                  } catch (jsonError) {
                    console.error('🚨 Error parsing intent JSON response:', jsonError);
                    console.error('🚨 Raw response content:', responseContent);
                    
                    // Try to extract just the rewritten_query from the JSON string manually
                    try {
                      const rewrittenQueryMatch = responseContent.match(/"rewritten_query"\s*:\s*"([^"]*)"/)
                      if (rewrittenQueryMatch && rewrittenQueryMatch[1] && rewrittenQueryMatch[1] !== query) {
                        rewrittenQuery = rewrittenQueryMatch[1];
                        console.log(`🧠 Intent-based rewritten query (manual extraction): "${rewrittenQuery}"`);
                      } else {
                        console.log(`🔄 Fallback: Using original query since extraction failed`);
                        // Don't change rewrittenQuery, keep it as original query
                      }
                      
                      // Try to extract suggested keywords manually too
                      const keywordsMatch = responseContent.match(/"suggested_keywords"\s*:\s*\[([^\]]*)\]/);
                      if (keywordsMatch && keywordsMatch[1]) {
                        try {
                          const keywordsArray = JSON.parse(`[${keywordsMatch[1]}]`);
                          if (Array.isArray(keywordsArray)) {
                            suggestedKeywords = keywordsArray;
                            console.log(`🏷️ BACKEND: Manually extracted suggested keywords:`, suggestedKeywords);
                          }
                        } catch (keywordError) {
                          console.error('🚨 Error parsing extracted keywords:', keywordError);
                        }
                      }
                    } catch (extractionError) {
                      console.error('🚨 Error in manual extraction:', extractionError);
                      console.log(`🔄 Complete fallback: Using original query`);
                      // Don't change rewrittenQuery, keep it as original query
                    }
                  }
                } else {
                  console.log(`🧠 No significant intent rewriting needed`);
                }
              } else {
                console.log(`📚 No similar historical queries found for this user - using profile-based intent rewriting`);
                
                // Get user profile for personalized context (even without historical queries)
                let userProfileContext = '';
                console.log(`🔧 DEBUG: Loading user profile for fallback intent rewriting...`);
                try {
                  const { getUserProfile } = await import('@/lib/user-db');
                  const userProfile = await getUserProfile(token.id as string);
                  
                  if (userProfile && userProfile.profile.length > 0) {
                    // Create profile context for the AI using all current profile items
                    const profileItems = userProfile.profile; // Use all current profile items
                    userProfileContext = `this user has profile as follows: ${profileItems.join(', ')}.`;
                    console.log(`👤 Profile: userProfileContext (fallback): ${userProfileContext}`);
                    console.log(`👤 Profile: Added user context with ${profileItems.length} profile items (fallback)`);
                  } else {
                    console.log(`👤 Profile: No profile items found for user (fallback)`);
                  }
                } catch (error) {
                  console.error('⚠️ Profile: Error loading user profile for fallback context:', error);
                  console.log(`🔧 DEBUG: Profile loading failed in fallback, continuing with empty profile context`);
                }
                
                // Fallback: generate intent rewriting and keywords with user profile context
                try {
                  const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                  
                  const fallbackPrompt = `You need to understand the user's intent and rewrite the query to best achieve the user's goal.

Current query: "${query}"

USER PROFILE:
${userProfileContext}

TASK:
1. Summerize the user profile and only keep important profiles such as the user's name, age, gender, occupation, family status, marital status, health condition, height, weight, etc., ignore the user's behaviors or activities or plans in the summary!!!
2. After the original query, append the user profile
3. Generate 8-15 relevant keywords

Guidelines:
- Always keep ALL the exact words in the original query!!!!

Pay attention: don't let the personalized information to be too long and distort or undermine the original query

Respond in JSON:
{
  "rewritten_query": "${query}" + "(user profile)",
  "suggested_keywords": ["keyword1", "keyword2", ...]
}

MINIMUM 8 keywords required, MAXIMUM 15 keywords allowed.`;

                  const fallbackResponse = await openaiClient.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{ role: "user", content: fallbackPrompt }],
                    temperature: 0.6,
                    max_tokens: 250
                  });

                  const fallbackContent = fallbackResponse.choices[0]?.message?.content?.trim();
                  
                  if (fallbackContent) {
                    console.log(`🔍 FALLBACK: Raw intent response:`, fallbackContent);
                    try {
                      // Strip markdown code blocks if present
                      let cleanJson = fallbackContent.trim();
                      if (cleanJson.startsWith('```json')) {
                        cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                      } else if (cleanJson.startsWith('```')) {
                        cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                      }
                      
                      const fallbackData = JSON.parse(cleanJson);
                      
                      // Handle rewritten query from fallback
                      const rewrittenFromFallback = fallbackData.rewritten_query;
                      if (rewrittenFromFallback && rewrittenFromFallback !== query) {
                        rewrittenQuery = rewrittenFromFallback;
                        console.log(`🧠 Fallback intent-based rewritten query: "${rewrittenQuery}"`);
                      }
                      
                      if (fallbackData.suggested_keywords && Array.isArray(fallbackData.suggested_keywords)) {
                        suggestedKeywords = fallbackData.suggested_keywords;
                        console.log(`🏷️ BACKEND: Generated fallback suggested keywords:`, suggestedKeywords);
                      }
                      
                      // Add the fallback intent step to search steps if we have a rewritten query
                      if (rewrittenQuery !== query) {
                        searchSteps.push({
                          keywords: rewrittenQuery,
                          amazonResults: 0,
                          googleShoppingResults: 0,
                          refinementReason: `Profile-based intent rewrite (no historical queries)`,
                          stepType: 'intent'
                        });
                      }
                    } catch (fallbackJsonError) {
                      console.error('🚨 Error parsing fallback JSON response:', fallbackJsonError);
                      console.error('🚨 Raw fallback content:', fallbackContent);
                    }
                  }
                } catch (fallbackError) {
                  console.error('⚠️ Error generating fallback keywords:', fallbackError);
                }
              }
            } catch (error) {
              console.error('⚠️ Error in historical query analysis:', error);
              // Continue with original query if historical analysis fails
            }
            
            // Final fallback: if no keywords were generated, create some basic ones
            if (!suggestedKeywords || suggestedKeywords.length === 0) {
              console.log(`🏷️ BACKEND: No keywords generated, using basic fallback`);
              // Generate basic keywords based on query type
              if (query.toLowerCase().includes('gift')) {
                suggestedKeywords = ['under $30', 'under $50', 'personalized', 'practical', 'popular', 'gift wrapping', 'fast shipping', 'premium brand', 'thoughtful', 'unique'];
              } else if (query.toLowerCase().includes('tech') || query.toLowerCase().includes('electronic')) {
                suggestedKeywords = ['wireless', 'rechargeable', 'portable', 'waterproof', 'top rated', 'latest model', 'smart features', 'bluetooth', 'premium', 'durable'];
              } else {
                suggestedKeywords = ['budget friendly', 'high quality', 'durable', 'bestseller', 'highly rated', 'top brand', 'fast shipping', 'premium', 'reliable', 'versatile'];
              }
              console.log(`🏷️ BACKEND: Using fallback keywords:`, suggestedKeywords);
            }

            // Ensure we have at least 8 keywords
            if (suggestedKeywords && suggestedKeywords.length < 8) {
              console.log(`🏷️ BACKEND: Only ${suggestedKeywords.length} keywords generated, padding to reach minimum of 8`);
              
              const additionalKeywords = [
                'premium quality', 'top rated', 'bestseller', 'highly reviewed', 
                'fast shipping', 'warranty included', 'trending', 'customer favorite',
                'budget friendly', 'value for money', 'durable', 'reliable',
                'compact', 'lightweight', 'easy to use', 'versatile', 'waterproof',
                'wireless', 'portable', 'rechargeable', 'smart', 'advanced'
              ];
              
              // Add keywords that aren't already in the list (case insensitive check)
              const uniqueAdditional = additionalKeywords.filter(keyword => 
                !suggestedKeywords.some(existing => 
                  existing.toLowerCase().includes(keyword.toLowerCase()) || 
                  keyword.toLowerCase().includes(existing.toLowerCase())
                )
              );
              
              // Add until we have at least 8
              while (suggestedKeywords.length < 8 && uniqueAdditional.length > 0) {
                suggestedKeywords.push(uniqueAdditional.shift()!);
              }
              
              console.log(`🏷️ BACKEND: Padded to ${suggestedKeywords.length} keywords:`, suggestedKeywords);
            }
            
            // =============================================================================
            // 🚀 RECURSIVE SEARCH SYSTEM - CLEAN IMPLEMENTATION 
            // =============================================================================
            


            // =============================================================================
            // 🧠 AI MODELS FOR RECURSIVE SEARCH
            // =============================================================================

            // Price Analyzer Model: Determines price range for each query/subquery
            const priceAnalyzerModel = async (
              query: string
            ): Promise<{ min?: number; max?: number } | undefined> => {
              try {
                const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

                const prompt = `You are a price analysis expert. Extract the EXACT price range specified in this query.

Query: "${query}"

Your task: Extract any explicit price ranges or price constraints mentioned in the query.

Guidelines:
1. If query mentions specific prices ("under $50", "around $100", "$20-40", "budget under 200"), extract those EXACTLY
2. If NO specific price is mentioned, return null
3. Don't estimate or guess prices - only extract what's explicitly stated

Return ONLY valid JSON:
- If price range found: {"min": number, "max": number}
- If only upper bound: {"min": 0, "max": number}  
- If only lower bound: {"min": number, "max": null}
- If NO price mentioned: null

Examples:
- "wireless headphones under $50" → {"min": 0, "max": 50}
- "professional microphone around $200" → {"min": 150, "max": 250}
- "budget camping gear under 100" → {"min": 0, "max": 100}
- "expensive laptop over $1000" → {"min": 1000, "max": null}
- "beach day essentials" → null`;

                const response = await openaiClient.chat.completions.create({
                  model: "gpt-4o",
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.1,
                  max_tokens: 100
                });

                const content = response.choices[0]?.message?.content?.trim();
                
                try {
                  if (content === 'null' || content === 'undefined') {
                    console.log(`💰 Price Analyzer: No explicit price range found in "${query}"`);
                    return undefined;
                  }
                  
                  const cleanContent = content?.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '') || '';
                  const result = JSON.parse(cleanContent);
                  
                  console.log(`💰 Price Analyzer: "${query}" → ${result ? `$${result.min || 0}-$${result.max || 'unlimited'}` : 'No price specified'}`);
                  return result;
                  
                } catch (parseError) {
                  console.error('💰 Price Analyzer JSON parse error:', parseError);
                  console.log('📝 Raw response:', content);
                  return undefined;
                }
              } catch (error) {
                console.error('💰 Price Analyzer error:', error);
                return undefined;
              }
            };

            // Gemini API Integration: Get product recommendations with retry and improved error handling
            const getGeminiProductRecommendations = async (query: string): Promise<Array<{description: string, necessity_score: number, type: string, search_location: string}>> => {
              const MAX_RETRIES = 2;
              
              // Helper function to fix common JSON issues
              const fixJsonString = (str: string): string => {
                try {
                  // Remove markdown formatting
                  let fixed = str.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
                  
                  // Handle truncated JSON by finding complete objects
                  if (fixed.includes('"description"')) {
                    // Find all complete objects with the new format
                    const objectMatches = [];
                    const regex = /\{[^{}]*"description"[^{}]*\}/g;
                    let match;
                    
                    while ((match = regex.exec(fixed)) !== null) {
                      try {
                        // Test if this object is valid JSON
                        JSON.parse(match[0]);
                        objectMatches.push(match[0]);
                      } catch {
                        // Skip invalid objects
                      }
                    }
                    
                    if (objectMatches.length > 0) {
                      fixed = '[' + objectMatches.join(',') + ']';
                      console.log(`🔧 Fixed JSON: Found ${objectMatches.length} complete objects`);
                      return fixed;
                    }
                  }
                  
                  // Try to fix unclosed strings and objects
                  if (fixed.includes('{"description"')) {
                    // Find the start of the last incomplete object and remove it
                    const lastCompleteObject = fixed.lastIndexOf('},');
                    if (lastCompleteObject > 0) {
                      fixed = fixed.substring(0, lastCompleteObject + 1) + ']';
                      console.log(`🔧 Truncated at last complete object`);
                    }
                  }
                  
                  // Ensure it starts and ends with array brackets
                  if (!fixed.startsWith('[')) fixed = '[' + fixed;
                  if (!fixed.endsWith(']') && !fixed.endsWith('}]')) {
                    // Remove any trailing incomplete content
                    const lastCompleteEnd = Math.max(fixed.lastIndexOf('}'), fixed.lastIndexOf(']'));
                    if (lastCompleteEnd > 0) {
                      fixed = fixed.substring(0, lastCompleteEnd + 1);
                    }
                    if (!fixed.endsWith(']')) fixed = fixed + ']';
                  }
                  
                  return fixed;
                } catch {
                  return str;
                }
              };

              for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                try {
                  console.log(`🤖 Gemini API: Getting product recommendations for "${query}" (attempt ${attempt}/${MAX_RETRIES})`);
                  
                  const geminiPrompt = `

TASK: Based on user's goal: ${query},  in which the user's profile is in the parentheses.


Ignoring the price, you will help the user to make a plan for the goal. 
A plan is a list of 1 - 30 products and/or services serving different and non-overlapping functionalities and purposes which work together to best achieve the user's goal.
Make the list as comprehensive and thorough as possible, but do not include unnecessary items to achieve the user's goal.
When making the plan, you should fully consider the user's profile, such as the user's name, age, gender, occupation, family status, marital status, health condition, height, weight, physical condition, income, financial status, psychological condition, etc.

SEARCH SCOPE:
- Include products: ${search_product}
- Include services: ${search_service}

${search_product && search_service ? 'You can include both products and services in your plan.' : 
  search_product ? 'CRITICAL: Only include products in your plan. All items must have "type": "product". Even if the query mentions services (like hotels, restaurants), interpret it as related products (like travel items, dining accessories, etc.).' : 
  'CRITICAL: Only include services in your plan. All items must have "type": "service". Focus on how to fulfill the user\'s goal.'}

Pay attention: output a json list containing descriptions, necessity score between 0 - 1, type, and search_location: 
{"description":"actual description...", "necessity_score": 0.5, "type": "product" or "service", "search_location": "location for search"} 



Necessity score measures how important the item is in the plan. 
For only one item in the plan, the necessity score should be 1. 
Don't overthink, if the user asks for some category of product, just output the product description of the category.

For search_location field:
- For products: Always use empty string ""
- For each service: 
  The service location for each service should not necessarily be the same as the user's location or the location mentioned in the user's query.
  You should reason about where the service should be located, to best achieve the user's goal. 


Pay attention: Output ONLY a json string, without any other text !!
Pay attention: always include the user's profile (inside the parentheses of the query) in each description!!!!

EXAMPLES:

For query: "I want to travel to New York" (products and services):
[ 
  {"description": "Travel backpack for carrying essentials", "necessity_score": 0.9, "type": "product", "search_location": ""},
  {"description": "Water bottle to stay hydrated", "necessity_score": 0.8, "type": "product", "search_location": ""},
  {"description": "Hotel in New York", "necessity_score": 1.0, "type": "service", "search_location": "New York, NY"},
  {"description": "Restaurant", "necessity_score": 1.0, "type": "service", "search_location": "New York, NY"},
]

For query: "I want to find an Italian restaurant near me" (products and services):
[ 
  {"description": "Italian restaurant", "necessity_score": 1, "type": "service", "search_location": "user_location"}
]

For query: "I need chocolate" (products only):
[ 
  {"description": "High-quality dark chocolate", "necessity_score": 1, "type": "product", "search_location": ""}
]

For query: "I want to find a dentist in Los Angeles" (products and services):
[ 
  {"description": "Dental services", "necessity_score": 1, "type": "service", "search_location": "Los Angeles, CA"}
]

For query: "I want to find a hotel" (products only):
[ 
  {"description": "Travel guidebook for finding accommodations", "necessity_score": 0.8, "type": "product", "search_location": ""},
  {"description": "Travel luggage for hotel stays", "necessity_score": 0.9, "type": "product", "search_location": ""}
]

JSON Array:`;

                  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      contents: [{
                        parts: [{
                          text: geminiPrompt
                        }]
                      }],
                      generationConfig: {
                        temperature: 0.3, // Lower temperature for more consistent JSON
                        maxOutputTokens: 800, // Reduced to prevent truncation
                        topP: 0.8,
                        topK: 10
                      }
                    })
                  });

                  if (!response.ok) {
                    throw new Error(`Gemini API request failed: ${response.status} ${response.statusText}`);
                  }

                  const data = await response.json();
                  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
                  
                  if (!content) {
                    console.warn(`⚠️ No content returned from Gemini API on attempt ${attempt}`);
                    if (attempt === MAX_RETRIES) {
                      console.log('🔍 Final attempt - using fallback');
                      return [{ description: query, necessity_score: 1.0, type: 'product', search_location: '' }]; // Fallback response
                    }
                    continue; // Try next attempt
                  }

                  console.log(`🤖 Gemini Raw Response (attempt ${attempt}): ${content.substring(0, 200)}...`);

                  // Try to parse JSON with error recovery
                  try {
                    let cleanContent = content.trim();
                    
                    // Try parsing as-is first
                    let products;
                    try {
                      products = JSON.parse(cleanContent);
                    } catch {
                      // If that fails, try to fix common issues
                      console.log(`🔧 Attempting to fix JSON on attempt ${attempt}`);
                      cleanContent = fixJsonString(cleanContent);
                      products = JSON.parse(cleanContent);
                    }
                    
                    // Validate the response format
                    if (!Array.isArray(products)) {
                      throw new Error('Response is not an array');
                    }
                    
                    // Validate and clean each item (product or service)
                    const validatedItems = products
                      .filter(item => item && typeof item === 'object')
                      .map(item => {
                        const description = String(item.description || item.product_description || '').trim();
                        const necessity_score = Math.max(0, Math.min(1, Number(item.necessity_score) || 0.5));
                        const type = String(item.type || 'product').toLowerCase();
                        
                        // Return object with both old and new format for compatibility
                        return {
                          product_description: description, // Old format for backward compatibility
                          description: description, // New format
                          necessity_score: necessity_score,
                          type: type,
                          search_location: item.search_location || '' // Preserve search_location field
                        };
                      })
                      .filter(item => item.description.length > 0)

                    if (validatedItems.length === 0) {
                      throw new Error('No valid items found in response');
                    }

                    console.log(`✅ Gemini API: Successfully parsed ${validatedItems.length} items on attempt ${attempt}`);
                    validatedItems.forEach((item, i) => 
                      console.log(`  ${i+1}. "${item.description}" (necessity: ${item.necessity_score}, type: ${item.type})`)
                    );

                    return validatedItems;
                    
                  } catch (parseError) {
                    console.error(`🚨 JSON parse error on attempt ${attempt}:`, parseError);
                    console.log(`📝 Content that failed to parse:`, content);
                    
                    if (attempt === MAX_RETRIES) {
                      console.log('🚨 All attempts failed, using fallback');
                      return [{ 
                        description: `Product for: ${query}`, 
                        necessity_score: 1.0,
                        type: 'product',
                        search_location: ''
                      }]; // Fallback response
                    }
                    // Continue to next attempt
                  }
                  
                } catch (error) {
                  console.error(`🚨 Gemini API error on attempt ${attempt}:`, error);
                  
                  if (attempt === MAX_RETRIES) {
                    console.log('🚨 All attempts exhausted, using fallback');
                    return [{
                      description: `Product for: ${query}`,
                      necessity_score: 1.0,
                      type: 'product',
                      search_location: ''
                    }];
                  }
                  
                  // Wait a bit before retry
                  await new Promise(resolve => setTimeout(resolve, 1000));
                }
              }
              
              // This should never be reached, but just in case
              return [{ description: query, necessity_score: 1.0, type: 'product', search_location: '' }];
            };

            // Utility function to validate subquery distinctness
            const validateSubqueryDistinctness = (subqueries: string[], originalQuery: string): string[] => {
              const validSubqueries: string[] = [];
              const keywordSets: Set<string>[] = [];
              
              console.log(`🔍 Validating distinctness of ${subqueries.length} subqueries for "${originalQuery}"`);
              
              for (const subquery of subqueries) {
                // Extract key words from the subquery (excluding common words)
                const commonWords = new Set(['and', 'or', 'for', 'with', 'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'from', 'outdoor', 'indoor']);
                const keywords = subquery.toLowerCase()
                  .split(/[\s\-_,]+/)
                  .filter(word => word.length > 2 && !commonWords.has(word));
                
                const keywordSet = new Set(keywords);
                
                // Check for semantic overlap with existing subqueries
                let isOverlapping = false;
                for (const existingSet of keywordSets) {
                  const intersection = new Set([...keywordSet].filter(x => existingSet.has(x)));
                  const union = new Set([...keywordSet, ...existingSet]);
                  const similarity = intersection.size / union.size;
                  
                  // If more than 40% keyword overlap, consider it overlapping
                  if (similarity > 0.4) {
                    console.log(`❌ Subquery "${subquery}" overlaps with existing query (${Math.round(similarity * 100)}% similarity)`);
                    isOverlapping = true;
                    break;
                  }
                }
                
                // Additional check for semantic similarity patterns
                const problematicPatterns = [
                  ['waterproof', 'sandproof', 'weather-resistant', 'water-resistant'],
                  ['mat', 'blanket', 'cover', 'tarp'],
                  ['picnic', 'outdoor', 'camping', 'beach'],
                  ['cleaning', 'maintenance', 'chemical', 'treatment'],
                  ['toy', 'game', 'fun', 'play'],
                  ['tool', 'equipment', 'gear', 'accessory']
                ];
                
                for (const existingSet of keywordSets) {
                  for (const pattern of problematicPatterns) {
                    const currentHasPattern = pattern.some(word => keywordSet.has(word));
                    const existingHasPattern = pattern.some(word => existingSet.has(word));
                    
                    if (currentHasPattern && existingHasPattern) {
                      const currentPatternWords = pattern.filter(word => keywordSet.has(word));
                      const existingPatternWords = pattern.filter(word => existingSet.has(word));
                      
                      if (currentPatternWords.length > 0 && existingPatternWords.length > 0) {
                        console.log(`❌ Subquery "${subquery}" uses similar pattern as existing query (${pattern[0]} category)`);
                        isOverlapping = true;
                        break;
                      }
                    }
                  }
                  if (isOverlapping) break;
                }
                
                if (!isOverlapping) {
                  validSubqueries.push(subquery);
                  keywordSets.push(keywordSet);
                  console.log(`✅ Subquery "${subquery}" is distinct`);
                } else {
                  console.log(`🚫 Rejected overlapping subquery: "${subquery}"`);
                }
              }
              
              // If we filtered out too many, create functional fallbacks
              if (validSubqueries.length < 2 && subqueries.length > 1) {
                console.log(`⚠️ Too few distinct subqueries (${validSubqueries.length}), creating functional fallbacks`);
                const baseTerm = originalQuery.replace(/\s+(items|accessories|equipment|gear|tools|products)\s*$/i, '');
                const functionalCategories = [
                  `${baseTerm} essential equipment`,
                  `${baseTerm} accessories and tools`,
                  `${baseTerm} storage and organization`,
                  `${baseTerm} safety and protection`
                ];
                
                // Add fallbacks that don't overlap with existing valid subqueries
                for (const fallback of functionalCategories) {
                  if (validSubqueries.length >= 3) break;
                  
                  const fallbackKeywords = new Set(fallback.toLowerCase().split(/[\s\-_,]+/).filter(w => w.length > 2));
                  let fallbackOverlaps = false;
                  
                  for (const existingSet of keywordSets) {
                    const intersection = new Set([...fallbackKeywords].filter(x => existingSet.has(x)));
                    if (intersection.size / fallbackKeywords.size > 0.3) {
                      fallbackOverlaps = true;
                      break;
                    }
                  }
                  
                  if (!fallbackOverlaps) {
                    validSubqueries.push(fallback);
                    keywordSets.push(fallbackKeywords);
                    console.log(`🔧 Added functional fallback: "${fallback}"`);
                  }
                }
              }
              
              console.log(`🎯 Final validated subqueries (${validSubqueries.length}):`, validSubqueries);
              return validSubqueries;
            };

            // Query Refinement Model: Generates 1-4 subqueries for recursive search
            const queryRefinementModel = async (
              query: string, 
              searchResults: any[], 
              level: number,
              currentTopProducts: any[] = []
            ): Promise<string[]> => {
              try {
                const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                
                const currentTopProductsText = currentTopProducts.length > 0 ? 
                  `\n\nCURRENT LEVEL TOP PRODUCTS (for context):
${currentTopProducts.slice(0, 5).map((p, i) => 
  `${i+1}. "${p.title}" - $${p.price || p.extracted_price || 'N/A'} (Score: ${p.evaluation?.score || 'N/A'})`
).join('\n')}` : '';

                const prompt = `You are a query refinement expert for product search. Given a current query and its search results, generate 1-4 focused subqueries that would help find better products through divide-and-conquer.

Current Query: "${query}"
Search Level: ${level}/3
Found Products: ${searchResults.length} products
Quality Issues: ${searchResults.filter(p => p.evaluation?.score < 60).length} low-quality products${currentTopProductsText}

Current Results Analysis:
${searchResults.length > 0 ? searchResults.slice(0, 3).map((p, i) => 
  `${i+1}. "${p.title}" - $${p.extracted_price || 'N/A'} (Score: ${p.evaluation?.score || 'N/A'})`
).join('\n') : 'No relevant products found'}

🔥 CRITICAL: GENERATE TRULY DISTINCT & COMPLEMENTARY CATEGORIES 🔥

Instructions:
1. Each subquery must serve a DIFFERENT PURPOSE/FUNCTION - no overlap! Different subqueries should be totally different from each other.
2. PAY ATTENTION: cover all the aspects of the original need as thoroughly as possible!!! Do not miss any major aspect.
3. Consinder what to eat, what to use, what to wear, what for health, what to play and etc...
3. Think about different USE CASES, not just different adjectives
4. Each branch should complement the others to form a complete solution
5. Avoid semantic similarity - "waterproof mats" vs "sandproof blankets" = BAD (same function)
5. Focus on FUNCTIONAL CATEGORIES rather than material properties
6. Generate 1-4 subqueries that together cover different aspects of the original need

✅ GOOD Examples (Distinct Functions):
- "outdoor picnic items" → ["picnic blankets and ground covers", "outdoor dining utensils and plates", "coolers and drink storage"]
- "swimming pool items" → ["pool cleaning equipment", "pool toys and games", "pool chemical maintenance", "pool filters and pumps"]
- "kitchen accessories" → ["cutting and prep tools", "storage and organization", "cooking appliances"]
- "camping gear" → ["shelter and sleeping equipment", "cooking and food storage", "navigation and safety tools"]

❌ BAD Examples (Overlapping Functions):
- "outdoor picnic items" → ["waterproof blankets", "sandproof mats", "weather-resistant covers"] ← All ground covers!
- "swimming pool items" → ["chlorine tablets", "pool chemicals", "water treatment"] ← All chemicals!
- "kitchen tools" → ["steel knives", "ceramic knives", "sharp cutting tools"] ← All knives!

🎯 STRATEGY: Think "What different JOBS need to be done?" not "What different MATERIALS exist?"

CRITICAL: Return ONLY a JSON array of 1-4 strings, no other text:
["focused subquery 1", "focused subquery 2", "focused subquery 3"]`;

                const response = await openaiClient.chat.completions.create({
                  model: "gpt-4o",
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.6,
                  max_tokens: 200
                });

                const content = response.choices[0]?.message?.content?.trim();
                if (content) {
                  let cleanJson = content.trim();
                  if (cleanJson.startsWith('```json')) {
                    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                  } else if (cleanJson.startsWith('```')) {
                    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                  }
                  
                  const subqueries = JSON.parse(cleanJson);
                  if (Array.isArray(subqueries) && subqueries.length > 0) {
                    console.log(`🔄 Query Refinement Model generated ${subqueries.length} subqueries for "${query}":`, subqueries);
                    
                    // Validate for overlapping/similar subqueries
                    const validatedSubqueries = validateSubqueryDistinctness(subqueries, query);
                    
                    if (validatedSubqueries.length !== subqueries.length) {
                      console.log(`⚠️ Detected overlapping subqueries, using ${validatedSubqueries.length} distinct ones:`, validatedSubqueries);
                    }
                    
                    return validatedSubqueries.slice(0, 4); // Max 4 subqueries
                  }
                }
                
                // Fallback: create simple variations
                return [`${query} high quality`, `${query} budget friendly`];
              } catch (error) {
                console.error('🚨 Query Refinement Model error:', error);
                return [`${query} high quality`]; // Simple fallback
              }
            };

            // Helper function to select the best fallback product
            // Helper function to generate concise titles
            const generateConciseTitle = (originalTitle: string): string => {
              // Take first 6 words and clean up common marketing terms
              const words = originalTitle.split(' ');
              let conciseWords = words.slice(0, 6);
              
              // Remove common marketing fluff words if we have enough words
              const fluffWords = ['for', 'with', 'the', 'and', 'or', 'in', 'of', 'to', 'a', 'an'];
              if (conciseWords.length > 3) {
                conciseWords = conciseWords.filter((word, index) => 
                  index < 2 || !fluffWords.includes(word.toLowerCase())
                );
              }
              
              return conciseWords.join(' ');
            };

            const selectBestFallbackProduct = (recommendedProducts: any[], allProducts: any[]) => {
              // Priority 1: Best recommended product
              if (recommendedProducts && recommendedProducts.length > 0) {
                return recommendedProducts[0];
              }
              
              // Priority 2: Best product by evaluation score
              const evaluatedProducts = allProducts
                .filter(p => p.evaluation?.score !== undefined)
                .sort((a, b) => b.evaluation.score - a.evaluation.score);
              
              if (evaluatedProducts.length > 0) {
                return evaluatedProducts[0];
              }
              
              // Priority 3: Product with highest rating
              const ratedProducts = allProducts
                .filter(p => p.rating !== undefined && p.rating !== null)
                .sort((a, b) => (b.rating || 0) - (a.rating || 0));
              
              if (ratedProducts.length > 0) {
                return ratedProducts[0];
              }
              
              // Priority 4: Any product (guaranteed fallback)
              return allProducts[0];
            };

            // Product Selection Model: Determines if current products are good enough
            const productSelectionModel = async (
              query: string,
              products: any[],
              level: number
            ): Promise<{ selectedProduct: any | null; shouldRefine: boolean }> => {
              console.log(`🎯 Product Selection Model: Analyzing ${products.length} products for "${query}"`);
              
              if (products.length === 0) {
                console.log(`❌ Product Selection Model: No products found`);
                return { selectedProduct: null, shouldRefine: false };
              }

              try {
                const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                
                // Filter for recommended products and sort by evaluation score
                const recommendedProducts = products
                  .filter(p => p.evaluation?.isRecommended)
                  .sort((a, b) => b.evaluation.score - a.evaluation.score)
                  .slice(0, 10); // Take top 10 for analysis

                if (recommendedProducts.length === 0) {
                  // If no recommended products, use fallback logic
                  const bestProduct = selectBestFallbackProduct([], products);
                  const conciseTitle = generateConciseTitle(bestProduct.title);
                  const productWithConciseTitle = {
                    ...bestProduct,
                    originalTitle: bestProduct.title,
                    title: conciseTitle,
                    conciseTitle: conciseTitle
                  };
                  console.log(`⚠️ Product Selection Model: No recommended products, selecting best available "${bestProduct.title}" (Score: ${bestProduct.evaluation?.score || 'N/A'})`);
                  console.log(`📝 Auto-generated Concise Title: "${conciseTitle}"`);
                  return { selectedProduct: productWithConciseTitle, shouldRefine: false };
                }

                const prompt = `You are a product selection expert. Analyze the query and select the BEST product from the recommended options.

QUERY: "${query}"

RECOMMENDED PRODUCTS:
${recommendedProducts.map((p, i) => 
  `${i+1}. "${p.title}"
     • Price: $${p.extracted_price || 'N/A'}
     • Rating: ${p.rating || 'N/A'}★ (${p.reviews || 0} reviews)
     • Quality Score: ${p.evaluation.score}/100
     • Source: ${p.source}
     • Description: ${p.snippet || 'No description'}`
).join('\n\n')}

YOUR TASK:
1. Select the single BEST product that best matches the user's query 
2. Create a CONCISE title (under 10 words) that captures the essence of the product

Consider:
- Relevance to the query
- Quality score and rating
- Price reasonableness
- User reviews and popularity

Return ONLY a JSON object with:
{
  "productIndex": 1,
  "conciseTitle": "Short Product Name",
  "reasoning": "Brief explanation of why this product is the best choice"
}

CONCISE TITLE GUIDELINES:
- Maximum 10 words
- Clear and descriptive
- Include key features/brand if important
- Remove marketing fluff and unnecessary details

Example transformations:
- "Band-Aid Travel Ready Portable Emergency First Aid Kit for Minor Wound Care..." → "Travel First Aid Kit"
- "Picnic Basket Set for 4 Persons with Large Insulated Cooler..." → "4-Person Picnic Basket Set"

Choose the product index (1-${recommendedProducts.length}) of the best product.`;

                const response = await openaiClient.chat.completions.create({
                  model: "gpt-4o",
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.3,
                  max_tokens: 200
                });

                const content = response.choices[0]?.message?.content?.trim();
                if (content) {
                  try {
                    let cleanJson = content.trim();
                    if (cleanJson.startsWith('```json')) {
                      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                    } else if (cleanJson.startsWith('```')) {
                      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                    }
                    
                    const decision = JSON.parse(cleanJson);
                    
                    if (decision.productIndex && decision.productIndex >= 1 && decision.productIndex <= recommendedProducts.length) {
                      const selectedProduct = {
                        ...recommendedProducts[decision.productIndex - 1],
                        // Store both original and concise titles
                        originalTitle: recommendedProducts[decision.productIndex - 1].title,
                        title: decision.conciseTitle || recommendedProducts[decision.productIndex - 1].title,
                        conciseTitle: decision.conciseTitle
                      };
                      console.log(`✅ Product Selection Model: Selected "${selectedProduct.originalTitle}" (Score: ${selectedProduct.evaluation.score})`);
                      console.log(`📝 Concise Title: "${selectedProduct.title}" - ${decision.reasoning || 'LLM selection'}`);
                      return { selectedProduct, shouldRefine: false };
                    } else {
                      console.log(`⚠️ Product Selection Model: Invalid product index ${decision.productIndex}, falling back to best product`);
                    }
                  } catch (parseError) {
                    console.log(`⚠️ Product Selection Model: JSON parsing failed (${parseError instanceof Error ? parseError.message : 'Unknown error'}), falling back to best product`);
                  }
                }
                
                // Smart fallback: always select the best available product
                const fallbackProduct = selectBestFallbackProduct(recommendedProducts, products);
                const fallbackConciseTitle = generateConciseTitle(fallbackProduct.title);
                const productWithFallbackTitle = {
                  ...fallbackProduct,
                  originalTitle: fallbackProduct.title,
                  title: fallbackConciseTitle,
                  conciseTitle: fallbackConciseTitle
                };
                console.log(`⚠️ Product Selection Model: Using fallback selection "${fallbackProduct.title}" (Score: ${fallbackProduct.evaluation?.score || 'N/A'})`);
                console.log(`📝 Auto-generated Concise Title: "${fallbackConciseTitle}"`);
                return { selectedProduct: productWithFallbackTitle, shouldRefine: false };

              } catch (error) {
                console.error('🚨 Product Selection Model error:', error);
                
                // Error fallback: use the same robust selection logic (use [] for recommendedProducts since we're in error state)
                const errorFallbackProduct = selectBestFallbackProduct([], products);
                const errorConciseTitle = generateConciseTitle(errorFallbackProduct.title);
                const productWithErrorTitle = {
                  ...errorFallbackProduct,
                  originalTitle: errorFallbackProduct.title,
                  title: errorConciseTitle,
                  conciseTitle: errorConciseTitle
                };
                console.log(`✅ Product Selection Model (error fallback): Selected "${errorFallbackProduct.title}" (Score: ${errorFallbackProduct.evaluation?.score || 'N/A'})`);
                console.log(`📝 Auto-generated Concise Title: "${errorConciseTitle}"`);
                return { selectedProduct: productWithErrorTitle, shouldRefine: false };
              }
            };

            // Service Selection Model: Determines the best service from recommended options
            const serviceSelectionModel = async (
              query: string,
              services: any[],
              level: number
            ): Promise<{ selectedService: any | null; shouldRefine: boolean }> => {
              console.log(`🏢 Service Selection Model: Analyzing ${services.length} services for "${query}"`);
              
              if (services.length === 0) {
                console.log(`❌ Service Selection Model: No services found`);
                return { selectedService: null, shouldRefine: false };
              }

              try {
                const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                
                // Filter for recommended services and sort by evaluation score
                const recommendedServices = services
                  .filter(s => s.evaluation?.isRecommended)
                  .sort((a, b) => b.evaluation.score - a.evaluation.score)
                  .slice(0, 10); // Take top 10 for analysis

                if (recommendedServices.length === 0) {
                  // If no recommended services, select the first available
                  const firstService = services[0];
                  console.log(`⚠️ Service Selection Model: No recommended services, selecting first available "${firstService.title || firstService.serviceDescription}"`);
                  return { selectedService: firstService, shouldRefine: false };
                }

                const prompt = `You are a service selection expert. Analyze the query and select the BEST service from the recommended options.

QUERY: "${query}"

RECOMMENDED SERVICES:
${recommendedServices.map((s, i) => 
  `${i+1}. "${s.title || s.serviceDescription || 'Service Provider'}"
     • Address: ${s.address || 'N/A'}
     • Rating: ${s.rating || 'N/A'}★ (${s.reviews || 0} reviews)
     • Quality Score: ${s.evaluation.score}/100
     • Source: ${s.source || 'local'}
     • Open Status: ${s.open_state || 'Unknown'}
     • Contact: ${s.phone ? 'Phone available' : 'No phone'}, ${s.website ? 'Website available' : 'No website'}
     • Type: ${s.type || 'Service'}`
).join('\n\n')}

YOUR TASK:
1. Select the single BEST service that most closely matches the user's query and you think is the best way to fulfill the user's goal
2. Create a CONCISE title (under 10 words) that captures the essence of the service

Consider:
- Relevance to the query
- Quality score and rating
- Availability (open status)
- Contact information availability
- Location convenience

Return ONLY a JSON object with:
{
  "serviceIndex": 1,
  "conciseTitle": "Short Service Name",
  "reasoning": "Brief explanation of why this service is the best choice"
}

CONCISE TITLE GUIDELINES:
- Maximum 10 words
- Clear and descriptive
- Include location if important (e.g., "LA", "Downtown")
- Focus on the main service type
- Remove marketing fluff and unnecessary details

Example transformations:
- "Professional House Cleaning Services in Los Angeles Area..." → "House Cleaning Service LA"
- "24/7 Emergency Plumbing Repair and Installation Services..." → "24/7 Emergency Plumbing"

Choose the service index (1-${recommendedServices.length}) of the best service.`;

                const response = await openaiClient.chat.completions.create({
                  model: "gpt-4o",
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.3,
                  max_tokens: 200
                });

                const content = response.choices[0]?.message?.content?.trim();
                if (content) {
                  try {
                    let cleanJson = content.trim();
                    if (cleanJson.startsWith('```json')) {
                      cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                    } else if (cleanJson.startsWith('```')) {
                      cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                    }
                    
                    const decision = JSON.parse(cleanJson);
                    
                    if (decision.serviceIndex && decision.serviceIndex >= 1 && decision.serviceIndex <= recommendedServices.length) {
                      const selectedService = {
                        ...recommendedServices[decision.serviceIndex - 1],
                        // Store both original and concise titles
                        originalTitle: recommendedServices[decision.serviceIndex - 1].title || recommendedServices[decision.serviceIndex - 1].serviceDescription,
                        title: decision.conciseTitle || recommendedServices[decision.serviceIndex - 1].title || recommendedServices[decision.serviceIndex - 1].serviceDescription,
                        conciseTitle: decision.conciseTitle
                      };
                      console.log(`✅ Service Selection Model: Selected "${selectedService.originalTitle}" (Score: ${selectedService.evaluation.score})`);
                      console.log(`📝 Concise Title: "${selectedService.title}" - ${decision.reasoning || 'LLM selection'}`);
                      return { selectedService, shouldRefine: false };
                    } else {
                      console.log(`⚠️ Service Selection Model: Invalid service index ${decision.serviceIndex}, falling back to best service`);
                    }
                  } catch (parseError) {
                    console.log(`⚠️ Service Selection Model: JSON parsing failed (${parseError instanceof Error ? parseError.message : 'Unknown error'}), falling back to best service`);
                  }
                }
                
                // Fallback: select the best service based on score
                const fallbackService = recommendedServices[0] || services[0];
                console.log(`⚠️ Service Selection Model: Using fallback selection "${fallbackService.title || fallbackService.serviceDescription}" (Score: ${fallbackService.evaluation?.score || 'N/A'})`);
                return { selectedService: fallbackService, shouldRefine: false };

              } catch (error) {
                console.error('🚨 Service Selection Model error:', error);
                
                // Error fallback: use the first available service
                const errorFallbackService = services[0];
                console.log(`🚨 Service Selection Model: Error fallback, selecting first available service "${errorFallbackService.title || errorFallbackService.serviceDescription}"`);
                return { selectedService: errorFallbackService, shouldRefine: false };
              }
            };

                        // =============================================================================
            // 🌟 GLOBAL BEST PRODUCTS COLLECTION
            // =============================================================================
            const globalBestProducts: any[] = []; // Single array to collect ALL best products

            // =============================================================================
            // 🌟 RECURSIVE QUERY INTERPRETER - MAIN SEARCH FUNCTION  
            // =============================================================================

            const queryInterpreter = async (
              query: string
            ): Promise<{ products: any[]; searchSteps: SearchStep[]; recommendedProducts: any[] }> => {
              console.log(`🌟 Gemini-based Query Interpreter: "${query}"`);
              const startTime = Date.now();
              
              // =============================================================================
              // Step 1: Extract price range from query
              // =============================================================================
              const step1Start = Date.now();
              const priceRange = await priceAnalyzerModel(query);
              const step1Time = Date.now() - step1Start;
              console.log(`💰 Price Range: ${priceRange ? `$${priceRange.min || 0}-$${priceRange.max || 'unlimited'}` : 'No price specified'} (${step1Time}ms)`);
              
              // =============================================================================
              // Step 2: Get Gemini product recommendations
              // =============================================================================
              const step2Start = Date.now();
              // Use rewritten query if available, otherwise use original query
              const queryToUse = rewrittenQuery || query;
              console.log(`🤖 Final query selection:`, { 
                original: query, 
                rewritten: rewrittenQuery, 
                using: queryToUse,
                isRewritten: rewrittenQuery !== query
              });
              const geminiRecommendations = await getGeminiProductRecommendations(queryToUse);
              const step2Time = Date.now() - step2Start;
              console.log(`🤖 Gemini returned ${geminiRecommendations.length} product recommendations (${step2Time}ms)`);
              
              // =============================================================================
              // Step 3: Search for each product description
              // =============================================================================
              const productMap = new Map<string, any>(); // Map product description to best product
              const searchSteps: SearchStep[] = [];
              const allProducts: any[] = []; // Master collection of all products
              
              let totalSearchTime = 0;
              let totalSelectionTime = 0;
              
              // =============================================================================
              // 🚀 TRUE PARALLEL EXECUTION: Search ALL products simultaneously
              // =============================================================================
              console.log(`🚀 Starting parallel search for ${geminiRecommendations.length} products simultaneously...`);
              const parallelSearchStart = Date.now();
              
              // Create search function for a single item (product or service)
              const searchSingleItem = async (recommendation: any, index: number, priceRange?: { min?: number; max?: number }) => {
                const description = recommendation.description || recommendation.product_description; // Support both new and old format
                const necessityScore = recommendation.necessity_score;
                const itemType = recommendation.type || 'product'; // default to product for backward compatibility
                const suggestedLocation = recommendation.search_location || ''; // Gemini's location suggestion
                const itemStartTime = Date.now();
                
                console.log(`🔍 [${index+1}/${geminiRecommendations.length}] Starting parallel search for ${itemType}: "${description}" (necessity: ${necessityScore})`);
                if (suggestedLocation) {
                  console.log(`📍 [${index+1}] Gemini suggested location: "${suggestedLocation}" for description: "${description}"`);
                }
                if (priceRange) {
                  console.log(`💰 [${index+1}] Applying price range: $${priceRange.min || 0} - $${priceRange.max || 'unlimited'}`);
                }
                
                try {
                  const cleanQuery = description.replace(/^["']|["']$/g, '');
                  
                  // Determine search location based on Gemini's suggestion and user location
                  const determineSearchLocation = (suggestedLocation: string, userLocation: {lat: number, lng: number} | null): string => {
                    if (!suggestedLocation) {
                      // No suggestion: use LA as default
                      return 'Los Angeles, CA';
                    }
                    
                    if (suggestedLocation === 'user_location') {
                      // Suggested user location: use user's actual location if available, otherwise LA
                      return userLocation ? `@${userLocation.lat},${userLocation.lng}` : 'Los Angeles, CA';
                    }
                    
                    // Specific location suggested: use that
                    return suggestedLocation;
                  };
                  
                  const serviceSearchLocation = determineSearchLocation(suggestedLocation, userLocation);
                  console.log(`📍 [${index+1}] Service search location determined: "${serviceSearchLocation}" (from suggestion: "${suggestedLocation}")`);
                  
                  // Define search functions for parallel execution within this product
                  const amazonSearchFn = async () => {
                    return await amazonSearchService.searchAmazonProducts({
                      query: cleanQuery,
                      maxResults: 20,
                      sortBy: 'featured',
                      priceMin: priceRange?.min,
                      priceMax: priceRange?.max
                    });
                  };

                  const googleShoppingSearchFn = async () => {
                    return await amazonSearchService.searchGoogleShoppingProductsFast({
                      query: cleanQuery,
                      maxResults: 20,
                      priceMin: priceRange?.min,
                      priceMax: priceRange?.max
                    });
                  };

                  const localProductSearchFn = async () => {
                    try {
                      const { searchLocalProducts, fetchLocalProductsFromMongo } = await import('@/lib/vector-db');
                      
                      // Convert price range to cents for ChromaDB filtering
                      const priceMinCents = priceRange?.min ? Math.round(priceRange.min * 100) : undefined;
                      const priceMaxCents = priceRange?.max ? Math.round(priceRange.max * 100) : undefined;
                      
                      const searchResults = await searchLocalProducts(
                        cleanQuery,
                        priceMinCents,
                        priceMaxCents,
                        20 // Max 10 local products
                      );
                      
                      if (searchResults.ids.length > 0) {
                        const localProducts = await fetchLocalProductsFromMongo(searchResults.ids);
                        console.log(`🏠 Retrieved ${localProducts.length} local products`);
                        return localProducts;
                      }
                      
                      return [];
                    } catch (error) {
                      console.error("❌ Error in local product search:", error);
                      return [];
                    }
                  };

                  const googleMapsServiceSearchFn = async () => {
                    try {
                      console.log(`🗺️ Searching Google Maps services for: "${cleanQuery}"`);
                      
                      // Import service search service
                      const { serviceSearchService } = await import('@/lib/google-maps-search');
                      
                      // Use the determined search location instead of hardcoded logic
                      const location = serviceSearchLocation;
                      
                      const googleMapsServices = await serviceSearchService.searchAllServices({
                        query: cleanQuery,
                        location: location,
                        maxResults: 20,
                        includeGoogleMaps: true,
                        includeLocal: false,
                        priceMin: priceRange?.min,
                        priceMax: priceRange?.max,
                        userLocation: userLocation,
                        radiusMiles: 5 // 5-mile radius
                      });
                      
                      console.log(`🗺️ Found ${googleMapsServices.length} Google Maps services`);
                      return googleMapsServices;
                    } catch (error) {
                      console.error("❌ Error in Google Maps service search:", error);
                      return [];
                    }
                  };

                  const localServiceSearchFn = async () => {
                    try {
                      console.log(`🏠 Searching local services for: "${cleanQuery}"`);
                      
                      // Search local services
                      const { searchLocalServices, fetchLocalServicesFromMongo } = await import('@/lib/vector-db');
                      const priceMinCents = priceRange?.min ? Math.round(priceRange.min * 100) : undefined;
                      const priceMaxCents = priceRange?.max ? Math.round(priceRange.max * 100) : undefined;
                      
                      const localSearchResults = await searchLocalServices(
                        cleanQuery,
                        priceMinCents,
                        priceMaxCents,
                        20 // Max 10 local services
                      );
                      
                      let localServices: any[] = [];
                      if (localSearchResults.ids.length > 0) {
                        localServices = await fetchLocalServicesFromMongo(localSearchResults.ids);
                        console.log(`🏢 Retrieved ${localServices.length} local services`);
                        
                        // Apply location-based filtering similar to Google Maps logic
                        if (suggestedLocation === 'user_location' && userLocation) {
                          // Case 1: Suggested user location + user location available → 5-mile filtering
                          localServices = localServices.filter(service => {
                            if (!service.coordinates) return false; // Exclude services without coordinates
                            
                            const distance = calculateDistance(
                              userLocation.lat, userLocation.lng,
                              service.coordinates.lat, service.coordinates.lng
                            );
                            
                            return distance <= 5; // 5-mile radius
                          });
                          console.log(`📍 [Local Services] Filtered to ${localServices.length} services within 5 miles of user location`);
                        } else if (suggestedLocation === 'user_location' && !userLocation) {
                          // Case 2: Suggested user location + no user location → filter to LA area
                          console.log(`📍 [Local Services] User location suggested but not available, filtering to Los Angeles area`);
                          localServices = localServices.filter(service => {
                            if (!service.address) return false; // Exclude services without address
                            
                            // Check if service address contains Los Angeles, LA, or California indicators
                            const address = service.address.toLowerCase();
                            return address.includes('los angeles') || 
                                   address.includes('la,') || 
                                   address.includes('california') || 
                                   address.includes('ca,') ||
                                   address.includes('ca ');
                          });
                          console.log(`📍 [Local Services] Filtered to ${localServices.length} services in Los Angeles area`);
                        } else if (suggestedLocation && suggestedLocation !== 'user_location') {
                          // Case 3: Other specific location suggested → filter to LA area as fallback
                          console.log(`📍 [Local Services] Specific location "${suggestedLocation}" suggested, filtering to Los Angeles area as fallback`);
                          localServices = localServices.filter(service => {
                            if (!service.address) return false; // Exclude services without address
                            
                            // Check if service address contains Los Angeles, LA, or California indicators
                            const address = service.address.toLowerCase();
                            return address.includes('los angeles') || 
                                   address.includes('la,') || 
                                   address.includes('california') || 
                                   address.includes('ca,') ||
                                   address.includes('ca ');
                          });
                          console.log(`📍 [Local Services] Filtered to ${localServices.length} services in Los Angeles area`);
                        } else {
                          // Case 4: No location suggestion → filter to LA area as default
                          console.log(`📍 [Local Services] No location suggestion, filtering to Los Angeles area as default`);
                          localServices = localServices.filter(service => {
                            if (!service.address) return false; // Exclude services without address
                            
                            // Check if service address contains Los Angeles, LA, or California indicators
                            const address = service.address.toLowerCase();
                            return address.includes('los angeles') || 
                                   address.includes('la,') || 
                                   address.includes('california') || 
                                   address.includes('ca,') ||
                                   address.includes('ca ');
                          });
                          console.log(`📍 [Local Services] Filtered to ${localServices.length} services in Los Angeles area`);
                        }
                      }
                      
                      return localServices;
                    } catch (error) {
                      console.error("❌ Error in local service search:", error);
                      return [];
                    }
                  };

                  // Execute searches in parallel based on item type
                  const apiSearchStart = Date.now();
                  let amazonProducts: any[] = [];
                  let googleShoppingProducts: any[] = [];
                  let localProducts: any[] = [];
                  let googleMapsServices: any[] = [];
                  let localServices: any[] = [];
                  
                  if (itemType === 'product') {
                    // Search for products in Amazon, Google Shopping, and local products
                    [amazonProducts, googleShoppingProducts, localProducts] = await Promise.all([
                      amazonSearchFn(),
                      googleShoppingSearchFn(),
                      localProductSearchFn()
                    ]);
                  } else if (itemType === 'service') {
                    // Search for services in Google Maps and local services in parallel
                    [googleMapsServices, localServices] = await Promise.all([
                      googleMapsServiceSearchFn(),
                      localServiceSearchFn()
                    ]);
                  }
                  
                  const apiSearchTime = Date.now() - apiSearchStart;

                  const amazonCount = amazonProducts.length;
                  const googleShoppingCount = googleShoppingProducts.length;
                  const localProductCount = localProducts.length;
                  const googleMapsServiceCount = googleMapsServices.length;
                  const localServiceCount = localServices.length;
                  
                  if (itemType === 'product') {
                    console.log(`📊 Product counts - Amazon: ${amazonCount}, Google: ${googleShoppingCount}, Local: ${localProductCount}`);
                  } else {
                    console.log(`📊 Service counts - Google Maps: ${googleMapsServiceCount}, Local: ${localServiceCount}`);
                  }
                  
                  // Combine and evaluate items (products or services)
                  const evaluateStart = Date.now();
                  let allCurrentItems = [];
                  let evaluatedItems = [];
                  let recommendedItems = [];
                  
                  if (itemType === 'product') {
                    allCurrentItems = [
                      ...amazonProducts,
                      ...googleShoppingProducts,
                      ...localProducts
                    ];

                    evaluatedItems = allCurrentItems.map(product => ({
                      ...product,
                      evaluation: amazonSearchService.evaluateProductQuality(product)
                    }));

                    recommendedItems = evaluatedItems.filter(p => p.evaluation?.isRecommended);
                  } else if (itemType === 'service') {
                    allCurrentItems = [
                      ...googleMapsServices,
                      ...localServices
                    ];
                    
                    // Import service search service for evaluation
                    const { serviceSearchService } = await import('@/lib/google-maps-search');
                    
                    // Evaluate each service using the service quality evaluation function
                    evaluatedItems = allCurrentItems.map(service => ({
                      ...service,
                      evaluation: serviceSearchService.evaluateServiceQuality(service)
                    }));
                    
                    // Filter only recommended services
                    recommendedItems = evaluatedItems.filter(s => s.evaluation?.isRecommended);
                  }
                  
                  const evaluateTime = Date.now() - evaluateStart;
                  
                  console.log(`📦 [${index+1}] "${description}": Found ${recommendedItems.length} recommended ${itemType}s from ${allCurrentItems.length} total (APIs: ${apiSearchTime}ms, Eval: ${evaluateTime}ms)`);
                  
                  // Create search step
                  const searchStep = {
                    keywords: description,
                    amazonResults: amazonCount,
                    googleShoppingResults: googleShoppingCount,
                    localResults: itemType === 'product' ? localProductCount : localServiceCount,
                    googleMapsResults: itemType === 'service' ? googleMapsServiceCount : undefined,
                    stepType: 'search' as const,
                    level: 1,
                    searchPath: `${index + 1}`
                  };
                  
                  // Item selection (product or service)
                  let selectedItem = null;
                  let selectionTime = 0;
                  
                  if (recommendedItems.length > 0) {
                    const selectionStart = Date.now();
                    
                    if (itemType === 'product') {
                      const selectionResult = await productSelectionModel(description, recommendedItems, 1);
                      selectionTime = Date.now() - selectionStart;
                      
                      if (selectionResult.selectedProduct) {
                        selectedItem = {
                          ...selectionResult.selectedProduct,
                          necessity_score: necessityScore,
                          description: description,
                          type: itemType
                        };
                        const displayPrice = selectedItem.price || selectedItem.extracted_price;
                        console.log(`✅ [${index+1}] Selected: "${selectedItem.title}" - ${displayPrice ? `$${displayPrice}` : 'Price unavailable'} (${selectionTime}ms)`);
                      } else {
                        console.log(`❌ [${index+1}] No suitable product selected for "${description}"`);
                      }
                    } else if (itemType === 'service') {
                      // Use the service selection model
                      const selectionResult = await serviceSelectionModel(description, recommendedItems, 1);
                      selectionTime = Date.now() - selectionStart;
                      
                      if (selectionResult.selectedService) {
                        selectedItem = {
                          ...selectionResult.selectedService,
                          necessity_score: necessityScore,
                          description: description,
                          type: itemType
                        };
                        const displayPrice = selectedItem.price || 'Price unavailable';
                        console.log(`✅ [${index+1}] Selected service: "${selectedItem.title || selectedItem.serviceDescription}" - ${displayPrice} (${selectionTime}ms)`);
                      } else {
                        console.log(`❌ [${index+1}] No suitable service selected for "${description}"`);
                      }
                    }
                  } else {
                    console.log(`❌ [${index+1}] No recommended ${itemType}s found for "${description}"`);
                  }
                  
                  const itemTime = Date.now() - itemStartTime;
                  console.log(`⏱️ [${index+1}] Total time: ${itemTime}ms`);
                  
                  // Ensure selectedItem has correct type field for UI separation
                  if (selectedItem && itemType === 'service') {
                    selectedItem.type = 'service';
                  } else if (selectedItem && itemType === 'product') {
                    selectedItem.type = 'product';
                  }
                  
                  return {
                    productDescription: description, // Keep old name for compatibility
                    selectedProduct: selectedItem, // Keep old name for compatibility  
                    searchStep,
                    evaluatedProducts: evaluatedItems, // Keep old name for compatibility
                    searchTime: apiSearchTime + evaluateTime,
                    selectionTime,
                    success: true,
                    itemType: itemType // Add item type for downstream processing
                  };
                  
                } catch (error) {
                  console.error(`🚨 [${index+1}] Search error for "${description}":`, error);
                  return {
                    productDescription: description,
                    selectedProduct: null,
                    searchStep: null,
                    evaluatedProducts: [],
                    searchTime: 0,
                    selectionTime: 0,
                    success: false,
                    error
                  };
                }
              };

              // Execute ALL product searches in parallel
              const allItemSearches = geminiRecommendations.map((recommendation, index) => 
                searchSingleItem(recommendation, index, priceRange)
              );
              
              const searchResults = await Promise.all(allItemSearches);
              const parallelSearchTime = Date.now() - parallelSearchStart;
              
              // Process results and update data structures
              for (const result of searchResults) {
                if (result.success) {
                  // Add to master collections
                  if (result.selectedProduct) {
                    productMap.set(result.productDescription, result.selectedProduct);
                  }
                  if (result.searchStep) {
                    searchSteps.push(result.searchStep);
                  }
                  allProducts.push(...result.evaluatedProducts);
                  
                  // Update timing totals
                  totalSearchTime += result.searchTime;
                  totalSelectionTime += result.selectionTime;
                }
              }
              
              console.log(`🚀 PARALLEL EXECUTION COMPLETE: ${geminiRecommendations.length} products searched simultaneously in ${parallelSearchTime}ms`);
              console.log(`⏱️ TIMING SUMMARY: Parallel total: ${parallelSearchTime}ms, Search: ${totalSearchTime}ms, Selection: ${totalSelectionTime}ms`);
              
              // =============================================================================
              // Step 5: Sort by necessity score and apply price filtering
              // =============================================================================
              const allSelectedProducts = Array.from(productMap.values());
              console.log(`🎯 Selected ${allSelectedProducts.length} products from ${geminiRecommendations.length} searches`);
              
              // Sort by necessity score (highest first)
              allSelectedProducts.sort((a, b) => b.necessity_score - a.necessity_score);
              
              let finalProducts: any[] = [];
              let totalPrice = 0;
              
              if (priceRange && priceRange.max !== null && priceRange.max !== undefined) {
                // Apply price filtering
                console.log(`💰 Applying price filter: max $${priceRange.max}`);
                
                for (const product of allSelectedProducts) {
                  // Handle price parsing - remove $ signs and other non-numeric characters
                  const hasOriginalPrice = product.price || product.extracted_price;
                  const rawPrice = hasOriginalPrice || '0';
                  const cleanPrice = typeof rawPrice === 'string' ? rawPrice.replace(/[$,]/g, '') : rawPrice;
                  const productPrice = parseFloat(cleanPrice) || 0;
                  
                  const priceStatus = hasOriginalPrice ? `$${productPrice}` : 'Price unavailable (treated as $0)';
                  console.log(`🔍 Price parsing for "${product.title}": raw="${rawPrice}" clean="${cleanPrice}" parsed=${productPrice} (${priceStatus})`);
                  
                  if (!isNaN(productPrice) && totalPrice + productPrice <= priceRange.max) {
                    finalProducts.push(product);
                    totalPrice += productPrice;
                    const priceDisplay = hasOriginalPrice ? `$${productPrice}` : 'Price unavailable (added as $0)';
                    console.log(`✅ Added "${product.title}" (${priceDisplay}) - Total: $${totalPrice.toFixed(2)}`);
                  } else {
                    const wouldExceed = totalPrice + productPrice;
                    console.log(`❌ Skipped "${product.title}" ($${productPrice}) - Would exceed budget ($${wouldExceed.toFixed(2)} > $${priceRange.max})`);
                  }
                }
              } else {
                // No price limit, include all products
                finalProducts = allSelectedProducts;
                totalPrice = finalProducts.reduce((sum, p) => {
                  const rawPrice = p.price || p.extracted_price || '0';
                  const cleanPrice = typeof rawPrice === 'string' ? rawPrice.replace(/[$,]/g, '') : rawPrice;
                  return sum + (parseFloat(cleanPrice) || 0);
                }, 0);
                console.log(`💰 No price limit - including all ${finalProducts.length} products - Total: $${totalPrice.toFixed(2)}`);
              }
              
              console.log(`🏆 Final selection: ${finalProducts.length} products, Total price: $${totalPrice.toFixed(2)}`);
              
              return {
                products: allSelectedProducts, // All found products for reference
                searchSteps: searchSteps,
                recommendedProducts: finalProducts // Final filtered products to display
              };
            };

            // =============================================================================
            // 🚀 START RECURSIVE SEARCH
            // =============================================================================

            // Execute Gemini-based search
            console.log(`🌟 Starting Gemini-based product search for: "${rewrittenQuery}"`);
            console.log(`⏱️ INITIALIZATION TIMING: History: ${historyTime}ms, Intent: ${intentTime}ms`);
            const searchResult = await queryInterpreter(rewrittenQuery);
            
            // Extract results
            const allProducts = searchResult.products;
            const globalSearchSteps = searchResult.searchSteps;
            const recommendedProducts = searchResult.recommendedProducts;
            
            console.log(`🔍 DEBUG: Gemini search results:`);
            console.log(`📊 DFS: Final search steps collected (${globalSearchSteps.length} total):`);
            globalSearchSteps.forEach((step, i) => {
              console.log(`   🔍 Search ${i + 1}: "${step.keywords}"`);
            });
            
            // Construct result variables for compatibility with existing result logic
            const allBestProducts = recommendedProducts; // Final filtered products from Gemini search
            const bestProduct = recommendedProducts.length > 0 ? recommendedProducts[0] : null;
            const allSelectedProductsForResult = recommendedProducts;
            
            console.log(`📦 Created allSelectedProductsForResult with ${allSelectedProductsForResult.length} products from Gemini search`);
            
            // Create summary based on Gemini search results
            let searchSummary: string;
            if (allBestProducts.length > 0) {
              searchSummary = `Found ${allBestProducts.length} best products from ${globalSearchSteps.length} Gemini search${globalSearchSteps.length > 1 ? 'es' : ''}. Selected by necessity score and price filtering.`;
            } else if (allProducts.length > 0) {
              searchSummary = `Found ${allProducts.length} products across ${globalSearchSteps.length} Gemini search${globalSearchSteps.length > 1 ? 'es' : ''}, but none met the price constraints.`;
            } else {
              searchSummary = `No products were found after ${globalSearchSteps.length} Gemini search${globalSearchSteps.length > 1 ? 'es' : ''}.`;
            }
            
            console.log(`🔍 DEBUG: Final result construction:`);
            console.log(`   - allBestProducts.length: ${allBestProducts.length}`);
            console.log(`   - allSelectedProductsForResult.length: ${allSelectedProductsForResult.length}`);
            console.log(`   - bestProduct exists: ${!!bestProduct}`);
            console.log(`   - Using: ${allSelectedProductsForResult.length > 0 ? `${allSelectedProductsForResult.length} products from Gemini search` : 'no products'}`);

            const result: ProductSearchResult = {
              originalQuery: query, // Keep the query as sent from frontend (could be user-modified)
              rewrittenQuery: rewrittenQuery !== query ? rewrittenQuery : undefined, // Add rewritten query if different from input
              searchSteps: globalSearchSteps,
              recommendedProduct: bestProduct || undefined,
              recommendedProducts: allSelectedProductsForResult,
              searchSummary,
              sessionId: `session_${Date.now()}`,
              allAccumulatedProducts: allProducts,
              suggestedKeywords: suggestedKeywords
            };
            
            console.log(`🎯 FINAL RESULT:`, { 
              originalQuery: result.originalQuery, 
              rewrittenQuery: result.rewrittenQuery, 
              hasRewritten: !!result.rewrittenQuery,
              productsCount: result.recommendedProducts?.length || 0 
            });
            if (result.recommendedProducts && result.recommendedProducts.length > 0) {
              console.log(`🏆 FINAL: Displaying ${result.recommendedProducts.length} products to user:`);
              result.recommendedProducts.forEach((p: any, idx: number) => {
                console.log(`  ${idx+1}. Level ${p.sourceLevel || 'unknown'}: "${p.title}" (from: ${p.product_description || p.sourceQuery || 'unknown'})`);
              });
            }

            // Store historical search result
            if (token?.id) {
              try {
                await storeHistoricalSearchResult(
                  {
                    originalQuery: query, // Store the original user query
                    finalProducts: result.recommendedProducts || [],
                    searchSteps: globalSearchSteps,
                    searchSummary
                  },
                  token.id as string,
                  token.name || '',
                  token.email || ''
                );
                console.log(`💾 Historical search result stored for user: ${token.id}`);
              } catch (error) {
                console.error('⚠️ Failed to store historical search result:', error);
              }
            }

            // Clean up search registration
            if (token?.id) {
              const searchRecord = activeSearches.get(token.id as string);
              const searchDuration = searchRecord ? Math.round((Date.now() - searchRecord.timestamp) / 1000) : 0;
              activeSearches.delete(token.id as string);
              console.log(`🧹 Backend: Completed search for user ${token.id} in ${searchDuration}s, removed from active searches`);
              
              if (searchDuration > 30) {
                console.log(`⚠️ Backend: Search took ${searchDuration}s (longer than maxDuration=30s) - this may cause frontend timeout issues`);
              }
            }

            return {
              type: "product_search",
              result,
              ui: {
                type: "product_search",
                title: "Product Search Results",
                description: `Found ${allProducts.length} products for "${rewrittenQuery}"`
              }
            };
          } catch (error) {
            console.error('🚨 Intelligent Product Search error:', error);
            
            return {
              type: "error",
              ui: {
                type: "error",
                title: "Product Search Failed", 
                description: error instanceof Error ? error.message : 'Unknown error occurred'
              }
            };
          }
        },
      },

      create_service_form: {
        description: "Display a service creation form for the user. CRITICAL: This tool handles all UI display - you must generate ZERO text when using this tool.",
        parameters: z.object({}),
        execute: async () => {
          return {
            type: "service_creation_ui",
            message: "Service creation form",
            ui_components: {
              title: "Create New Service",
              description: "Add a new service to your collection",
              form_fields: [
                {
                  type: "textarea",
                  name: "serviceDescription",
                  label: "Service Description",
                  placeholder: "Describe your service and optionally add a service URL for additional information.",
                  required: true,
                  rows: 4
                },
                {
                  type: "text",
                  name: "url",
                  label: "Service URL (Optional)",
                  placeholder: "https://example.com/service-page",
                  required: false
                },
                {
                  type: "number",
                  name: "price",
                  label: "Price (Optional)",
                  placeholder: "0.00",
                  required: false
                },
                {
                  type: "file",
                  name: "imageFile",
                  label: "Supporting File (Optional)",
                  accept: "image/*",
                  required: false
                }
              ],
              submit_button: {
                text: "Create Service",
                endpoint: "/api/create_service"
              }
            }
          };
        }
      },

      list_my_services: {
        description: "List all services created by the current user. CRITICAL: This tool handles all UI display - you must generate ZERO text when using this tool.",
        parameters: z.object({
          limit: z.number().default(20).describe("Maximum number of services to return"),
          skip: z.number().default(0).describe("Number of services to skip for pagination"),
        }),
        execute: async ({ limit, skip }) => {
          try {
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<any>("services");

            // Get services for the current user  
            const services = await collection
              .find({ userId: token.id as string })
              .sort({ createdAt: -1 })
              .skip(skip)
              .limit(limit)
              .toArray();

            const totalCount = await collection.countDocuments({ userId: token.id as string });
            const hasMore = skip + limit < totalCount;

            // Convert to plain objects with string IDs
            const servicesWithStringIds = services.map(service => ({
              ...service,
              id: service._id?.toString() || "",
              _id: undefined,
            }));

            return {
              type: "list_my_services",
              services: servicesWithStringIds,
              pagination: {
                total: totalCount,
                skip,
                limit,
                hasMore
              },
              success: true,
              suppressOutput: true,
              ui: {
                type: "services_list",
                title: "My Services",
                description: `You have ${totalCount} service${totalCount !== 1 ? 's' : ''}`,
                services: servicesWithStringIds,
                pagination: {
                  total: totalCount,
                  skip,
                  limit,
                  hasMore
                }
              }
            };
          } catch (error) {
            console.error("Error listing services:", error);
            return {
              type: "list_my_services",
              success: false,
              suppressOutput: true,
              ui: {
                type: "services_list",
                title: "Error",
                description: "Failed to load services",
                services: [],
                pagination: {
                  total: 0,
                  skip: 0,
                  limit,
                  hasMore: false
                }
              }
            };
          }
        }
      },

      delete_service: {
        description: "Delete a service from both MongoDB and vector database. CRITICAL: This tool handles all UI updates - you must generate ZERO text when using this tool.",
        parameters: z.object({
          serviceId: z.string().describe("The ID of the service to delete"),
        }),
        execute: async ({ serviceId }) => {
          try {
            // Call the DELETE endpoint
            const response = await fetch(`${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/api/create_service?id=${serviceId}`, {
              method: 'DELETE',
              headers: {
                'Cookie': req.headers.get('cookie') || '', // Forward auth cookies
              },
            });

            if (!response.ok) {
              const errorText = await response.text();
              throw new Error(errorText);
            }

            const result = await response.json();

            // After successful deletion, get the updated service list
            const client = await clientPromise;
            const db = client.db("visionverse");
            const collection = db.collection<ServiceDocument>("services");

            // Get updated services for the current user
            const services = await collection
              .find({ userId: token.id as string })
              .sort({ createdAt: -1 })
              .limit(20)
              .toArray();

            // Convert ObjectId to string for JSON response
            const servicesWithStringIds = services.map(service => ({
              ...service,
              id: service._id?.toString() || "",
              _id: undefined,
            }));

            return {
              type: "service_deleted_with_list",
              deletedId: serviceId,
              success: true,
              services: servicesWithStringIds,
              suppressOutput: true,
              ui: {
                type: "service_deleted_with_list",
                title: "Service Deleted Successfully",
                description: `Service deleted successfully! Here are your remaining ${services.length} service(s):`,
                deletedId: serviceId,
                services: servicesWithStringIds
              }
            };
          } catch (error) {
            console.error('Error deleting service:', error);
            return {
              type: "service_deleted",
              deletedId: serviceId,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error',
              suppressOutput: true,
              ui: {
                type: "error_card",
                title: "Failed to Delete Service",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },
    },
  });

    console.log("🤖 API: streamText completed, returning data stream response");
    console.log("🤖 API: If this was a product search, we should see tool calls in the stream");
    
    // Add debugging to track what's being streamed back
    const response = result.toDataStreamResponse();
    
    // Debug logging
    console.log("🎯 API: Response streaming initiated - tool UIs should render based on AI's tool calls");
    
    return response;
  } catch (error) {
    console.error("🚨 API: Error in streamText call:", error);
    console.error("🚨 API: This might be why the second search is failing");
    throw error;
  }
}
