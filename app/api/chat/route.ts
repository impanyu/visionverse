import { openai } from "@ai-sdk/openai";
import { frontendTools } from "@assistant-ui/react-ai-sdk";
import { streamText } from "ai";
import { getToken } from "next-auth/jwt";
import { z } from "zod";
import clientPromise from "@/lib/mongodb";
import { VisionDocument, Vision } from "@/types/vision";
import { storeVisionEmbedding, searchSimilarVisions, searchAllVisions } from "@/lib/vector-db";
import { ObjectId } from "mongodb";
import { ProductDocument, Product } from "@/types/product";

// Removed edge runtime since MongoDB requires Node.js modules
export const maxDuration = 30;

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

  // Check for specific button commands that should force tool usage
  const lastMessage = messages[messages.length - 1];
  
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
  if (userMessage.includes('create vision') || userMessage.includes('create a vision') || userMessage.includes('new vision')) {
    forcedTool = 'create_vision_form';
  } else if (userMessage.includes('list my visions') || userMessage.includes('show my visions') || userMessage.includes('my visions')) {
    forcedTool = 'list_my_visions';
  } else if (userMessage.includes('list my products') || userMessage.includes('show my products') || userMessage.includes('my products')) {
    forcedTool = 'list_my_products';
  } else if (userMessage.includes('create product') || userMessage.includes('create a product') || userMessage.includes('new product')) {
    forcedTool = 'create_product_form';
  }

  // Enhanced system prompt with user context
  const userName = token.name || token.email || "User";
  const enhancedSystem = `${system || "You are a helpful assistant."}\n\nUser context: You are chatting with ${userName}. Be personable and remember this is a personalized conversation.

CRITICAL TOOL USAGE RULES:
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

IMPORTANT: Use the EXACT words the user provided as the description - do not add, modify, or interpret their words

When you call a tool, respond ONLY with the tool call results. Do not generate any verbose text before or after the UI components.
For all other interactions (non-tool related), respond normally with helpful text.`;

  // Track if vision tools are being used
  const result = streamText({
    model: openai('gpt-4o'),
    system: enhancedSystem,
    messages: messages,
    // Force tool usage for specific commands, otherwise auto
    toolChoice: forcedTool ? { type: "tool", toolName: forcedTool as any } : "auto",
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
    },
  });

  return result.toDataStreamResponse();
}