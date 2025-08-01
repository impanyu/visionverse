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

            // Set up timeout to automatically clean up this search if it takes too long
            const searchTimeout = setTimeout(() => {
              if (activeSearches.has(token.id as string) && activeSearches.get(token.id as string)?.searchId === searchId) {
                console.log(`⏰ Backend: Force cleaning up timed-out search ${searchId} for user ${token.id} after 60 seconds`);
                activeSearches.delete(token.id as string);
              }
            }, 60000); // 60 seconds - longer than typical searches but still prevents indefinite blocking
            
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

Try you best to translate the abstract and ambiguous user's intent into more specific search query, but do not change the core intent.

Guidelines:
- More specific means narrow down the search scope, adding more specific keywords about categories, features, price ranges, etc.
- Keep the core intent of the current query, do not fabricate any keywords, narrowing down should be reasonable and based on the user's characteristics, behavior patterns and hobbies
- The historical queries and last searched product are only for you to infer the user's characteristics, behavior patterns and hobbies
- You can only extract user characteristics, behavior patterns and hobbies which are probably not changing over time (those about who the user is), and ignore those that can change over time
- When there are conflicting patterns, prioritize the last searched product and recent queries (those with newer dates)
- Do not guess or add any unneccesary keywords to the current query
- Make the query more specific and targeted, but don't change the core intent
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
            
            let currentQuery = rewrittenQuery;
            let bestProduct: (any & { evaluation: any; source: 'amazon' | 'local' | 'google_shopping' }) | null = null;
            let allProducts: Array<any & { evaluation: any; source: 'amazon' | 'local' | 'google_shopping' }> = [];
            let allSelectedProductsForResult: Array<any & { evaluation: any; source: 'amazon' | 'local' | 'google_shopping' }> = [];
            const maxIterations = 3;
            const minIterations = 2; // Ensure at least 2 iterations
            let iteration = 0;

            // Helper function for price range analysis
            const analyzePriceRange = async (
              query: string, 
              type: 'initial' | 'refinement',
              currentRange?: { min?: number; max?: number },
              productAnalysis?: {
                evaluatedProducts: any[];
                minCurrentPrice: number;
                maxCurrentPrice: number;
                avgPrice: number;
              },
              userConstraints?: { min?: number; max?: number }
            ): Promise<{ min?: number; max?: number }> => {
              try {
                const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                
                let prompt: string;
                
                if (type === 'initial') {
                  const constraintsText = userConstraints ? 
                    `\n\nUSER PRICE BOUNDS: The user has set a price range of $${userConstraints.min || 'any'} - $${userConstraints.max || 'any'}. You can choose any range within these bounds - you don't need to use the exact bounds.` : '';
                  
                  prompt = `Analyze this product search query and determine an appropriate price range:

Query: "${query}"${constraintsText}

Instructions:
1. If the query mentions specific price terms like "cheap", "budget", "affordable", "expensive", "luxury", "high-end", "premium", extract the implied price range
2. If the query mentions specific dollar amounts, use those
3. If no price information is mentioned, set a range that makes sense for the product category
4. Choose the most appropriate price range for finding relevant products
${userConstraints ? `5. Stay within the user's bounds of $${userConstraints.min || 'any'} - $${userConstraints.max || 'any'}, but feel free to use a narrower range if it makes sense for the query.` : ''}

Examples:
- "cheap headphones" → min: 5, max: 50
- "luxury watch" → min: 500, max: 5000
- "budget laptop under $800" → min: 200, max: 800
- "expensive gaming chair" → min: 300, max: 1500
- "wireless mouse" (no price hint) → min: 15, max: 150

CRITICAL: Return ONLY a valid JSON object with min and max numbers, no other text:
{"min": 10, "max": 200}`;
                } else {
                  // refinement type
                  const { evaluatedProducts, minCurrentPrice, maxCurrentPrice, avgPrice } = productAnalysis!;
                  const constraintsText = userConstraints ? 
                    `\nUSER PRICE BOUNDS: The user has set overall bounds of $${userConstraints.min || 'any'} - $${userConstraints.max || 'any'}. You can choose any range within these bounds.` : '';
                  
                  prompt = `Based on the current product search results and user query, suggest a refined price range for the next search iteration:

User Query: "${query}"
Current Price Range: $${currentRange?.min || 'unlimited'} - $${currentRange?.max || 'unlimited'}${constraintsText}

Current Products Analysis:
- Found ${evaluatedProducts.length} products
- Price range: $${minCurrentPrice} - $${maxCurrentPrice}
- Average price: $${avgPrice.toFixed(2)}
- Quality issues: ${evaluatedProducts.filter(p => p.evaluation.score < 60).length} low-quality products

Instructions:
1. Choose a price range that will help find better products based on the analysis above
2. You can narrow down to focus on a specific price segment or expand slightly if needed
3. Consider the quality vs price relationship from current results
${userConstraints ? `4. Stay within the user's overall bounds of $${userConstraints.min || 'any'} - $${userConstraints.max || 'any'}, but feel free to choose any range within these bounds.` : ''}

Strategy examples:
- If current products are too expensive with low quality → try lower price range
- If current products are too cheap with poor results → try higher price range  
- If results are mixed → try focusing on the sweet spot around average price

Return ONLY a JSON object with min and max numbers:
{"min": 20, "max": 150}`;
                }

                const response = await openaiClient.chat.completions.create({
                  model: "gpt-4o",
                  messages: [{ role: "user", content: prompt }],
                  temperature: type === 'initial' ? 0.4 : 0.6,
                  max_tokens: 50
                });

                const result = response.choices[0]?.message?.content?.trim();
                if (result) {
                  try {
                    // Try to extract JSON from the response in case there's extra text
                    let jsonStr = result;
                    const jsonMatch = result.match(/\{[^}]*\}/);
                    if (jsonMatch) {
                      jsonStr = jsonMatch[0];
                    }
                    
                    const parsedPrice = JSON.parse(jsonStr);
                    
                    // Validate that we have min and max properties
                    if (typeof parsedPrice.min === 'number' && typeof parsedPrice.max === 'number') {
                      let finalMin = parsedPrice.min;
                      let finalMax = parsedPrice.max;
                      
                      // Enforce user constraints if provided
                      if (userConstraints) {
                        if (userConstraints.min !== undefined && finalMin < userConstraints.min) {
                          console.log(`💰 Adjusting min price from $${finalMin} to user constraint $${userConstraints.min}`);
                          finalMin = userConstraints.min;
                        }
                        if (userConstraints.max !== undefined && finalMax > userConstraints.max) {
                          console.log(`💰 Adjusting max price from $${finalMax} to user constraint $${userConstraints.max}`);
                          finalMax = userConstraints.max;
                        }
                        if (userConstraints.min !== undefined && finalMax < userConstraints.min) {
                          finalMax = userConstraints.min;
                        }
                        if (userConstraints.max !== undefined && finalMin > userConstraints.max) {
                          finalMin = userConstraints.max;
                        }
                      }
                      
                      console.log(`💰 ${type === 'initial' ? 'Initial' : 'Refined'} price range: $${finalMin} - $${finalMax}`);
                      return { min: finalMin, max: finalMax };
                    } else {
                      console.warn(`⚠️ Invalid price range format: min=${parsedPrice.min}, max=${parsedPrice.max}`);
                      console.log(`🔍 Raw response: "${result}"`);
                      return currentRange || {};
                    }
                  } catch (parseError) {
                    console.warn(`⚠️ Failed to parse ${type} price range, using current range`);
                    console.log(`🔍 Raw response: "${result}"`);
                    console.log(`🔍 Parse error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
                    return currentRange || {};
                  }
                }
                return currentRange || {};
              } catch (error) {
                console.error(`⚠️ Error in ${type} price range analysis:`, error);
                return currentRange || {};
              }
            };

            // Extract initial price range from query or use fixed range from price range search
            let minPrice: number | undefined;
            let maxPrice: number | undefined;
            let userPriceConstraints: { min?: number; max?: number } | undefined;
            
            if (refreshRequest && refreshRequest.type === 'price_range_search') {
              // Set user constraints from slider, but let AI choose initial search range within bounds
              userPriceConstraints = { min: refreshRequest.priceMin, max: refreshRequest.priceMax };
              console.log(`💰 Price slider refresh: User bounds set to $${refreshRequest.priceMin} - $${refreshRequest.priceMax}`);
              console.log(`💰 AI will choose strategic price ranges within these bounds for each iteration`);
              
              // Let AI analyze and choose initial price range within user constraints
              const initialPriceRange = await analyzePriceRange(currentQuery, 'initial', undefined, undefined, userPriceConstraints);
              minPrice = initialPriceRange.min;
              maxPrice = initialPriceRange.max;
              console.log(`💰 AI chose initial search range: $${minPrice} - $${maxPrice} (within user bounds)`);
                          } else {
                console.log(`💰 Analyzing initial price range from query: "${currentQuery}"`);
                const initialPriceRange = await analyzePriceRange(currentQuery, 'initial', undefined, undefined, userPriceConstraints);
                minPrice = initialPriceRange.min;
                maxPrice = initialPriceRange.max;
              }

            while (iteration < maxIterations && (iteration < minIterations || !bestProduct)) {
              iteration++;
              console.log(`🔄 Search iteration ${iteration}: "${currentQuery}"`);
              console.log(`💰 Search iteration ${iteration} price constraints: min=$${minPrice || 'unlimited'}, max=$${maxPrice || 'unlimited'}`);
              if (userPriceConstraints) {
                console.log(`🔒 User price constraints active: min=$${userPriceConstraints.min || 'unlimited'}, max=$${userPriceConstraints.max || 'unlimited'}`);
              }

                            // Search Amazon and Google Shopping
              let allSearchProducts: any[] = [];
              let amazonCount = 0;
              let googleShoppingCount = 0;
              
              try {
                // Clean the query by removing extra quotes that AI might add
                const cleanQuery = currentQuery.replace(/^["']|["']$/g, '');
                
                const combinedProducts = await amazonSearchService.searchAllProducts({
                  query: cleanQuery,
                  maxResults: 20, // Increased to accommodate both sources
                  sortBy: 'featured',
                  includeAmazon: true,
                  includeGoogleShopping: true,
                  priceMin: minPrice,
                  priceMax: maxPrice
                });
                
                allSearchProducts = combinedProducts;
                amazonCount = combinedProducts.filter(p => p.source === 'amazon').length;
                googleShoppingCount = combinedProducts.filter(p => p.source === 'google_shopping').length;
                
                console.log(`🛒 Amazon: Found ${amazonCount} products`);
                console.log(`🛒 Google Shopping: Found ${googleShoppingCount} products`);
                console.log(`🎯 Total search products: ${allSearchProducts.length}`);
                
                // Debug: Check if any products are outside the price range
                if (minPrice !== undefined || maxPrice !== undefined) {
                  const outsidePriceRange = allSearchProducts.filter(product => {
                    const price = product.extracted_price;
                    if (!price || price <= 0) return false; // Skip products without price
                    return (minPrice !== undefined && price < minPrice) || (maxPrice !== undefined && price > maxPrice);
                  });
                  
                  if (outsidePriceRange.length > 0) {
                    console.log(`⚠️  Found ${outsidePriceRange.length} products outside price range $${minPrice || 'unlimited'}-$${maxPrice || 'unlimited'}:`);
                    outsidePriceRange.forEach((product, index) => {
                      if (index < 5) { // Show only first 5 to avoid spam
                        console.log(`   • "${product.title}" - $${product.extracted_price}`);
                      }
                    });
                    if (outsidePriceRange.length > 5) {
                      console.log(`   • ... and ${outsidePriceRange.length - 5} more`);
                    }
                  } else {
                    console.log(`✅ All products are within price range $${minPrice || 'unlimited'}-$${maxPrice || 'unlimited'}`);
                  }
                }
                
                if (cleanQuery !== currentQuery) {
                  console.log(`🧹 Cleaned query: "${currentQuery}" → "${cleanQuery}"`);
                }
                console.log(`🎯 Search method: Combined API (Amazon + Google Shopping via SearchAPI.io)`);
                console.log(`   • Amazon results: ${amazonCount} products`);
                console.log(`   • Google Shopping results: ${googleShoppingCount} products (with offers)`);
                console.log(`   • No personalization (browsing history, location, past purchases)`);
                console.log(`   • Using 'featured' sorting (platform's relevance algorithm)`);
                
                // Log all search products with details
                if (allSearchProducts.length > 0) {
                  console.log(`📋 All ${allSearchProducts.length} search products found:`);
                  allSearchProducts.forEach((product, index) => {
                    console.log(`  ${index + 1}. "${product.title}"`);
                    console.log(`     💰 Price: ${product.price || 'N/A'}`);
                    console.log(`     ⭐ Rating: ${product.rating || 'N/A'} (${product.reviews || 0} reviews)`);
                    console.log(`     🏪 Source: ${product.source === 'amazon' ? 'Amazon' : 'Google Shopping'}`);
                    if (product.source === 'amazon') {
                      console.log(`     🚚 Prime: ${product.is_prime ? 'Yes' : 'No'}`);
                      console.log(`     🔗 ASIN: ${product.asin}`);
                    } else {
                      console.log(`     🏪 Seller: ${product.seller || 'N/A'}`);
                      console.log(`     🔗 Product ID: ${product.product_id}`);
                    }
                    console.log(`     📍 Position: ${product.position}`);
                    console.log(`     ---`);
                  });
                } else {
                  console.log(`❌ No products found for query: "${currentQuery}"`);
                }
              } catch (error) {
                console.error('Combined search error:', error);
              }

              // Search local products in ChromaDB
              let localProducts: any[] = [];
              try {
                const { findSimilarProductsForVision } = await import("@/lib/vector-db");
                const vectorResults = await findSimilarProductsForVision(
                  currentQuery,
                  token.id as string,
                  10
                );

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
                    rating: 4.0, // Default rating for local products
                    reviews: 1,
                    source: 'local'
                  }));
                }
                console.log(`🏪 Local: Found ${localProducts.length} products`);
              } catch (error) {
                console.error('Local search error:', error);
              }

              // Combine and evaluate products from this iteration for refresh data
              const iterationCombinedProducts = [
                ...allSearchProducts.map((p: any) => ({ ...p, source: p.source })),
                ...localProducts.map((p: any) => ({ ...p, source: 'local' as const }))
              ];

              const iterationEvaluatedProducts = iterationCombinedProducts.map(p => ({
                ...p,
                evaluation: amazonSearchService.evaluateProductQuality(p)
              }));

              // Record this search step with iteration-specific data
              searchSteps.push({
                keywords: currentQuery,
                amazonResults: amazonCount,
                googleShoppingResults: googleShoppingCount,
                localResults: localProducts.length,
                refinementReason: iteration > 1 ? `Refining search to find better matches` : undefined,
                stepType: iteration > 1 ? 'refinement' : 'search',
                priceRange: minPrice !== undefined || maxPrice !== undefined ? {
                  min: minPrice,
                  max: maxPrice
                } : undefined,
                // Add iteration-specific data for refresh functionality
                iterationProducts: iterationEvaluatedProducts,
                allProductsUpToHere: [...allProducts, ...iterationEvaluatedProducts]
              });

              // Combine and evaluate all products
              const combinedProducts = [
                ...allSearchProducts.map((p: any) => ({ ...p, source: p.source })),
                ...localProducts.map((p: any) => ({ ...p, source: 'local' as const }))
              ];

              // Evaluate each product
              const evaluatedProducts = combinedProducts.map(product => ({
                ...product,
                evaluation: amazonSearchService.evaluateProductQuality(product)
              }));

             

              // Find the best product from this iteration
              const recommendedProducts = evaluatedProducts.filter(p => p.evaluation.isRecommended);

               // Add to all products list
               allProducts.push(...recommendedProducts);
              
              if (allProducts.length > 0) {
                // For intermediate iterations, just continue collecting products
                if (iteration < maxIterations) {
                  console.log(`🔄 Iteration ${iteration}: Collected ${allProducts.length} products so far, continuing search...`);
                  // Don't select products yet, continue to next iteration
                } else {
                          // Final iteration: Use AI to select top 10 products
        console.log(`🤖 Using AI to select top 10 products from ${allProducts.length} total collected products`);
                  
                  try {
                    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                    
                    // Prepare product information for LLM analysis
                    const productDetails = allProducts.map((product, index) => ({
                      index: index + 1,
                      title: product.title,
                      price: product.extracted_price || 'N/A',
                      rating: product.rating || 'N/A',
                      reviews: product.reviews || 'N/A',
                      isPrime: product.is_prime || false,
                      source: product.source,
                      qualityScore: product.evaluation.score,
                      reasons: product.evaluation.reasons.join('; '),
                      asin: product.asin || 'N/A'
                    }));

                    const selectionPrompt = `You are a product recommendation expert. Analyze these products and select the TOP 10 BEST products for the user's query, ranked from best to worst.

Current user query: "${currentQuery}"

All products to choose from:
${productDetails.map(p => 
  `${p.index}. "${p.title}"
     • Price: $${p.price}
     • Rating: ${p.rating}★ (${p.reviews} reviews)
     • Prime: ${p.isPrime ? 'Yes' : 'No'}
     • Source: ${p.source === 'amazon' ? 'Amazon' : 'Local Store'}
     • Quality Score: ${p.qualityScore}/100
     • Quality Reasons: ${p.reasons}
     • ASIN: ${p.asin}`
).join('\n\n')}

Instructions:
1. Consider the user's specific intent from their query
2. Evaluate relevance, quality, price appropriateness, and user reviews
3. Select products that truly match what the user is looking for
4. Rank them from BEST to WORST (most relevant first)
5. Return EXACTLY ${Math.min(10, allProducts.length)} product numbers${allProducts.length < 10 ? ` (all ${allProducts.length} products since less than 10 available)` : ''}
6. If fewer than ${Math.min(10, allProducts.length)} products are appropriate, only return the appropriate ones

Format: Return ONLY the product numbers separated by commas (e.g., "3,7,1,15,2,9,12,4,8,11")
If no products are appropriate, return "-1"

Your top ${Math.min(10, allProducts.length)} products (best first):`;

                    const selectionResponse = await openaiClient.chat.completions.create({
                      model: "gpt-4o",
                      messages: [{ role: "user", content: selectionPrompt }],
                      temperature: 0.4,
                      max_tokens: 100
                    });

                    const selectedText = selectionResponse.choices[0]?.message?.content?.trim() || '';
                    
                    if (selectedText === '-1') {
                      console.log(`❌ AI determined no products are appropriate for "${currentQuery}"`);
                      // Continue to refinement logic
                    } else {
                      // Parse the comma-separated product numbers
                      const selectedNumbers = selectedText.split(',')
                        .map(num => parseInt(num.trim()))
                        .filter(num => !isNaN(num) && num > 0 && num <= allProducts.length);
                      
                      if (selectedNumbers.length > 0) {
                        // Convert to products array (maintaining order from AI)
                        const selectedProducts = selectedNumbers.map(num => allProducts[num - 1]).filter(Boolean);
                        console.log(`🎯 AI selected ${selectedProducts.length} products (ranked best to worst):`);
                        selectedProducts.forEach((product, index) => {
                          console.log(`   ${index + 1}. "${product.title}" (Score: ${product.evaluation.score})`);
                        });
                        
                        // Set bestProduct to first one for backward compatibility  
                        // Create a clean copy to avoid circular references
                        const firstProduct = selectedProducts[0];
                        bestProduct = {
                          title: firstProduct.title,
                          price: firstProduct.price,
                          rating: firstProduct.rating,
                          reviews: firstProduct.reviews,
                          image: firstProduct.image,
                          thumbnail: firstProduct.thumbnail,
                          product_photos: firstProduct.product_photos,
                          images: firstProduct.images,
                          photo: firstProduct.photo,
                          img: firstProduct.img,
                          extracted_price: firstProduct.extracted_price,
                          extracted_original_price: firstProduct.extracted_original_price,
                          link: firstProduct.link,
                          source: firstProduct.source,
                          isPrime: firstProduct.isPrime,
                          is_prime: firstProduct.is_prime,
                          evaluation: {
                            score: firstProduct.evaluation.score,
                            reasoning: firstProduct.evaluation.reasoning,
                            reasons: firstProduct.evaluation.reasons
                          }
                        };
                        
                        // Store selected products separately to avoid circular references
                        // Create deep copies to avoid any circular references within product objects
                        allSelectedProductsForResult = selectedProducts.map(product => ({
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
                          evaluation: {
                            score: product.evaluation.score,
                            reasoning: product.evaluation.reasoning,
                            reasons: product.evaluation.reasons
                          }
                        }));
                        
                        break; // Exit the iteration loop
                      } else {
                        console.log(`⚠️ AI returned invalid product selection: "${selectedText}"`);
                        // Continue to refinement logic
                      }
                    }
                  } catch (error) {
                    console.error('⚠️ Error in AI product selection:', error);
                    // Continue to refinement logic
                  }
                }
              }

              // If no good product found and we can iterate more, refine the search
              if (iteration < maxIterations) {
                console.log(`🤖 Generating refinements based on iteration ${iteration} results...`);
                console.log(`📊 Analyzing ${evaluatedProducts.length} total products (${amazonCount} Amazon + ${googleShoppingCount} Google Shopping + ${localProducts.length} local)`);
                const refinements = await amazonSearchService.generateRefinedKeywords(currentQuery, evaluatedProducts, userPriceConstraints);
                console.log(`📝 Generated refinements:`, refinements);
                
                // Check refresh request type for price range handling
                console.log(`🔍 Refresh request type check: ${refreshRequest?.type || 'none'}`);
                
                // Refine price range based on current iteration results
                const currentPrices = evaluatedProducts.map(p => p.extracted_price).filter(price => price && price > 0);
                if (currentPrices.length > 0) {
                  const avgPrice = currentPrices.reduce((sum, price) => sum + price, 0) / currentPrices.length;
                  const minCurrentPrice = Math.min(...currentPrices);
                  const maxCurrentPrice = Math.max(...currentPrices);
                  
                  console.log(`💰 Current iteration price analysis: avg=$${avgPrice.toFixed(2)}, range=$${minCurrentPrice}-$${maxCurrentPrice}`);
                  console.log(`💰 Calling AI to refine price range within user constraints...`);
                  
                  const oldMinPrice = minPrice;
                  const oldMaxPrice = maxPrice;
                  
                  const refinedPriceRange = await analyzePriceRange(
                    currentQuery, 
                    'refinement',
                    { min: minPrice, max: maxPrice },
                    { evaluatedProducts, minCurrentPrice, maxCurrentPrice, avgPrice },
                    userPriceConstraints
                  );
                  
                  minPrice = refinedPriceRange.min;
                  maxPrice = refinedPriceRange.max;
                  
                  if (oldMinPrice !== minPrice || oldMaxPrice !== maxPrice) {
                    console.log(`💰 AI refined price range: $${oldMinPrice || 'unlimited'}-$${oldMaxPrice || 'unlimited'} → $${minPrice || 'unlimited'}-$${maxPrice || 'unlimited'}`);
                  } else {
                    console.log(`💰 AI kept same price range: $${minPrice || 'unlimited'}-$${maxPrice || 'unlimited'}`);
                  }
                }
                
                // Always use the first refinement for the next iteration
                currentQuery = refinements[0] || query;
                console.log(`🔄 Refining search to: "${currentQuery}"`);
              }
            }

            // If still no recommended product, pick top products from all searches (score-based)
            if (!bestProduct && allProducts.length > 0) {
              console.log(`📊 No AI-selected products found, selecting top ${Math.min(10, allProducts.length)} highest scored from ${allProducts.length} total products`);
              const sortedAllProducts = allProducts.sort((a, b) => b.evaluation.score - a.evaluation.score);
              const topProducts = sortedAllProducts.slice(0, Math.min(10, allProducts.length));
              const topProduct = topProducts[0];
              if (topProduct) {
                // Create a clean copy to avoid circular references
                bestProduct = {
                  title: topProduct.title,
                  price: topProduct.price,
                  rating: topProduct.rating,
                  reviews: topProduct.reviews,
                  image: topProduct.image,
                  thumbnail: topProduct.thumbnail,
                  product_photos: topProduct.product_photos,
                  images: topProduct.images,
                  photo: topProduct.photo,
                  img: topProduct.img,
                  extracted_price: topProduct.extracted_price,
                  extracted_original_price: topProduct.extracted_original_price,
                  link: topProduct.link,
                  source: topProduct.source,
                  isPrime: topProduct.isPrime,
                  is_prime: topProduct.is_prime,
                  evaluation: {
                    score: topProduct.evaluation.score,
                    reasoning: topProduct.evaluation.reasoning,
                    reasons: topProduct.evaluation.reasons
                  }
                };
                console.log(`✅ Selected top ${topProducts.length} highest scored products:`);
                topProducts.forEach((product, index) => {
                  console.log(`   ${index + 1}. "${product.title}" (Score: ${product.evaluation.score})`);
                });
                // Store top products separately to avoid circular references
                // Create deep copies to avoid any circular references within product objects
                allSelectedProductsForResult = topProducts.map(product => ({
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
                  evaluation: {
                    score: product.evaluation.score,
                    reasoning: product.evaluation.reasoning,
                    reasons: product.evaluation.reasons
                  }
                }));
              }
            }



             let searchSummary: string;
             
             if (allSelectedProductsForResult.length > 0) {
               if (allSelectedProductsForResult.length === 1) {
                         searchSummary = `Found "${allSelectedProductsForResult[0].title}" after ${iteration} search iteration${iteration > 1 ? 's' : ''}.`;
      } else {
        searchSummary = `Found ${allSelectedProductsForResult.length} great products after ${iteration} search iteration${iteration > 1 ? 's' : ''}. Best one selected for you.`;
               }
             } else if (bestProduct && bestProduct.title) {
               searchSummary = `Found "${bestProduct.title}" after ${iteration} search iteration${iteration > 1 ? 's' : ''} with a recommend score of ${bestProduct.evaluation.score}/100.`;
             } else {
               if (allProducts.length > 0) {
                 searchSummary = `Searched through ${allProducts.length} products across ${iteration} iterations, but our AI determined that none were appropriate matches for your specific needs.`;
               } else {
                 searchSummary = `No products were found after ${iteration} search iteration${iteration > 1 ? 's' : ''}.`;
               }
             }

            const result: ProductSearchResult = {
              originalQuery: query,
              searchSteps,
              recommendedProduct: bestProduct || undefined,
              recommendedProducts: allSelectedProductsForResult.length > 0 ? allSelectedProductsForResult : (bestProduct ? [bestProduct] : []),
              searchSummary,
              sessionId: `session_${Date.now()}`,
              allAccumulatedProducts: allProducts,
              suggestedKeywords: suggestedKeywords || []
            };
            
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
                    searchSteps,
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
            const searchDuration = Math.round((Date.now() - activeSearches.get(token.id as string)!.timestamp) / 1000);
            activeSearches.delete(token.id as string);
            clearTimeout(searchTimeout);
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