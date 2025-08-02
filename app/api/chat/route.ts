import { openai } from "@ai-sdk/openai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import { streamText } from "ai";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import clientPromise from "@/lib/mongodb";
import { VisionDocument, Vision } from "@/types/vision";
import { storeVisionEmbedding, searchSimilarVisions, searchAllVisions, storeHistoricalQuery, searchSimilarHistoricalQueries } from "@/lib/vector-db";
import { storeHistoricalSearchResult, getLastSearchedProduct } from "@/lib/historical-search-db";
import amazonSearchService, { AmazonProduct, UnifiedProduct } from "@/lib/amazon-search";
import OpenAI from 'openai';
import { ProductSearchResult, SearchStep } from "@/components/product-search-ui";
import { ObjectId } from "mongodb";
import { ProductDocument, Product } from "@/types/product";

// Removed edge runtime since MongoDB requires Node.js modules
export const maxDuration = 30;

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
async function handleProductSearchRefresh(refreshRequest: any, token: any) {
  console.log(`🔄 Handling refresh: iteration ${refreshRequest.refreshFromIteration}, type ${refreshRequest.refreshType}`);
  
  const originalQuery = refreshRequest.originalQuery;
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
 • Source: ${p.source === 'amazon' ? 'Amazon' : p.source === 'google_shopping' ? 'Google Shopping' : 'Local Store'}
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
        const lastSearchedProduct = await getLastSearchedProduct(token.id as string);
        
        try {
          console.log(`🕒 Re-analyzing user intent from original query...`);
          const historicalQueries = await searchSimilarHistoricalQueries(originalQuery, token.id as string, 10);
          
          if (historicalQueries.documents[0] && historicalQueries.documents[0].length > 0) {
            // Sort historical queries by timestamp (most recent first)
            const queriesWithMetadata = historicalQueries.documents[0].map((hQuery, i) => ({
              query: hQuery,
              distance: historicalQueries.distances[0][i],
              timestamp: historicalQueries.metadatas[0][i]?.createdAt || '',
              metadata: historicalQueries.metadatas[0][i]
            }));
            
            queriesWithMetadata.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
            
            // Use LLM to regenerate intent
            const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
            
            const intentPrompt = `You are analyzing a user's search intent based on their historical product queries and their last searched product.

Current query: "${originalQuery}"

Historical similar queries from this user (ordered by recency, most recent first):
${queriesWithMetadata.map((item, i) => {
  const timeAgo = item.timestamp ? new Date(item.timestamp).toLocaleDateString() : 'unknown date';
  return `${i + 1}. "${item.query}" (${timeAgo})`;
}).join('\n')}

${lastSearchedProduct ? `
Last searched product (most recent product search):
- Query: "${lastSearchedProduct.originalQuery}"
- Selected Product: "${lastSearchedProduct.finalProduct.title}"
- Price: ${lastSearchedProduct.finalProduct.price}
- Source: ${lastSearchedProduct.finalProduct.source}
- Rating: ${lastSearchedProduct.finalProduct.rating || 'N/A'} (${lastSearchedProduct.finalProduct.reviews || 0} reviews)
- Search Date: ${lastSearchedProduct.createdAt.toLocaleDateString()}
- Recommend Score: ${lastSearchedProduct.finalProduct.evaluation.score}/100
` : 'No previous product searches found.'}

Based on these historical queries and the last searched product, try to understand the user's profile, preferences, and context.

IMPORTANT: When inferring user characteristics, prioritize MORE RECENT data.

Try your best to translate the abstract and ambiguous user's intent into more specific search query, but do not change the core intent.

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
      
      // Perform search with current query
      const searchProducts = await amazonSearchService.searchAllProducts({
        query: currentQuery,
        maxResults: 20,
        sortBy: 'featured',
        includeAmazon: true,
        includeGoogleShopping: true
      });

      allProducts.push(...searchProducts.map(p => ({
        ...p,
        evaluation: amazonSearchService.evaluateProductQuality(p)
      })));

      // Add this iteration to search steps
      const amazonCount = searchProducts.filter(p => p.source === 'amazon').length;
      const googleShoppingCount = searchProducts.filter(p => p.source === 'google_shopping').length;
      
      searchSteps.push({
        keywords: currentQuery,
        amazonResults: amazonCount,
        googleShoppingResults: googleShoppingCount,
        localResults: 0, // Simplified for refresh
        stepType: refreshFromIteration === 0 ? 'search' : 'refinement'
      });

      // Select best product from accumulated results
      const recommendedProducts = allProducts.filter(p => p.evaluation.isRecommended);
      if (recommendedProducts.length > 0) {
        bestProduct = recommendedProducts[0]; // Simplified selection
      }
    }

    let searchSummary: string;
    if (bestProduct && bestProduct.title) {
      searchSummary = `Refreshed search found "${bestProduct.title}" with a recommend score of ${bestProduct.evaluation.score}/100.`;
    } else {
      searchSummary = `Refreshed search completed but no suitable product was found.`;
    }

    const result: ProductSearchResult = {
      originalQuery,
      searchSteps,
      recommendedProduct: bestProduct || undefined,
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
            finalProduct: {
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
            },
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
  
  // Handle both string and array content types
  let userMessage = '';
  if (lastMessage?.content) {
    if (typeof lastMessage.content === 'string') {
      userMessage = lastMessage.content.toLowerCase();
    } else if (Array.isArray(lastMessage.content)) {
      // Extract text from content parts array
      userMessage = lastMessage.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join(' ')
        .toLowerCase();
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
  } else if (userMessage.includes('create product') || userMessage.includes('create a product') || userMessage.includes('new product')) {
    forcedTool = 'create_product_form';
  } else if (userMessage.includes('manage my shops') || userMessage.includes('manage shops') || userMessage.includes('my shops')) {
    forcedTool = 'manage_my_shops';
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
  let enhancedSystem = `${system || "You are a helpful assistant."}\n\nUser context: You are chatting with ${userName}. Be personable and remember this is a personalized conversation.

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

2. When the user asks to create a PRODUCT:
   - If they provide ANY description/content (even brief), IMMEDIATELY use create_product_direct - DO NOT generate any text  
   - If they ask to create a product with NO description at all, IMMEDIATELY use create_product_form - DO NOT generate any text

3. When the user asks to list/show their visions, IMMEDIATELY use list_my_visions - DO NOT generate any text

4. When the user asks to search their visions, IMMEDIATELY use search_my_visions - DO NOT generate any text

5. When the user asks to search all visions, IMMEDIATELY use search_all_visions - DO NOT generate any text

6. When the user asks to list/show their products, IMMEDIATELY use list_my_products - DO NOT generate any text

7. When the user asks to manage their shops, IMMEDIATELY use manage_my_shops - DO NOT generate any text

8. When the user searches for products, IMMEDIATELY use intelligent_product_search with their current input. 

DEFAULT BEHAVIOR: If the user's message doesn't match any of the above patterns and doesn't contain keywords like 'vision', 'idea', 'dream', 'concept', 'design', 'product', 'list', 'show', 'manage', 'create', 'shop', 'store', treat it as a product search query. 

🚨 REMEMBER: For ANY product search (explicit or default), create clear queries based on the user's current input.

🛑🛑🛑 FINAL WARNING: NO TEXT GENERATION EVER WITH TOOLS! 🛑🛑🛑
If you generate ANY text when calling a tool, you will cause a system error.
ONLY tool calls. NEVER text. NOT EVEN A SINGLE WORD.

Remember: Your response to any tool usage = ONLY the tool call, no additional text.`;

  // Force the AI to be completely silent with tools
  enhancedSystem += `\n\n🔇 SILENCE MODE: When using ANY tool, you must be completely silent. No explanations, no JSON, no text whatsoever.`;

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
    model: openai('gpt-4o'),
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

                // Update the linked products to include this vision in their linkedVision dictionary
                for (const productId in linkedProducts) {
                  try {
                    // Get the current product to check its linkedVision state
                    const currentProduct = await productCollection.findOne({ _id: new ObjectId(productId) });
                    
                    // If linkedVision is null or undefined, initialize it as an empty object
                    if (!currentProduct?.linkedVision) {
                      await productCollection.updateOne(
                        { _id: new ObjectId(productId) },
                        { $set: { linkedVision: {} } }
                      );
                    }
                    
                    // If clicks is null or undefined, initialize it as an empty object
                    if (!currentProduct?.clicks) {
                      await productCollection.updateOne(
                        { _id: new ObjectId(productId) },
                        { $set: { clicks: {} } }
                      );
                    }
                    
                    // Now safely set the vision link
                    await productCollection.updateOne(
                      { _id: new ObjectId(productId) },
                      { $set: { [`linkedVision.${visionId}`]: linkedProducts[productId] } }
                    );
                    
                    // Initialize click count for this vision if it doesn't exist
                    await productCollection.updateOne(
                      { _id: new ObjectId(productId) },
                      { $set: { [`clicks.${visionId}`]: 0 } }
                    );
                    
                    console.log(`Added vision ${visionId} to product ${productId}'s linkedVision with similarity score ${linkedProducts[productId].toFixed(3)}`);
                    console.log(`Initialized click tracking for vision ${visionId} in product ${productId}`);
                  } catch (error) {
                    console.error("Error updating product's linkedVision:", error);
                    // Continue even if this fails
                  }
                }
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
      manage_my_shops: {
        description: "Show the user's shops management interface with their current shops and option to add new ones.",
        parameters: z.object({}),
        execute: async () => {
          try {
            // Connect to MongoDB
            const client = await clientPromise;
            const db = client.db("visionverse");
            const shopCollection = db.collection("shops");

            // Get user's current shops
            const shops = await shopCollection
              .find({ userId: token.id as string })
              .sort({ createdAt: -1 })
              .toArray();

            // Convert to Shop interface format
            const shopsData = shops.map(shop => ({
              id: shop._id.toString(),
              userId: shop.userId,
              userName: shop.userName,
              userEmail: shop.userEmail,
              platform: shop.platform,
              name: shop.name,
              url: shop.url,
              createdAt: shop.createdAt,
              updatedAt: shop.updatedAt,
            }));

            return {
              type: "manage_shops",
              shops: shopsData,
              ui: {
                type: "manage_shops",
                title: "Manage Your Shops",
                description: `You have ${shopsData.length} shop${shopsData.length !== 1 ? 's' : ''} configured`,
                shops: shopsData
              }
            };
          } catch (error) {
            console.error("Error fetching shops:", error);
            return {
              type: "error",
              ui: {
                type: "error",
                title: "Failed to Load Shops",
                description: error instanceof Error ? error.message : 'Unknown error'
              }
            };
          }
        },
      },
      intelligent_product_search: {
        description: "Search for products across Amazon and local stores with intelligent keyword refinement and quality evaluation.",
        parameters: z.object({
          query: z.string().describe("A clear, complete search query based on the user's current input for finding relevant products"),
        }),
        execute: async ({ query }) => {
          // Declare searchTimeout outside try-catch for proper scope
          let searchTimeout: NodeJS.Timeout | null = null;
          
          try {
            console.log(`🎯 Backend: TOOL CALLED - intelligent_product_search`);
            console.log(`🔍 Backend: Starting intelligent product search for: "${query}"`);
            console.log(`🔍 Backend: refreshRequest:`, refreshRequest);
            console.log(`🔍 Backend: User ID: ${token.id}`);
            
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
                    localResults: 0,
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
                return await handleProductSearchRefresh(refreshRequest, token);
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
              
              // Get last searched product for context
              const lastSearchedProduct = await getLastSearchedProduct(token.id as string);
              
              try {
                console.log(`🕒 Searching for similar historical queries...`);
                const historicalQueries = await searchSimilarHistoricalQueries(query, token.id as string, 10);
              
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
                
                if (isComparativeQuery && lastSearchedProduct) {
                  console.log(`🔄 COMPARATIVE QUERY DETECTED: "${query}"`);
                  console.log(`📊 Reference product: "${lastSearchedProduct.finalProduct.title}" ($${lastSearchedProduct.finalProduct.price})`);
                } else {
                  console.log(`🔍 Standard query processing: "${query}"`);
                }

                // Use LLM to reason about user intent and rewrite query
                const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                
                const intentPrompt = `You are analyzing a user's search intent based on their historical product queries and their last searched product.

Current query: "${query}"

Historical similar queries from this user (ordered by recency, most recent first):
${queriesWithMetadata.map((item, i) => {
  const timeAgo = item.timestamp ? new Date(item.timestamp).toLocaleDateString() : 'unknown date';
  return `${i + 1}. "${item.query}" (${timeAgo})`;
}).join('\n')}

${lastSearchedProduct ? `
Last searched product (most recent product search):
- Query: "${lastSearchedProduct.originalQuery}"
- Selected Product: "${lastSearchedProduct.finalProduct.title}"
- Price: ${lastSearchedProduct.finalProduct.price}
- Source: ${lastSearchedProduct.finalProduct.source}
- Rating: ${lastSearchedProduct.finalProduct.rating || 'N/A'} (${lastSearchedProduct.finalProduct.reviews || 0} reviews)
- Search Date: ${lastSearchedProduct.createdAt.toLocaleDateString()}
- Recommend Score: ${lastSearchedProduct.finalProduct.evaluation.score}/100
- Category: ${lastSearchedProduct.finalProduct.title.split(' ').slice(0, 2).join(' ')}
` : 'No previous product searches found.'}

🔥 CRITICAL: COMPARATIVE QUERY DETECTION 🔥
If the current query contains comparative language (like "more expensive", "cheaper", "better", "higher quality", "lower price", "more premium", "budget version", "upgraded", "similar but", etc.), you MUST:

1. **PRICE COMPARISONS**: When user asks for "more expensive", "cheaper", "higher/lower price":
   - Include EXACT price reference: "more expensive than $${lastSearchedProduct?.finalProduct.price || 'N/A'}" or "cheaper than $${lastSearchedProduct?.finalProduct.price || 'N/A'}"
   - For "more expensive": specify range "above $${lastSearchedProduct ? (() => {
     const currentPrice = parseFloat(lastSearchedProduct.finalProduct.price.replace(/[$,]/g, '')) || 0;
     return Math.ceil(currentPrice * 1.25);
   })() : 'N/A'}"
   - For "cheaper": specify range "under $${lastSearchedProduct ? (() => {
     const currentPrice = parseFloat(lastSearchedProduct.finalProduct.price.replace(/[$,]/g, '')) || 0;
     return Math.floor(currentPrice * 0.75);
   })() : 'N/A'}"
   - For "much more expensive": use 1.5x multiplier, for "slightly more": use 1.1x multiplier
   - For "much cheaper": use 0.5x multiplier, for "slightly cheaper": use 0.9x multiplier

2. **QUALITY COMPARISONS**: When user asks for "better", "higher quality", "more premium":
   - Include current product category and upgrade context
   - Reference current rating: "better than ${lastSearchedProduct?.finalProduct.rating || 'N/A'} star rating"
   - Mention specific improvements over current product

3. **FEATURE COMPARISONS**: When user mentions "similar but", "with better", "without":
   - Keep the same category: "${lastSearchedProduct?.finalProduct.title.split(' ').slice(0, 3).join(' ') || 'N/A'}"
   - Include specific feature modifications

Based on these historical queries and the last searched product, try to understand the user's profile, who the user is, what is the user preference, sex, age, hobbies, etc, ignore those one time queries.

IMPORTANT: When inferring user characteristics, prioritize MORE RECENT data:
1. The last searched product should be given the highest weight as it represents the most recent user behavior
2. Recent queries should override older patterns if there are conflicts
3. Consider the price range, product category, and features of the last searched product

For instance, if the user's last searched product was a luxury item, even if they historically searched for budget products, consider their current intent might be for higher-end products.

Try you best to translate the abstract and ambiguous user's intent into more accurate search query, but do not change the core intent.

Guidelines:
- Keep the core intent of the current query, do not fabricate any keywords, translation should be reasonable and based on the user's characteristics, behavior patterns and hobbies
- The historical queries and last searched product are only for you to infer the user's characteristics, behavior patterns and hobbies
- You can only extract user characteristics, behavior patterns and hobbies which are probably not changing over time (those about who the user is), and ignore those that can change over time
- When there are conflicting patterns, prioritize the last searched product and recent queries (those with newer dates)
- Do not guess or add any unneccesary keywords to the current query
- Use natural language, don't just add keywords
- **MOST IMPORTANT**: For comparative queries, ALWAYS include precise context from the previous search

IMPORTANT: Respond in JSON format with TWO fields:
1. "rewritten_query": The improved search query
2. "suggested_keywords": Array of EXACTLY 8-15 short keyword phrases (2-6 words each), about the categories, features, price ranges and etc, that the user might want to add to refine their search. These should be related to the user's profile and search history. MINIMUM 8 keywords required!

Example responses:

Standard query:
{
  "rewritten_query": "high-quality bluetooth headphones for working from home", 
  "suggested_keywords": ["noise cancelling", "under $100", "wireless charging", "long battery life", "comfortable padding", "over-ear", "bluetooth 5.0", "quick pairing", "premium brand", "sweat resistant"]
}

Comparative query - "more expensive one" (when last product was $80 headphones):
{
  "rewritten_query": "premium bluetooth headphones more expensive than $80 for working from home",
  "suggested_keywords": ["above $100", "luxury brand", "premium materials", "noise cancelling", "high-end features", "professional grade", "wireless charging", "long battery life", "audiophile quality", "flagship model"]
}

Comparative query - "cheaper option" (when last product was $150 smart watch):
{
  "rewritten_query": "budget smart watch cheaper than $150 price range with fitness tracking",
  "suggested_keywords": ["under $100", "budget friendly", "basic features", "fitness tracking", "heart rate monitor", "water resistant", "long battery life", "affordable brand", "good value", "entry level"]
}

Return ONLY valid JSON, no explanation.`;

                const intentResponse = await openaiClient.chat.completions.create({
                  model: "gpt-4o",
                  messages: [{ role: "user", content: intentPrompt }],
                  temperature: 0.4,
                  max_tokens: 300
                });

                const responseContent = intentResponse.choices[0]?.message?.content?.trim();
                
                if (responseContent) {
                  console.log(`🔍 BACKEND: Raw intent response:`, responseContent);
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
                    if (intentData.rewritten_query && intentData.rewritten_query !== query) {
                      rewrittenQuery = intentData.rewritten_query;
                      if (isComparativeQuery) {
                        console.log(`🔄 COMPARATIVE REWRITE SUCCESS:`);
                        console.log(`   Original: "${query}"`);
                        console.log(`   Enhanced: "${rewrittenQuery}"`);
                        console.log(`   Reference: $${lastSearchedProduct?.finalProduct.price || 'N/A'} ${lastSearchedProduct?.finalProduct.title || 'N/A'}`);
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
                        localResults: 0,
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
                console.log(`📚 No similar historical queries found for this user - generating fallback keywords`);
                
                // Fallback: generate suggested keywords without historical context
                try {
                  const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                  
                  const fallbackPrompt = `You are generating helpful keyword suggestions for a product search query.

Current query: "${query}"

Since there's no historical data available, generate relevant keyword suggestions that would help refine this search query. Consider common refinement categories like:
- Price ranges (under $X, budget-friendly, premium, etc.)
- Quality indicators (high-quality, durable, reliable, etc.)
- Features (wireless, portable, compact, waterproof, etc.)
- Use cases (for work, for home, for travel, for gifts, etc.)
- Brand preferences (popular brands, bestseller, top-rated, etc.)

IMPORTANT: Respond in JSON format with TWO fields:
1. "rewritten_query": Keep the original query unchanged (no rewriting without historical context)
2. "suggested_keywords": Array of EXACTLY 8-15 short keyword phrases (2-6 words each), about the categories, features, price ranges and etc, that the user might want to add to refine their search. These should be related to the user's profile and search history. MINIMUM 8 keywords required!

Example response:
{
  "rewritten_query": "${query}",
  "suggested_keywords": ["under $50", "high quality", "wireless", "portable", "top rated", "gift wrapping", "fast shipping", "bestseller", "premium", "waterproof"]
}

Return ONLY valid JSON, no explanation.`;

                  const fallbackResponse = await openaiClient.chat.completions.create({
                    model: "gpt-4o",
                    messages: [{ role: "user", content: fallbackPrompt }],
                    temperature: 0.6,
                    max_tokens: 250
                  });

                  const fallbackContent = fallbackResponse.choices[0]?.message?.content?.trim();
                  
                  if (fallbackContent) {
                    try {
                      const fallbackData = JSON.parse(fallbackContent);
                      if (fallbackData.suggested_keywords && Array.isArray(fallbackData.suggested_keywords)) {
                        suggestedKeywords = fallbackData.suggested_keywords;
                        console.log(`🏷️ BACKEND: Generated fallback suggested keywords:`, suggestedKeywords);
                      }
                    } catch (fallbackJsonError) {
                      console.error('🚨 Error parsing fallback JSON response:', fallbackJsonError);
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
            
            // Result containers
            let bestProduct: (any & { evaluation: any; source: 'amazon' | 'local' | 'google_shopping' }) | null = null;
            let allProducts: Array<any & { evaluation: any; source: 'amazon' | 'local' | 'google_shopping' }> = [];
            let allSelectedProductsForResult: Array<any & { evaluation: any; source: 'amazon' | 'local' | 'google_shopping' }> = [];
            
            // Global search steps collector (depth-first order)
            const globalSearchSteps: SearchStep[] = [];

            // =============================================================================
            // 🧠 AI MODELS FOR RECURSIVE SEARCH
            // =============================================================================

            // Price Analyzer Model: Determines price range for each query/subquery
            const priceAnalyzerModel = async (
              query: string,
              parentPriceRange?: { min?: number; max?: number },
              level: number = 1,
              userConstraints?: { min?: number; max?: number },
              currentTopProducts: any[] = []
            ): Promise<{ min?: number; max?: number }> => {
              try {
                const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                
                const isInitialQuery = level === 1;
                const constraintsText = userConstraints ? 
                  `\n\nUSER PRICE BOUNDS: The user has set a price range of $${userConstraints.min || 'any'} - $${userConstraints.max || 'any'}. You can choose any range within these bounds.` : '';
                
                const currentTopProductsText = currentTopProducts.length > 0 ? 
                  `\n\nCURRENT LEVEL TOP PRODUCTS (for price reference):
${currentTopProducts.slice(0, 3).map((p, i) => 
  `${i+1}. "${p.title}" - $${p.price || p.extracted_price || 'N/A'}`
).join('\n')}` : '';

                let promptText: string;
                if (isInitialQuery) {
                  promptText = `Analyze this product search query and determine an appropriate price range:

Query: "${query}"${constraintsText}${currentTopProductsText}

Instructions:
1. If the query mentions specific price terms like "cheap", "budget", "affordable", "expensive", "luxury", "high-end", "premium", extract the implied price range
2. If the query mentions specific dollar amounts, use those
3. If no price information is mentioned, set a range that makes sense for the product category
4. Choose the most appropriate price range for finding relevant products
${userConstraints ? `5. Stay within the user's bounds of $${userConstraints.min || 'any'} - $${userConstraints.max || 'any'}, but feel free to use a narrower range if it makes sense for the query.` : ''}

Examples:
- "cheap headphones" → {"min": 5, "max": 50}
- "luxury watch" → {"min": 500, "max": 5000}
- "budget laptop under $800" → {"min": 200, "max": 800}
- "expensive gaming chair" → {"min": 300, "max": 1500}
- "wireless mouse" (no price hint) → {"min": 15, "max": 150}

CRITICAL: Return ONLY a valid JSON object with min and max numbers, no other text:
{"min": 10, "max": 200}`;
                } else {
                  // Subquery price analysis
                  const parentText = parentPriceRange ? 
                    `Parent Price Range: $${parentPriceRange.min || 'unlimited'} - $${parentPriceRange.max || 'unlimited'}` : 
                    'No parent price range';
                  
                  promptText = `Analyze this product subquery and determine an appropriate price range:

Subquery: "${query}"
${parentText}
Search Level: ${level}/3${constraintsText}${currentTopProductsText}

Instructions:
1. Analyze the subquery for price indicators (budget, premium, luxury, cheap, expensive)
2. Consider the product category implied by the subquery
3. Stay within or slightly adjust the parent price range if provided
4. Be more specific than the parent range when possible

Examples:
- "budget wireless earbuds" (parent: $20-200) → {"min": 20, "max": 80}
- "premium noise cancelling headphones" (parent: $50-300) → {"min": 150, "max": 300}
- "swimming pool chlorine tablets" (parent: $10-100) → {"min": 15, "max": 60}

CRITICAL: Return ONLY a valid JSON object with min and max numbers:
{"min": 25, "max": 150}`;
                }

                                    const response = await openaiClient.chat.completions.create({
                      model: "gpt-4o",
                      messages: [{ role: "user", content: promptText }],
                      temperature: 0.4,
                      max_tokens: 100
                    });

                const content = response.choices[0]?.message?.content?.trim();
                if (content) {
                  let cleanJson = content.trim();
                  if (cleanJson.startsWith('```json')) {
                    cleanJson = cleanJson.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                  } else if (cleanJson.startsWith('```')) {
                    cleanJson = cleanJson.replace(/^```\s*/, '').replace(/\s*```$/, '');
                  }
                  
                  const priceRange = JSON.parse(cleanJson);
                  if (priceRange && typeof priceRange.min === 'number' && typeof priceRange.max === 'number') {
                    console.log(`💰 Price Analyzer Model: "${query}" → $${priceRange.min}-$${priceRange.max}`);
                    return priceRange;
                  }
                }
                
                // Fallback: use parent range or defaults
                return parentPriceRange || { min: 10, max: 200 };
              } catch (error) {
                console.error('🚨 Price Analyzer Model error:', error);
                return parentPriceRange || { min: 10, max: 200 };
              }
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

            // Product Selection Model: Determines if current products are good enough
            const productSelectionModel = async (
              query: string,
              products: any[],
              level: number
            ): Promise<{ selectedProduct: any | null; shouldRefine: boolean }> => {
              if (products.length === 0) {
                return { selectedProduct: null, shouldRefine: true };
              }

              try {
                const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                
                const topProducts = products
                  .filter(p => p.evaluation?.isRecommended)
                  .sort((a, b) => b.evaluation.score - a.evaluation.score)
                  .slice(0, 10);

                if (topProducts.length === 0) {
                  console.log(`🎯 Product Selection Model: No recommended products at level ${level}, should refine`);
                  return { selectedProduct: null, shouldRefine: level < 3 };
                }

                    const prompt = `You are a product selection expert. Analyze the query and available products to decide if they're good enough or if we need to refine the search further.

STEP 1 - QUERY ANALYSIS:
Query: "${query}"
Search Level: ${level}/3

First, determine if this query is BROAD or SPECIFIC:

A query should be considered BROAD if it:
- Could encompass multiple different product categories (e.g., "beach day essentials" covers blankets, sunscreen, games, food storage, etc.)
- Uses vague descriptors without specific product focus (e.g., "nice things for the garden") 
- Asks for collections/sets of items rather than a specific product
- Would benefit from being broken down into subcategories for better user experience

A query should be considered SPECIFIC if it:
- By common sense, it is specific enough and no need to split into subcategories
- Clearly refers to one specific product type (e.g., "wireless bluetooth headphones")
- Has clear product specifications or features mentioned
- Would likely result in very similar products regardless of refinement

Examples:
- BROAD: "kitchen essentials", "camping gear", "workout equipment", "baby items", "travel accessories"
- SPECIFIC: "wireless mouse", "running shoes", "coffee maker", "baby stroller", "laptop bag"

STEP 2 - PRODUCT EVALUATION:
Available Products: ${topProducts.length} recommended products

Products to analyze:
${topProducts.map((p, i) => 
  `${i+1}. "${p.title}"
     • Price: $${p.extracted_price || 'N/A'}
     • Rating: ${p.rating || 'N/A'}★ (${p.reviews || 0} reviews)
     • Quality Score: ${p.evaluation.score}/100
     • Source: ${p.source}`
).join('\n\n')}

STEP 3 - DECISION LOGIC:

For BROAD queries:
- ✅ REFINE the search to break into specific subcategories 
- ❌ Do NOT select any product unless it's absolutely exceptional (score ≥90 AND rating ≥4.8 AND perfectly matches the entire query scope)
- 🎯 Goal: Divide-and-conquer approach provides users with better organized, comprehensive results

For SPECIFIC queries:
- ✅ If any product has quality score ≥70 AND rating ≥4.0, SELECT the best one
- 🔄 If level < 3 and no good products found, REFINE for better results  
- 🏁 If level = 3 (max depth), SELECT the best available product regardless of quality

Return JSON with:
{
  "query_type": "BROAD" or "SPECIFIC",
  "reasoning": "Brief explanation of your decision including query analysis",
  "action": "select" or "refine",
  "productIndex": 1 (if select, 1-based index, null if refine)
}`;

                const response = await openaiClient.chat.completions.create({
                  model: "gpt-4o",
                  messages: [{ role: "user", content: prompt }],
                  temperature: 0.3,
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
                  
                  const decision = JSON.parse(cleanJson);
                  const queryType = decision.query_type || 'UNKNOWN';
                  
                  console.log(`🤖 Product Selection Model: Query classified as ${queryType}`);
                  console.log(`🤖 Decision: ${decision.action} - ${decision.reasoning || 'No reasoning provided'}`);
                  
                  if (decision.action === 'select' && decision.productIndex && topProducts[decision.productIndex - 1]) {
                    const selectedProduct = topProducts[decision.productIndex - 1];
                    console.log(`✅ Product Selection Model: Selected "${selectedProduct.title}" (Score: ${selectedProduct.evaluation.score})`);
                    return { selectedProduct, shouldRefine: false };
                  } else if (decision.action === 'refine') {
                    console.log(`🔄 Product Selection Model: Should refine search at level ${level}`);
                    return { selectedProduct: null, shouldRefine: level < 3 };
                  }
                }
                
                // Fallback: selection logic based on level
                const bestProduct = topProducts[0];
                console.log(`⚠️ Product Selection Model: JSON parsing failed, using fallback logic`);
                
                // Conservative fallback: assume broad at level 1, specific at deeper levels
                const assumeBroad = level === 1;
                
                if (assumeBroad) {
                  // For broad queries, be much more selective
                  const requiredScore = level === 1 ? 90 : level === 2 ? 85 : 75;
                  const requiredRating = level === 1 ? 4.8 : level === 2 ? 4.5 : 4.0;
                  
                  if (bestProduct.evaluation.score >= requiredScore && (bestProduct.rating || 0) >= requiredRating) {
                    console.log(`✅ Product Selection Model (fallback): Assumed broad but EXCEPTIONAL product "${bestProduct.title}" (Score: ${bestProduct.evaluation.score}, Rating: ${bestProduct.rating})`);
                    return { selectedProduct: bestProduct, shouldRefine: false };
                  } else {
                    console.log(`🔄 Product Selection Model (fallback): Assumed broad query "${query}" should refine (Level ${level}, Score: ${bestProduct.evaluation.score}/${requiredScore})`);
                    return { selectedProduct: null, shouldRefine: level < 3 };
                  }
                } else {
                  // For specific queries, use standard logic
                  if (bestProduct.evaluation.score >= 70 && (bestProduct.rating || 0) >= 4.0) {
                    console.log(`✅ Product Selection Model (fallback): Assumed specific query, selected "${bestProduct.title}" (Score: ${bestProduct.evaluation.score})`);
                    return { selectedProduct: bestProduct, shouldRefine: false };
                  } else {
                    console.log(`🔄 Product Selection Model (fallback): Low quality products for assumed specific query (best: ${bestProduct.evaluation.score}), should refine`);
                    return { selectedProduct: null, shouldRefine: level < 3 };
                  }
                }
              } catch (error) {
                console.error('🚨 Product Selection Model error:', error);
                // At level 3, always select best available (even for broad queries)
                if (level >= 3 && products.length > 0) {
                  const bestProduct = products
                    .filter(p => p.evaluation?.isRecommended)
                    .sort((a, b) => b.evaluation.score - a.evaluation.score)[0] || products[0];
                  console.log(`✅ Product Selection Model (error fallback): Max level reached, selecting best available "${bestProduct.title}"`);
                  return { selectedProduct: bestProduct, shouldRefine: false };
                }
                return { selectedProduct: null, shouldRefine: level < 3 };
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
              query: string,
              priceRange: { min?: number; max?: number },
              level: number,
              searchPath: string = ""
            ): Promise<{ products: any[]; bestProduct: any | null; searchSteps: SearchStep[] }> => {
              console.log(`🌟 Query Interpreter Level ${level}: "${query}" ($${priceRange.min || 'unlimited'}-$${priceRange.max || 'unlimited'})`);
              console.log(`🗂️ Search Path: ${searchPath || 'ROOT'}`);
              
              const currentSteps: SearchStep[] = [];
              let levelProducts: any[] = [];
              let currentLevelTopProducts: any[] = []; // Track current level's top products for context
              
              // =============================================================================
              // Step 1: Search Amazon, Google Shopping, and Local
              // =============================================================================
              let amazonCount = 0;
              let googleShoppingCount = 0;
              let localCount = 0;
              
              try {
                // Amazon + Google Shopping search
                const cleanQuery = query.replace(/^["']|["']$/g, '');
                const combinedProducts = await amazonSearchService.searchAllProducts({
                  query: cleanQuery,
                  maxResults: 20,
                  sortBy: 'featured',
                  includeAmazon: true,
                  includeGoogleShopping: true,
                  priceMin: priceRange.min,
                  priceMax: priceRange.max
                });
                
                amazonCount = combinedProducts.filter(p => p.source === 'amazon').length;
                googleShoppingCount = combinedProducts.filter(p => p.source === 'google_shopping').length;
                
                console.log(`🛒 Level ${level}: Amazon: ${amazonCount}, Google Shopping: ${googleShoppingCount}`);
                
                // Local search
                const { findSimilarProductsForVision } = await import("@/lib/vector-db");
                const vectorResults = await findSimilarProductsForVision(
                  cleanQuery,
                  token.id as string,
                  10
                );

                let localProducts: any[] = [];
                if (vectorResults.ids[0]?.length > 0) {
                  const client = await clientPromise;
                  const db = client.db("visionverse");
                  const productCollection = db.collection<ProductDocument>("products");
                  const productIds = vectorResults.ids[0].map(id => new ObjectId(id));
                  const foundProducts = await productCollection
                    .find({ _id: { $in: productIds } })
                    .toArray();

                  localProducts = foundProducts.map(p => ({
                    asin: p._id?.toString() || '',
                    title: p.productDescription,
                    link: p.url,
                    position: 0,
                    rating: 4.0,
                    reviews: 1,
                    source: 'local'
                  }));
                }
                localCount = localProducts.length;
                console.log(`🏪 Level ${level}: Local: ${localCount} products`);
                
                // Combine and evaluate products
                const allCurrentProducts = [
                  ...combinedProducts.map((p: any) => ({ ...p, source: p.source })),
                  ...localProducts.map((p: any) => ({ ...p, source: 'local' as const }))
                ];

                const evaluatedProducts = allCurrentProducts.map(product => ({
                  ...product,
                  evaluation: amazonSearchService.evaluateProductQuality(product)
                }));

                levelProducts = evaluatedProducts.filter(p => p.evaluation?.isRecommended).map(product => ({
                  ...product,
                  sourceQuery: query,
                  sourcePath: searchPath || 'ROOT',
                  sourceLevel: level
                }));
                
                console.log(`📦 Level ${level}: Direct search for "${query}" returned ${levelProducts.length} products:`);
                levelProducts.slice(0, 3).forEach((product, idx) => {
                  console.log(`   ${idx + 1}. "${product.title}" - $${product.price || product.extracted_price} (Score: ${product.evaluation?.score})`);
                });
                if (levelProducts.length > 3) {
                  console.log(`   ... and ${levelProducts.length - 3} more products`);
                }
                
                // =============================================================================
                // Track current level's top products for context in refinement models
                // =============================================================================
                currentLevelTopProducts = levelProducts
                  .sort((a, b) => b.evaluation.score - a.evaluation.score)
                  .slice(0, 5); // Keep top 5 for context
                
                console.log(`🎯 Level ${level}: Current top products (${currentLevelTopProducts.length}):`, 
                  currentLevelTopProducts.map(p => `"${p.title}" ($${p.price || p.extracted_price})`).join(', '));
                
                // Record this search step with depth-first tracking
                const searchStep = {
                  keywords: query,
                  amazonResults: amazonCount,
                  googleShoppingResults: googleShoppingCount,
                  localResults: localCount,
                  refinementReason: level > 1 ? `Level ${level} divide-and-conquer refinement` : undefined,
                  stepType: level > 1 ? 'refinement' as const : 'search' as const,
                  priceRange: priceRange.min !== undefined || priceRange.max !== undefined ? priceRange : undefined,
                  level: level, // Add explicit level tracking
                  searchPath: searchPath || 'ROOT' // Add search path for DFS visualization
                };
                
                currentSteps.push(searchStep);
                console.log(`📍 DFS: Added search step at Level ${level} - Path: ${searchPath || 'ROOT'} - Query: "${query}"`);

              } catch (error) {
                console.error(`🚨 Level ${level} search error:`, error);
              }

              // =============================================================================
              // Step 2: Call Product Selection Model
              // =============================================================================
              const selectionResult = await productSelectionModel(query, levelProducts, level);
              
              if (selectionResult.selectedProduct) {
                // Found a good product, add it to global collection
                const taggedSelectedProduct = {
                  ...selectionResult.selectedProduct,
                  sourceQuery: query,
                  sourcePath: searchPath || 'ROOT',
                  sourceLevel: level
                };
                globalBestProducts.push(taggedSelectedProduct);
                console.log(`✅ Level ${level}: Selected product "${selectionResult.selectedProduct.title}" - added to global collection`);
                console.log(`🎯 Level ${level}: Backtracking with selected product from current level top products`);
                return {
                  products: levelProducts,
                  bestProduct: selectionResult.selectedProduct,
                  searchSteps: currentSteps
                };
              }
              
              // =============================================================================
              // Step 3: If at max level (3), select best available
              // =============================================================================
              if (level >= 3) {
                console.log(`🏁 Level ${level}: Max depth reached, selecting best available product`);
                const bestAvailable = levelProducts.length > 0 
                  ? levelProducts.sort((a, b) => b.evaluation.score - a.evaluation.score)[0]
                  : null;
                console.log(`✅ Product Selection Model (fallback): Selected "${bestAvailable?.title || 'none'}"`);
                
                // Add fallback product to global collection if found
                if (bestAvailable) {
                  const taggedFallbackProduct = {
                    ...bestAvailable,
                    sourceQuery: query,
                    sourcePath: searchPath || 'ROOT',
                    sourceLevel: level
                  };
                  globalBestProducts.push(taggedFallbackProduct);
                  console.log(`🎯 Level ${level}: Fallback product added to global collection`);
                }
                console.log(`🎯 Level ${level}: Backtracking from max depth with current level top products: ${currentLevelTopProducts.length}`);
                  
                return {
                  products: levelProducts,
                  bestProduct: bestAvailable,
                  searchSteps: currentSteps
                };
              }
              
              // =============================================================================
              // Step 4: If should refine, call Query Refinement Model
              // =============================================================================
              if (selectionResult.shouldRefine) {
                console.log(`🔄 Level ${level}: Refining search with subqueries`);
                console.log(`🎯 Level ${level}: Enforcing DISTINCT & COMPLEMENTARY branches - no overlapping categories!`);
                const subqueries = await queryRefinementModel(query, levelProducts, level, currentLevelTopProducts);
                
                let allSubProducts: any[] = [...levelProducts];
                let bestSubProduct: any | null = null;
                let allSubSteps: SearchStep[] = [...currentSteps];
                
                // =============================================================================
                // Step 5: For each subquery, get price range and recursively call Query Interpreter
                // =============================================================================
                for (let i = 0; i < subqueries.length; i++) {
                  const subquery = subqueries[i];
                  const subPath = searchPath ? `${searchPath}.${i+1}` : `${i+1}`;
                  console.log(`🌿 Level ${level}: Processing subquery ${i+1}/${subqueries.length}: "${subquery}"`);
                  
                  // Get price range for this subquery
                  const subPriceRange = await priceAnalyzerModel(subquery, priceRange, level + 1, undefined, currentLevelTopProducts);
                  
                  // Recursive call - best products will be automatically added to globalBestProducts during recursion
                  const subResult = await queryInterpreter(subquery, subPriceRange, level + 1, subPath);
                  
                  // Collect results with source tracking
                  const taggedProducts = subResult.products.map(product => ({
                    ...product,
                    sourceQuery: subquery,
                    sourcePath: subPath,
                    sourceLevel: level + 1
                  }));
                  
                  allSubProducts.push(...taggedProducts);
                  allSubSteps.push(...subResult.searchSteps);
                  
                  console.log(`📦 Level ${level}: Subquery "${subquery}" returned ${subResult.products.length} products:`);
                  subResult.products.slice(0, 3).forEach((product, idx) => {
                    console.log(`   ${idx + 1}. "${product.title}" - $${product.price || product.extracted_price} (Score: ${product.evaluation?.score})`);
                  });
                  if (subResult.products.length > 3) {
                    console.log(`   ... and ${subResult.products.length - 3} more products`);
                  }
                  
                  // Keep track of the first best product for this level's return value
                  if (subResult.bestProduct && !bestSubProduct) {
                    bestSubProduct = subResult.bestProduct;
                  }
                }
                
                // =============================================================================
                // Backtracking: Return aggregated results from all subqueries
                // Each level maintained its own currentLevelTopProducts for context
                // =============================================================================
                console.log(`🔙 Level ${level}: Backtracking with ${allSubProducts.length} total products from ${subqueries.length} subqueries`);
                console.log(`🎯 Level ${level}: Final current level top products maintained: ${currentLevelTopProducts.length}`);
                console.log(`🏆 Level ${level}: Global best products collection now contains ${globalBestProducts.length} products`);
                console.log(`📊 DFS: Level ${level} returning ${allSubSteps.length} search steps in depth-first order:`);
                allSubSteps.forEach((step, idx) => {
                  console.log(`   ${idx + 1}. Level ${step.level} - Path: ${step.searchPath} - "${step.keywords}"`);
                });
                
                return {
                  products: allSubProducts,
                  bestProduct: bestSubProduct,
                  searchSteps: allSubSteps
                };
              }
              
              // Fallback: return current results
              console.log(`🔙 Level ${level}: Backtracking with fallback - no refinement needed`);
              console.log(`🎯 Level ${level}: Final current level top products: ${currentLevelTopProducts.length}`);
              return {
                products: levelProducts,
                bestProduct: null,
                searchSteps: currentSteps
              };
            };

            // =============================================================================
            // 🚀 START RECURSIVE SEARCH
            // =============================================================================

            // Determine initial price range
            let initialPriceRange: { min?: number; max?: number };
            
            if (refreshRequest && refreshRequest.type === 'price_range_search') {
              // Use price range from refresh request
              initialPriceRange = {
                min: refreshRequest.priceMin,
                max: refreshRequest.priceMax
              };
              console.log(`💰 Using refresh request price range: $${initialPriceRange.min} - $${initialPriceRange.max}`);
            } else {
              // Get price range from AI analysis
              const userPriceConstraints = refreshRequest?.priceMin !== undefined || refreshRequest?.priceMax !== undefined 
                ? { min: refreshRequest.priceMin, max: refreshRequest.priceMax }
                : undefined;
              
              initialPriceRange = await priceAnalyzerModel(rewrittenQuery, undefined, 1, userPriceConstraints, []);
              console.log(`💰 AI-determined initial price range: $${initialPriceRange.min} - $${initialPriceRange.max}`);
            }

            // Start recursive search with the rewritten query
            console.log(`🚀 Starting recursive search with: "${rewrittenQuery}"`);
            const searchResult = await queryInterpreter(
              rewrittenQuery, 
              initialPriceRange, 
              1
            );
            
            // Extract results from recursive search
            allProducts = searchResult.products;
            bestProduct = searchResult.bestProduct;
            // Use the global best products collection instead of extracting from result
            const allBestProducts = globalBestProducts; // All best products collected during recursion
            globalSearchSteps.push(...searchResult.searchSteps);

            console.log(`🔍 DEBUG: Recursive search results:`);
            console.log(`📊 DFS: Final search steps collected in depth-first order (${globalSearchSteps.length} total):`);
            globalSearchSteps.forEach((step, idx) => {
              console.log(`   🔍 Search ${idx + 1}: Level ${step.level} - Path: ${step.searchPath} - "${step.keywords}"`);
            });
            console.log(`   - allProducts.length: ${allProducts.length}`);
            console.log(`   - bestProduct: ${bestProduct ? bestProduct.title : 'null'}`);
            console.log(`   - allBestProducts.length: ${allBestProducts.length}`);
            console.log(`   - globalSearchSteps.length: ${globalSearchSteps.length}`);
            
            if (allBestProducts.length > 0) {
              console.log(`🏆 GLOBAL BEST PRODUCTS COLLECTION (${allBestProducts.length} total):`);
              allBestProducts.forEach((prod, idx) => {
                console.log(`   ${idx + 1}. Level ${prod.sourceLevel}: "${prod.title}" - From: "${prod.sourceQuery}" (Score: ${prod.evaluation?.score})`);
              });
            } else {
              console.log(`⚠️ No best products were collected during recursive search`);
            }
            
            if (allProducts.length > 0) {
              console.log(`   - First 5 all products:`, allProducts.slice(0, 5).map(p => `"${p.title}" ($${p.price})`));
            }

            // =============================================================================
            // PRODUCT-TO-INTERPRETER CORRESPONDENCE ANALYSIS
            // =============================================================================
            console.log(`🔗 PRODUCT-TO-INTERPRETER CORRESPONDENCE:`);
            const productsByQuery = allProducts.reduce((acc: any, product: any) => {
              const key = `${product.sourceQuery} (Level ${product.sourceLevel}, Path: ${product.sourcePath})`;
              if (!acc[key]) {
                acc[key] = [];
              }
              acc[key].push(product);
              return acc;
            }, {});

            Object.entries(productsByQuery).forEach(([queryInfo, products]: [string, any]) => {
              console.log(`🔍 "${queryInfo}" returned ${products.length} products:`);
              products.slice(0, 3).forEach((product: any, idx: number) => {
                console.log(`   ${idx + 1}. "${product.title}" - $${product.price || product.extracted_price} (Score: ${product.evaluation?.score})`);
              });
              if (products.length > 3) {
                console.log(`   ... and ${products.length - 3} more products`);
              }
            });

            // Filter for mat/blanket products specifically
            const matProducts = allProducts.filter((product: any) => 
              product.title.toLowerCase().includes('mat') || 
              product.title.toLowerCase().includes('blanket') ||
              product.title.toLowerCase().includes('beach') ||
              product.title.toLowerCase().includes('picnic')
            );

            if (matProducts.length > 0) {
              console.log(`🏖️ MAT/BLANKET PRODUCTS CORRESPONDENCE:`);
              matProducts.forEach((product: any, idx: number) => {
                console.log(`   ${idx + 1}. "${product.title}" - From: "${product.sourceQuery}" (Level ${product.sourceLevel}, Path: ${product.sourcePath})`);
              });
            }

            // Use the global best products collection
            if (allBestProducts.length > 0) {
              console.log(`✅ Using ${allBestProducts.length} BEST PRODUCTS from global collection (selected by interpreters)`);
              console.log(`🏆 Best products from global collection:`, allBestProducts.map(p => `"${p.title}" (score: ${p.evaluation?.score}, from: ${p.sourceQuery})`));
              allSelectedProductsForResult = allBestProducts.map(product => ({
                title: product.title,
                price: product.price,
                rating: product.rating,
                reviews: product.reviews,
                image: product.image,
                thumbnail: product.thumbnail,
                product_photos: product.product_photos,
                images: product.images,
                photo: product.photo,
                img: product.img,
                extracted_price: product.extracted_price,
                extracted_original_price: product.extracted_original_price,
                link: product.link,
                source: product.source,
                isPrime: product.isPrime,
                is_prime: product.is_prime,
                seller: product.seller,
                asin: product.asin,
                product_id: product.product_id,
                evaluation: {
                  score: product.evaluation.score,
                  reasoning: product.evaluation.reasoning,
                  reasons: product.evaluation.reasons
                },
                // Add source query tracking information
                sourceQuery: product.sourceQuery,
                sourcePath: product.sourcePath,
                sourceLevel: product.sourceLevel
              }));
              console.log(`📦 Created allSelectedProductsForResult with ${allSelectedProductsForResult.length} BEST PRODUCTS from global collection`);
            } else if (bestProduct && allProducts.length > 0) {
              // Fallback: If no best products were collected, use the old logic
              console.log(`⚠️ No best products collected, falling back to sorting ${allProducts.length} products by score`);
              const sortedProducts = allProducts.sort((a, b) => b.evaluation.score - a.evaluation.score);
              console.log(`📋 Sorted products (first 3):`, sortedProducts.slice(0, 3).map(p => `"${p.title}" (score: ${p.evaluation?.score || 'no score'})`));
              allSelectedProductsForResult = sortedProducts.slice(0, 10).map(product => ({
                title: product.title,
                price: product.price,
                rating: product.rating,
                reviews: product.reviews,
                image: product.image,
                thumbnail: product.thumbnail,
                product_photos: product.product_photos,
                images: product.images,
                photo: product.photo,
                img: product.img,
                extracted_price: product.extracted_price,
                extracted_original_price: product.extracted_original_price,
                link: product.link,
                source: product.source,
                isPrime: product.isPrime,
                is_prime: product.is_prime,
                seller: product.seller,
                asin: product.asin,
                product_id: product.product_id,
                evaluation: {
                  score: product.evaluation.score,
                  reasoning: product.evaluation.reasoning,
                  reasons: product.evaluation.reasons
                },
                // Add source query tracking information
                sourceQuery: product.sourceQuery,
                sourcePath: product.sourcePath,
                sourceLevel: product.sourceLevel
              }));
              console.log(`📦 Created allSelectedProductsForResult with ${allSelectedProductsForResult.length} products (fallback)`);
            }

            // Create summary based on recursive search results
            let searchSummary: string;
            if (allBestProducts.length > 0) {
              searchSummary = `Found ${allBestProducts.length} best products from ${globalSearchSteps.length} recursive search${globalSearchSteps.length > 1 ? 'es' : ''}. Selected by interpreters across all levels.`;
            } else if (bestProduct) {
              searchSummary = `Found ${allProducts.length} products across ${globalSearchSteps.length} recursive search${globalSearchSteps.length > 1 ? 'es' : ''}. Recommended: ${bestProduct.title}`;
            } else if (allProducts.length > 0) {
              searchSummary = `Found ${allProducts.length} products across ${globalSearchSteps.length} recursive search${globalSearchSteps.length > 1 ? 'es' : ''}, but none met the quality threshold.`;
            } else {
              searchSummary = `No products were found after ${globalSearchSteps.length} recursive search${globalSearchSteps.length > 1 ? 'es' : ''}.`;
            }

            console.log(`🔍 DEBUG: Final result construction:`);
            console.log(`   - allBestProducts.length: ${allBestProducts.length}`);
            console.log(`   - allSelectedProductsForResult.length: ${allSelectedProductsForResult.length}`);
            console.log(`   - bestProduct exists: ${!!bestProduct}`);
            console.log(`   - Using: ${allSelectedProductsForResult.length > 0 ? `${allSelectedProductsForResult.length} BEST PRODUCTS from global collection` : (bestProduct ? 'single best product' : 'no products')}`);

            const result: ProductSearchResult = {
              originalQuery: query,
              searchSteps: globalSearchSteps,
              recommendedProduct: bestProduct || undefined,
              recommendedProducts: allSelectedProductsForResult.length > 0 ? allSelectedProductsForResult : (bestProduct ? [bestProduct] : []),
              searchSummary,
              sessionId: `session_${Date.now()}`,
              allAccumulatedProducts: allProducts,
              suggestedKeywords: suggestedKeywords || []
            };

            console.log(`🎯 FINAL: recommendedProducts array length: ${result.recommendedProducts?.length || 0}`);
            if (result.recommendedProducts && result.recommendedProducts.length > 0) {
              console.log(`🏆 FINAL: Displaying ${result.recommendedProducts.length} best products to user:`);
              result.recommendedProducts.forEach((p: any, idx: number) => {
                console.log(`   ${idx + 1}. Level ${p.sourceLevel}: "${p.title}" (from: ${p.sourceQuery || 'unknown'})`);
              });
            }
            
            console.log(`🏷️ BACKEND: Final result contains suggested keywords:`, result.suggestedKeywords);

            // Store the search result if a product was found
            if (bestProduct) {
              try {
                await storeHistoricalSearchResult(
                  {
                    originalQuery: query,
                    finalProduct: {
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
                    },
                    searchSteps: globalSearchSteps,
                    searchSummary
                  },
                  token.id as string,
                  token.name || '',
                  token.email || ''
                );
              } catch (error) {
                console.error('⚠️ Failed to store historical search result:', error);
                // Don't throw error here to avoid breaking the search response
              }
            }

                            // Clean up search registration and cancel timeout
                const searchRecord = activeSearches.get(token.id as string);
                const searchDuration = searchRecord ? Math.round((Date.now() - searchRecord.timestamp) / 1000) : 0;
                activeSearches.delete(token.id as string);
                if (searchTimeout) {
                  clearTimeout(searchTimeout);
                }
            console.log(`🧹 Backend: Completed search ${searchId} for user ${token.id} in ${searchDuration}s, removed from active searches`);
            
            if (searchDuration > 30) {
              console.log(`⚠️ Backend: Search took ${searchDuration}s (longer than maxDuration=30s) - this may cause frontend timeout issues`);
            }

            return {
              type: "product_search",
              result,
              ui: {
                type: "product_search",
                title: "Product Search Results",
                description: `Found ${allProducts.length} products for "${query}"`
              }
            };
                        } catch (error) {
                // Clean up search registration on error (timeout will clean itself up)
                const searchRecord = activeSearches.get(token.id as string);
                if (searchRecord) {
                  const searchDuration = Math.round((Date.now() - searchRecord.timestamp) / 1000);
                  console.log(`🧹 Backend: Search failed for user ${token.id} after ${searchDuration}s, removed from active searches`);
                }
                activeSearches.delete(token.id as string);
                if (searchTimeout) {
                  clearTimeout(searchTimeout);
                }
            
            console.error("Error in intelligent product search:", error);
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
