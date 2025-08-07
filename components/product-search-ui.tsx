"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Star, TrendingUp, ChevronDown, ChevronRight, RefreshCw, X } from "lucide-react";
import { AmazonProduct } from "@/lib/amazon-search";
import { makeAssistantToolUI, ThreadPrimitive } from "@assistant-ui/react";

export interface SearchStep {
  keywords: string;
  amazonResults: number;
  googleShoppingResults?: number;
  localResults?: number;
  googleMapsResults?: number;
  refinementReason?: string;
  stepType?: 'intent' | 'search' | 'refinement';
  priceRange?: {
    min?: number;
    max?: number;
  };
  // Add iteration-specific data for refresh functionality
  iterationProducts?: any[]; // Products found in this specific iteration
  allProductsUpToHere?: any[]; // Accumulated products up to this iteration
  // Add depth-first search tracking
  level?: number; // Search depth level (1, 2, 3)
  searchPath?: string; // Path like "ROOT", "1", "1.2", "2.1.3" for DFS visualization
}

export interface ProductSearchResult {
  originalQuery: string;
  searchSteps: SearchStep[];
  recommendedProduct?: any & {
    evaluation: {
      score: number;
      reasons: string[];
      isRecommended: boolean;
    };
    source: 'amazon' | 'google_shopping';
  };
  // New field for TikTok-style product browsing
  recommendedProducts?: Array<any & {
    evaluation: {
      score: number;
      reasons: string[];
      isRecommended: boolean;
    };
    source: 'amazon' | 'google_shopping';
  }>;
  searchSummary: string;
  // Add session data for refresh functionality
  sessionId?: string;
  allAccumulatedProducts?: any[]; // All products from all iterations
  suggestedKeywords?: string[]; // AI-suggested keywords for query refinement
}

interface ProductSearchDisplayProps {
  result: ProductSearchResult;
}

interface TikTokProductBrowserProps {
  products: Array<any & {
    evaluation: {
      score: number;
      reasons: string[];
      isRecommended: boolean;
    };
    source: 'amazon' | 'google_shopping';
  }>;
}

function TikTokProductBrowser({ products }: TikTokProductBrowserProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [isMouseOverProduct, setIsMouseOverProduct] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % products.length);
  };

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + products.length) % products.length);
  };

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (e.key === 'ArrowUp') {
          setCurrentIndex((prev) => (prev - 1 + products.length) % products.length);
        } else {
          setCurrentIndex((prev) => (prev + 1) % products.length);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [products.length]);

  // Handle scroll wheel navigation with document-level event handling
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      // Only handle wheel events when mouse is over the product area
      if (!isMouseOverProduct) return;
      
      // Completely prevent the event from propagating
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      if (isScrolling) return;
      
      setIsScrolling(true);
      
      console.log('🖱️ Wheel event detected on product area:', e.deltaY, 'Mouse over product:', isMouseOverProduct);
      
      if (e.deltaY > 0) {
        console.log('🖱️ Scrolling down -> next product');
        setCurrentIndex((prev) => (prev + 1) % products.length);
      } else {
        console.log('🖱️ Scrolling up -> previous product');
        setCurrentIndex((prev) => (prev - 1 + products.length) % products.length);
      }
      
      // Debounce mechanism
      setTimeout(() => {
        setIsScrolling(false);
      }, 150);
    };

    // Add event listener to document with capture phase to intercept early
    document.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    
    return () => {
      document.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, [isMouseOverProduct, isScrolling, products.length]);

  // Handle mouse enter/leave to track when mouse is over product area
  const handleMouseEnter = useCallback(() => {
    setIsMouseOverProduct(true);
    console.log('🖱️ Mouse entered product area');
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsMouseOverProduct(false);
    console.log('🖱️ Mouse left product area');
  }, []);

  if (!products || products.length === 0) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="text-yellow-800 font-medium mb-2">No Products Available</h3>
        <p className="text-yellow-600 text-sm">
          No products were found to display in the browser.
        </p>
      </div>
    );
  }

  const currentProduct = products[currentIndex];
  
  // Debug log to see the full product structure for the current product
  if (currentProduct) {
    console.log('🎯 Current product structure:', {
      index: currentIndex,
      title: currentProduct.title?.slice(0, 50),
      source: currentProduct.source,
      allKeys: Object.keys(currentProduct),
      fullProduct: currentProduct
    });
    
    // Additional debug specifically for image-related fields
    console.log('🔍 All product fields that might contain images:', {
      ...Object.fromEntries(
        Object.entries(currentProduct).filter(([key, value]) => 
          key.toLowerCase().includes('image') || 
          key.toLowerCase().includes('photo') || 
          key.toLowerCase().includes('picture') || 
          key.toLowerCase().includes('thumbnail') ||
          key.toLowerCase().includes('img')
        )
      )
    });
  }
  
  if (!currentProduct) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h3 className="text-yellow-800 font-medium mb-2">Product Data Error</h3>
        <p className="text-yellow-600 text-sm">
          Unable to display the current product. Please try refreshing.
        </p>
      </div>
    );
  }

  // Helper functions (same as original)
  const formatPrice = (price?: number) => {
    if (!price) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price);
  };

  const getRatingStars = (rating?: number) => {
    if (!rating) return null;
    return (
      <div className="flex items-center gap-1">
        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
        <span className="text-sm font-medium">{rating}</span>
      </div>
    );
  };

  return (
    <div 
      ref={containerRef} 
      className={`space-y-4 transition-all duration-200 ${
        isMouseOverProduct ? 'bg-blue-50/20 rounded-lg' : ''
      }`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >


      {/* Product Card - Using exact original styling */}
      <Card className="border border-green-200 bg-gradient-to-r from-green-50/50 to-emerald-50/50 shadow-sm hover:shadow-md transition-shadow duration-200">
        <CardContent className="p-6">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-lg font-semibold text-green-800">Recommended Product</h3>
          </div>
          
          <div className="flex gap-6">
            {/* Product Image */}
            {(() => {
              // Check for image fields (thumbnail should now be properly passed from backend)
              const imageUrl = currentProduct.thumbnail || 
                              currentProduct.image || 
                              currentProduct.product_photos?.[0] || 
                              currentProduct.images?.[0] ||
                              currentProduct.photo ||
                              currentProduct.img;
              
              // Debug log to see what image fields are available
              console.log('🖼️ Product image fields:', {
                title: currentProduct.title?.slice(0, 50),
                source: currentProduct.source,
                thumbnail: currentProduct.thumbnail,
                image: currentProduct.image,
                selectedImageUrl: imageUrl
              });
              
              if (imageUrl) {
                return (
                  <div className="flex-shrink-0">
                    <img
                      src={imageUrl}
                      alt={currentProduct.title}
                      className="w-32 h-32 object-cover rounded-lg shadow-md"
                                              onError={(e) => {
                          // If image fails to load, replace with styled placeholder
                          const target = e.target as HTMLImageElement;
                          const parent = target.parentElement;
                          if (parent) {
                            parent.innerHTML = `
                              <div class="w-32 h-32 bg-gradient-to-br from-red-100 to-red-200 rounded-lg shadow-md flex items-center justify-center border border-red-300">
                                <div class="text-center">
                                  <div class="text-red-400 text-2xl mb-1">❌</div>
                                  <span class="text-red-500 text-xs font-medium">
                                    Image Failed
                                  </span>
                                </div>
                              </div>
                            `;
                          }
                        }}
                    />
                  </div>
                );
              } else {
                // Show a placeholder when no image is available
                return (
                  <div className="flex-shrink-0">
                    <div className="w-32 h-32 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg shadow-md flex items-center justify-center border border-gray-300">
                      <div className="text-center">
                        <div className="text-gray-400 text-2xl mb-1">📦</div>
                        <span className="text-gray-500 text-xs font-medium">
                          No Image
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }
            })()}
            
            {/* Product Details */}
            <div className="flex-1 space-y-3">
              <h4 className="text-xl font-bold text-gray-800 line-clamp-2">
                {currentProduct.title}
              </h4>
              
              <div className="flex items-center gap-4">
                {currentProduct.rating && (
                  <div className="flex items-center gap-1">
                    {getRatingStars(currentProduct.rating)}
                    {currentProduct.reviews && (
                      <span className="text-sm text-gray-600">
                        ({currentProduct.reviews.toLocaleString()} reviews)
                      </span>
                    )}
                  </div>
                )}
                
                {(currentProduct.extracted_price || currentProduct.price) && (
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-bold text-green-600">
                      {currentProduct.price || formatPrice(currentProduct.extracted_price)}
                    </span>
                    {currentProduct.extracted_original_price && 
                     currentProduct.extracted_original_price > currentProduct.extracted_price && (
                      <span className="text-lg text-gray-500 line-through">
                        {formatPrice(currentProduct.extracted_original_price)}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Recommend Evaluation */}
              <div className="bg-white rounded-lg p-3 border">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  <span className="font-medium text-gray-700">
                    Recommend Score: {currentProduct.evaluation.score}/100
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {currentProduct.evaluation.reasons && currentProduct.evaluation.reasons.map((reason: string, idx: number) => (
                    <span
                      key={idx}
                      className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>

              {/* Source Badge */}
              <div className="flex items-center gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  currentProduct.source === 'amazon' 
                    ? 'bg-orange-100 text-orange-800' 
                    : currentProduct.source === 'google_shopping'
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-purple-100 text-purple-800'
                }`}>
                  {currentProduct.source === 'amazon' 
                    ? '🛒 Amazon' 
                    : '🛍️ Google Shopping'}
                </span>
                {currentProduct.is_prime && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                    Prime
                  </span>
                )}
              </div>

              {/* Action Button */}
              <Button
                onClick={() => window.open(currentProduct.link, '_blank')}
                className="w-full mt-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                View Product
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dots Indicator */}
      <div className="flex justify-center gap-1 mt-4">
        {products.map((_, index) => (
          <button
            key={index}
            onClick={() => setCurrentIndex(index)}
            className={`w-2 h-2 rounded-full transition-all ${
              index === currentIndex 
                ? 'bg-blue-600 w-4' 
                : 'bg-gray-300 hover:bg-gray-400'
            }`}
          />
        ))}
      </div>
    </div>
  );
}

export function ProductSearchDisplay({ result: initialResult }: ProductSearchDisplayProps) {
  console.log('🎯 ProductSearchDisplay received result:', initialResult);
  console.log('🎯 ProductSearchDisplay: originalQuery:', initialResult?.originalQuery);
  console.log('🎯 ProductSearchDisplay: recommendedProducts count:', initialResult?.recommendedProducts?.length);
  console.log('🎯 ProductSearchDisplay: render timestamp:', new Date().toISOString());
  
  // Handle null/undefined results
  if (!initialResult) {
    console.error('🚨 ProductSearchToolUI: result is null or undefined');
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <h3 className="text-red-800 font-medium mb-2">Search Error</h3>
        <p className="text-red-600 text-sm">
          Unable to display search results. The result data is missing or invalid.
        </p>
      </div>
    );
  }
  
  console.log('🎯 ProductSearchDisplay search steps:', initialResult.searchSteps);
  console.log('🏷️ ProductSearchDisplay suggested keywords:', initialResult.suggestedKeywords);
  
  const [result, setResult] = useState(initialResult);
  const [refreshingProduct, setRefreshingProduct] = useState(false);
  const [searchStepsExpanded, setSearchStepsExpanded] = useState(false);
  const [refreshingSearch, setRefreshingSearch] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // Force re-render key
  const [modifiedQuery, setModifiedQuery] = useState(initialResult.originalQuery); // Query with added keywords
  const [isSearching, setIsSearching] = useState(false); // Track if any search operation is in progress
  const [removedProductIndices, setRemovedProductIndices] = useState<Set<number>>(new Set()); // Track removed products
  const abortControllerRef = useRef<AbortController | null>(null); // For cancelling ongoing requests
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null); // For debouncing search requests
  const lastSearchTimeRef = useRef<number>(0); // Track last search time
  
  // Update result when initialResult changes (for normal searches, not refresh)
  useEffect(() => {
    console.log('🔄 ProductSearchDisplay: initialResult changed, updating state');
    console.log('🔄 ProductSearchDisplay: New initialResult:', initialResult);
    
    // Cancel any ongoing requests when new results arrive
    if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
      console.log('🚫 Cancelling previous request due to new results');
      abortControllerRef.current.abort();
    }
    
    // Reset all state for new search
    setResult(initialResult);
    setModifiedQuery(initialResult.originalQuery); // Reset modified query to original
    setRefreshingProduct(false);
    setRefreshingSearch(false);
    setIsSearching(false);
    setRemovedProductIndices(new Set()); // Reset removed products for new search
    setRefreshKey(prev => prev + 1); // Force re-render for new search
  }, [initialResult]);



  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
        console.log('🚫 Component unmounting, cancelling requests');
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        console.log('🚫 Component unmounting, clearing debounce timer');
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // DEBUG: Watch for changes in the result state to track re-renders
  useEffect(() => {
    console.log(`🔄 ProductSearchDisplay: ===== RESULT STATE CHANGED =====`);
    console.log(`🔄 ProductSearchDisplay: Current result keys:`, Object.keys(result));
    console.log(`🔄 ProductSearchDisplay: Current search steps count:`, result.searchSteps?.length);
    if (result.searchSteps && result.searchSteps.length > 0) {
      console.log(`🔄 ProductSearchDisplay: First step keywords:`, result.searchSteps[0]?.keywords);
      console.log(`🔄 ProductSearchDisplay: All step keywords:`, result.searchSteps.map(s => s.keywords));
    }
    console.log(`🔄 ProductSearchDisplay: Current product:`, result.recommendedProduct?.title);
    console.log(`🔄 ProductSearchDisplay: Recommended products count:`, result.recommendedProducts?.length);
    if (result.recommendedProducts && result.recommendedProducts.length > 0) {
      console.log(`🔄 ProductSearchDisplay: All product titles:`, result.recommendedProducts.map(p => p.title));
    }
    console.log(`🔄 ProductSearchDisplay: Current refreshKey:`, refreshKey);
    console.log(`🔄 ProductSearchDisplay: Refreshing search:`, refreshingSearch);
    console.log(`🔄 ProductSearchDisplay: ===============================`);
  }, [result, refreshKey, refreshingSearch]);
  
  // Calculate initial price range from search results
  const calculatePriceRange = (searchResult: ProductSearchResult) => {
    const allPrices: number[] = [];
    
    // Collect all prices from accumulated products
    if (searchResult.allAccumulatedProducts) {
      searchResult.allAccumulatedProducts.forEach(product => {
        if (product.extracted_price && product.extracted_price > 0) {
          allPrices.push(product.extracted_price);
        }
      });
    }
    
    if (allPrices.length === 0) {
      return { min: 10, max: 500 }; // Default range
    }
    
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const range = maxPrice - minPrice;
    
    // Make the range a bit wider (20% on each side)
    const expandedMin = Math.max(1, Math.floor(minPrice - range * 0.2));
    const expandedMax = Math.ceil(maxPrice + range * 0.2);
    
    return { min: expandedMin, max: expandedMax };
  };
  
  const initialPriceRange = calculatePriceRange(initialResult);
  const [priceRange, setPriceRange] = useState({ 
    min: initialPriceRange.min, 
    max: initialPriceRange.max 
  });
  const [selectedPriceRange, setSelectedPriceRange] = useState({
    min: initialPriceRange.min,
    max: initialPriceRange.max
  });
  const [minSliderZIndex, setMinSliderZIndex] = useState(10);
  const [maxSliderZIndex, setMaxSliderZIndex] = useState(9);
  const [activeSlider, setActiveSlider] = useState<'min' | 'max' | null>(null);
  
  // Refs for the range inputs to manage focus
  const minSliderRef = useRef<HTMLInputElement>(null);
  const maxSliderRef = useRef<HTMLInputElement>(null);

  // Handle mouse down to determine which slider should be on top
  const handleSliderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const sliderWidth = rect.width;
    const range = priceRange.max - priceRange.min;
    
    // Calculate exact positions of min and max handles (center of dots)
    const minPosition = ((selectedPriceRange.min - priceRange.min) / range) * sliderWidth;
    const maxPosition = ((selectedPriceRange.max - priceRange.min) / range) * sliderWidth;
    
    // Define click tolerance (radius of the dots is 16px)
    const dotRadius = 20; // Increased for better detection
    
    // Check distances to both dots
    const distanceToMin = Math.abs(clickX - minPosition);
    const distanceToMax = Math.abs(clickX - maxPosition);
    
    console.log('🔍 Click detection:', {
      clickX,
      minPosition,
      maxPosition,
      distanceToMin,
      distanceToMax,
      dotRadius
    });
    
    // Check if click is closer to min dot (left ball)
    if (distanceToMin <= dotRadius && distanceToMin <= distanceToMax) {
      setActiveSlider('min');
      setMinSliderZIndex(20);
      setMaxSliderZIndex(9);
      setTimeout(() => {
        if (minSliderRef.current) {
          minSliderRef.current.focus();
        }
      }, 0);
    } else if (distanceToMax <= dotRadius && distanceToMax < distanceToMin) {
      setActiveSlider('max');
      setMaxSliderZIndex(20);
      setMinSliderZIndex(10);
      setTimeout(() => {
        if (maxSliderRef.current) {
          maxSliderRef.current.focus();
        }
      }, 0);
    }
  };


  
  const formatPrice = (price?: number) => {
    if (!price) return null;
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(price);
  };

  const getRatingStars = (rating?: number) => {
    if (!rating) return null;
    return (
      <div className="flex items-center gap-1">
        <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
        <span className="text-sm font-medium">{rating}</span>
      </div>
    );
  };

  // Handle refresh for product only
  const handleProductRefresh = async () => {
    // Prevent concurrent operations
    if (refreshingProduct || isSearching) {
      console.log('🚫 Blocking concurrent product refresh - already in progress');
      return;
    }
    
    try {
      console.log(`🔄 Refreshing recommended product`);
      
      setRefreshingProduct(true);
      setIsSearching(true);

      // Construct refresh request for product
      const refreshRequest = {
        type: 'refresh',
        originalQuery: result.originalQuery,
        refreshFromIteration: result.searchSteps.length,
        refreshType: 'product',
        sessionId: result.sessionId || `session_${Date.now()}`,
        searchStepsUpToRefresh: result.searchSteps,
        allProductsUpToRefresh: result.allAccumulatedProducts || []
      };

      // Make direct API call
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: `REFRESH_PRODUCT_SEARCH:${JSON.stringify(refreshRequest)}`
            }
          ],
          tools: ['intelligent_product_search']
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Parse the streaming response to get the final result
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          
          // Look for tool result in the buffer
          const lines = buffer.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ') && line.includes('"type":"tool-result"')) {
              try {
                const data = JSON.parse(line.substring(6));
                if (data.type === 'tool-result' && data.toolName === 'intelligent_product_search') {
                  const refreshedResult = data.result?.result;
                  if (refreshedResult) {
                    // Update only the recommended product
                    setResult(prevResult => ({
                      ...prevResult,
                      recommendedProduct: refreshedResult.recommendedProduct,
                      searchSummary: refreshedResult.searchSummary,
                      allAccumulatedProducts: refreshedResult.allAccumulatedProducts
                    }));
                    return; // Exit once we find the result
                  }
                }
              } catch (e) {
                // Continue looking for valid JSON
              }
            }
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing product:', error);
    } finally {
      setRefreshingProduct(false);
      setIsSearching(false);
    }
  };

  // Handle removing a product from the display
  const handleRemoveProduct = (indexToRemove: number) => {
    console.log(`🗑️ Removing product at index ${indexToRemove}`);
    setRemovedProductIndices(prev => new Set([...prev, indexToRemove]));
  };

  // Handle new search with current query, only updating search boxes and product box
  const handleRefreshSearch = async () => {
    // Prevent concurrent searches
    if (refreshingSearch || isSearching || !modifiedQuery) {
      console.log('🚫 Blocking concurrent search - already in progress');
      return;
    }

    // Debouncing: prevent rapid successive searches (minimum 2 seconds between searches)
    const now = Date.now();
    const timeSinceLastSearch = now - lastSearchTimeRef.current;
    const minInterval = 2000; // 2 seconds

    if (timeSinceLastSearch < minInterval) {
      const remainingTime = minInterval - timeSinceLastSearch;
      console.log(`⏳ Debouncing search - waiting ${remainingTime}ms before next search`);
      
      // Clear any existing debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      
      // Set a new debounce timer
      debounceTimerRef.current = setTimeout(() => {
        handleRefreshSearch();
      }, remainingTime);
      
      return;
    }

    // Update last search time
    lastSearchTimeRef.current = now;
    
    // Cancel any existing request
    if (abortControllerRef.current && !abortControllerRef.current.signal.aborted) {
      console.log('🚫 Cancelling previous refresh request');
      abortControllerRef.current.abort();
    }
    
    // Create new abort controller for this request
    abortControllerRef.current = new AbortController();
    
    setRefreshingSearch(true);
    setIsSearching(true);
    console.log('🔄 Frontend: Starting refresh search with query:', modifiedQuery);
    
    try {
      // Make direct API call for new product search
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        signal: abortControllerRef.current.signal, // Add abort signal
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: modifiedQuery
            }
          ],
          tools: ['intelligent_product_search']
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Parse the streaming response to get the final result
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;
          
          // Look for the complete tool result
          const lines = buffer.split('\n');
          for (const line of lines) {
            
            // Look for tool result in 'a:' lines (not 'data:' lines)
            if (line.startsWith('a:')) {
              try {
                const data = JSON.parse(line.substring(2));
                if (data.toolCallId && data.result && data.result.type === 'product_search') {
                  console.log('🔄 REFRESH: Found new search results!');
                  
                  const newSearchResult = data.result?.result;
                  
                  if (newSearchResult) {
                    
                    // Update only the search steps and products, keep everything else
                    const updatedResult = {
                      ...result,
                      searchSteps: newSearchResult.searchSteps || [],
                      recommendedProducts: newSearchResult.recommendedProducts || [],
                      recommendedProduct: newSearchResult.recommendedProducts?.[0] || null,
                      searchSummary: newSearchResult.searchSummary || result.searchSummary,
                      allAccumulatedProducts: newSearchResult.allAccumulatedProducts || []
                    };
                    
                    // Update the result state
                    setResult(updatedResult);
                    
                    // Force re-render with new key
                    setRefreshKey(prev => prev + 1);
                    
                    console.log('🔄 REFRESH: Successfully updated search results');
                    setRefreshingSearch(false);
                    return;
                  }
                }
              } catch (e) {
                // Continue parsing other lines
              }
            }
          }
        }
      }
      
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('🚫 Refresh request was cancelled');
      } else {
        console.error('🔄 Frontend: Error during refresh:', error);
      }
    } finally {
      setRefreshingSearch(false);
      setIsSearching(false);
    }
  };

  // Check if this is a blocked search result
  const isBlockedSearch = result.searchSummary?.includes('Search blocked') || 
                         result.searchSteps?.[0]?.keywords?.includes('SEARCH BLOCKED');

  return (
    <>
      {/* Blocked Search Warning */}
      {isBlockedSearch && (
        <div className="max-w-4xl mx-auto p-6 mb-4">
          <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg shadow-md">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="h-5 w-5 text-yellow-400">⚠️</div>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-yellow-800">
                  Search Currently Blocked
                </h3>
                <div className="mt-2 text-sm text-yellow-700">
                  <p>{result.searchSummary}</p>
                  <p className="mt-1 text-xs">
                    Tip: Wait 30-60 seconds and try your search again, or refresh the page if needed.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      
      <style jsx>{`
        .dual-range-slider::-webkit-slider-thumb {
          appearance: none;
          height: 32px;
          width: 32px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 4px solid #ffffff;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25);
          pointer-events: auto;
        }
        
        .dual-range-slider::-moz-range-thumb {
          height: 32px;
          width: 32px;
          border-radius: 50%;
          background: #3b82f6;
          cursor: pointer;
          border: 4px solid #ffffff;
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25);
          pointer-events: auto;
        }
        
        .dual-range-slider::-webkit-slider-track {
          background: transparent;
          border-radius: 5px;
        }
        
        .dual-range-slider::-moz-range-track {
          background: transparent;
          border-radius: 5px;
        }
        
        .dual-range-slider:focus {
          outline: none;
        }
        
        .dual-range-slider:focus::-webkit-slider-thumb {
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25), 0 0 0 4px rgba(59, 130, 246, 0.3);
        }
        
        .dual-range-slider:focus::-moz-range-thumb {
          box-shadow: 0 3px 8px rgba(0, 0, 0, 0.25), 0 0 0 4px rgba(59, 130, 246, 0.3);
        }
        
        .dual-range-slider::-webkit-slider-thumb:hover {
          background: #2563eb;
          transform: scale(1.05);
          transition: all 0.2s ease;
        }
        
        .dual-range-slider::-moz-range-thumb:hover {
          background: #2563eb;
          transform: scale(1.05);
          transition: all 0.2s ease;
        }
        
        .dual-range-slider::-webkit-slider-thumb:active {
          background: #1d4ed8;
          transform: scale(1.1);
        }
        
        .dual-range-slider::-moz-range-thumb:active {
          background: #1d4ed8;
          transform: scale(1.1);
        }
      `}</style>
      <div className="max-w-4xl mx-auto p-6 space-y-4">
      {/* Only show the main UI if search is not blocked */}
      {!isBlockedSearch && (
        <>
        {/* Original Query Box */}
      <Card className="border border-gray-200 bg-gray-50/50 shadow-sm hover:shadow-md transition-shadow duration-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-800">Search Query</span>
            </div>
            <div className="flex items-center gap-3">
              {/* Refresh Search Button */}
              <button
                onClick={handleRefreshSearch}
                disabled={refreshingSearch || isSearching}
                className={`p-2 rounded-full bg-blue-100 hover:bg-blue-200 transition-colors text-blue-600 hover:text-blue-700 ${
                  refreshingSearch || isSearching ? 'animate-spin opacity-50' : ''
                }`}
                title="Search for new products with the same query"
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              
              {/* Expand/Collapse Button */}
              <div 
                className="flex items-center gap-2 cursor-pointer"
                onClick={() => setSearchStepsExpanded(!searchStepsExpanded)}
              >
                <span className="text-sm text-gray-600 font-medium">
                  {searchStepsExpanded ? 'Hide details' : 'Show details'}
                </span>
                <div className="p-1 rounded-full bg-gray-200 hover:bg-gray-300 transition-colors">
                  {searchStepsExpanded ? (
                    <ChevronDown className="h-5 w-5 text-gray-700" />
                  ) : (
                    <ChevronRight className="h-5 w-5 text-gray-700" />
                  )}
                </div>
              </div>
            </div>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-gray-700 font-medium flex-1">{modifiedQuery}</p>
            {modifiedQuery !== result.originalQuery && (
              <button
                onClick={() => {
                  setModifiedQuery(result.originalQuery);
                  console.log('🔄 Reset query to original:', result.originalQuery);
                }}
                className="ml-3 px-2 py-1 text-xs text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                title="Reset to original query"
              >
                Reset
              </button>
            )}
          </div>
          
          {/* Suggested Keywords */}
          {(result.suggestedKeywords && result.suggestedKeywords.length > 0) && (
            <div className="mt-3">
              <p className="text-xs text-gray-500 mb-2">Suggested refinements:</p>
              <div className="flex flex-wrap gap-2">
                {result.suggestedKeywords.map((keyword, index) => {
                  // Define diverse color schemes for keyword boxes (20 unique colors)
                  const colorSchemes = [
                    { // Ocean Blue
                      default: 'bg-transparent text-blue-700 border-blue-400',
                      hover: 'hover:bg-blue-50 hover:border-blue-600',
                      selected: 'bg-blue-200 border-blue-500 text-blue-900'
                    },
                    { // Forest Green
                      default: 'bg-transparent text-emerald-700 border-emerald-400',
                      hover: 'hover:bg-emerald-50 hover:border-emerald-600',
                      selected: 'bg-emerald-200 border-emerald-500 text-emerald-900'
                    },
                    { // Royal Purple
                      default: 'bg-transparent text-purple-700 border-purple-400',
                      hover: 'hover:bg-purple-50 hover:border-purple-600',
                      selected: 'bg-purple-200 border-purple-500 text-purple-900'
                    },
                    { // Sunset Orange
                      default: 'bg-transparent text-orange-700 border-orange-400',
                      hover: 'hover:bg-orange-50 hover:border-orange-600',
                      selected: 'bg-orange-200 border-orange-500 text-orange-900'
                    },
                    { // Cherry Red
                      default: 'bg-transparent text-red-700 border-red-400',
                      hover: 'hover:bg-red-50 hover:border-red-600',
                      selected: 'bg-red-200 border-red-500 text-red-900'
                    },
                    { // Tropical Teal
                      default: 'bg-transparent text-teal-700 border-teal-400',
                      hover: 'hover:bg-teal-50 hover:border-teal-600',
                      selected: 'bg-teal-200 border-teal-500 text-teal-900'
                    },
                    { // Sunset Pink
                      default: 'bg-transparent text-pink-700 border-pink-400',
                      hover: 'hover:bg-pink-50 hover:border-pink-600',
                      selected: 'bg-pink-200 border-pink-500 text-pink-900'
                    },
                    { // Deep Indigo
                      default: 'bg-transparent text-indigo-700 border-indigo-400',
                      hover: 'hover:bg-indigo-50 hover:border-indigo-600',
                      selected: 'bg-indigo-200 border-indigo-500 text-indigo-900'
                    },
                    { // Golden Yellow
                      default: 'bg-transparent text-yellow-700 border-yellow-400',
                      hover: 'hover:bg-yellow-50 hover:border-yellow-600',
                      selected: 'bg-yellow-200 border-yellow-500 text-yellow-900'
                    },
                    { // Fresh Lime
                      default: 'bg-transparent text-lime-700 border-lime-400',
                      hover: 'hover:bg-lime-50 hover:border-lime-600',
                      selected: 'bg-lime-200 border-lime-500 text-lime-900'
                    },
                    { // Coral Rose
                      default: 'bg-transparent text-rose-700 border-rose-400',
                      hover: 'hover:bg-rose-50 hover:border-rose-600',
                      selected: 'bg-rose-200 border-rose-500 text-rose-900'
                    },
                    { // Electric Cyan
                      default: 'bg-transparent text-cyan-700 border-cyan-400',
                      hover: 'hover:bg-cyan-50 hover:border-cyan-600',
                      selected: 'bg-cyan-200 border-cyan-500 text-cyan-900'
                    },
                    { // Lavender Violet
                      default: 'bg-transparent text-violet-700 border-violet-400',
                      hover: 'hover:bg-violet-50 hover:border-violet-600',
                      selected: 'bg-violet-200 border-violet-500 text-violet-900'
                    },
                    { // Warm Amber
                      default: 'bg-transparent text-amber-700 border-amber-400',
                      hover: 'hover:bg-amber-50 hover:border-amber-600',
                      selected: 'bg-amber-200 border-amber-500 text-amber-900'
                    },
                    { // Cool Slate
                      default: 'bg-transparent text-slate-700 border-slate-400',
                      hover: 'hover:bg-slate-50 hover:border-slate-600',
                      selected: 'bg-slate-300 border-slate-500 text-slate-900'
                    },
                    { // Spring Green
                      default: 'bg-transparent text-green-700 border-green-400',
                      hover: 'hover:bg-green-50 hover:border-green-600',
                      selected: 'bg-green-200 border-green-500 text-green-900'
                    },
                    { // Warm Fuchsia
                      default: 'bg-transparent text-fuchsia-700 border-fuchsia-400',
                      hover: 'hover:bg-fuchsia-50 hover:border-fuchsia-600',
                      selected: 'bg-fuchsia-200 border-fuchsia-500 text-fuchsia-900'
                    },
                    { // Sky Blue
                      default: 'bg-transparent text-sky-700 border-sky-400',
                      hover: 'hover:bg-sky-50 hover:border-sky-600',
                      selected: 'bg-sky-200 border-sky-500 text-sky-900'
                    },
                    { // Neutral Stone
                      default: 'bg-transparent text-stone-700 border-stone-400',
                      hover: 'hover:bg-stone-50 hover:border-stone-600',
                      selected: 'bg-stone-300 border-stone-500 text-stone-900'
                    },
                    { // Deep Zinc
                      default: 'bg-transparent text-zinc-700 border-zinc-400',
                      hover: 'hover:bg-zinc-50 hover:border-zinc-600',
                      selected: 'bg-zinc-300 border-zinc-500 text-zinc-900'
                    }
                  ];
                  
                  // Cycle through colors if more than 20 keywords
                  const colors = colorSchemes[index % colorSchemes.length];
                  
                  return (
                    <button
                      key={index}
                                          onClick={() => {
                      if (modifiedQuery.includes(keyword)) {
                        // Remove the keyword if it's already present
                        let newQuery = modifiedQuery;
                        
                        // Remove with leading comma and space
                        newQuery = newQuery.replace(`, ${keyword}`, '');
                        // Remove with just leading comma (no space)
                        newQuery = newQuery.replace(`,${keyword}`, '');
                        // Remove if it's at the beginning with trailing comma and space
                        newQuery = newQuery.replace(`${keyword}, `, '');
                        // Remove if it's at the beginning with just trailing comma
                        newQuery = newQuery.replace(`${keyword},`, '');
                        // Remove if it's the only keyword
                        newQuery = newQuery.replace(keyword, '');
                        
                        // Clean up any double commas or leading/trailing commas
                        newQuery = newQuery.replace(/,\s*,/g, ',').replace(/^,\s*/, '').replace(/,\s*$/, '');
                        
                        setModifiedQuery(newQuery);
                        console.log('🏷️ Removed keyword:', keyword, 'New query:', newQuery);
                      } else {
                        // Add the keyword if it's not present
                        const newQuery = `${modifiedQuery}, ${keyword}`;
                        setModifiedQuery(newQuery);
                        console.log('🏷️ Added keyword:', keyword, 'New query:', newQuery);
                      }
                    }}
                      className={`px-3 py-1 text-xs border border-dashed rounded-md transition-colors ${colors.hover} ${
                        modifiedQuery.includes(keyword) 
                          ? colors.selected
                          : colors.default
                      }`}
                      title={`Click to add "${keyword}" to your search`}
                    >
                      {keyword}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
          
          {/* Loading message when refreshing */}
          {(refreshingSearch || isSearching) && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center gap-2 text-blue-600">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-sm font-medium">Searching for the most suitable products and services...</span>
              </div>
              
              {/* Search Sources Progress */}
              <div className="ml-6 space-y-1">
                <p className="text-xs text-gray-600">🏠 Searching local products and services</p>
                <p className="text-xs text-gray-600">🔍 Searching Amazon marketplace</p>
                <p className="text-xs text-gray-600">🛒 Searching Google Shopping</p>
                <p className="text-xs text-gray-600">🏪 Searching eBay marketplace</p>
                <p className="text-xs text-gray-600">🏬 Searching Walmart</p>
                <p className="text-xs text-gray-600">🎨 Searching Etsy</p>
                <p className="text-xs text-gray-600">👗 Searching Shein</p>
                <p className="text-xs text-gray-600">🛍️ Searching Temu</p>
                <p className="text-xs text-gray-600">🗺️ Searching Google Maps services</p>
                <p className="text-xs text-gray-600">💬 Reading customer comments</p>
                <p className="text-xs text-gray-600">🤖 Evaluating product quality</p>
              </div>
            </div>
          )}

        </CardContent>
      </Card>
      
      {/* Search Steps Flow - Only show when expanded */}
            {searchStepsExpanded && (
        <div className="space-y-4 animate-in slide-in-from-top-2 duration-300" key={`search-steps-${refreshKey}-${Date.now()}`}>
          {result.searchSteps.filter(step => step.stepType !== 'intent').map((step, index) => {
            console.log(`🔍 Rendering search step ${index + 1}:`, step);
            console.log(`🔍 Step ${index + 1} price range:`, step.priceRange);
            
            // Define different color schemes for each search step
            const colorSchemes = [
              { // Step 1 - Blue
                border: 'border-blue-200',
                bg: 'bg-blue-50/50',
                textPrimary: 'text-blue-700',
                textSecondary: 'text-blue-600',
                textTertiary: 'text-blue-500'
              },
              { // Step 2 - Green
                border: 'border-green-200',
                bg: 'bg-green-50/50',
                textPrimary: 'text-green-700',
                textSecondary: 'text-green-600',
                textTertiary: 'text-green-500'
              },
              { // Step 3 - Purple
                border: 'border-purple-200',
                bg: 'bg-purple-50/50',
                textPrimary: 'text-purple-700',
                textSecondary: 'text-purple-600',
                textTertiary: 'text-purple-500'
              },
              { // Step 4 - Orange
                border: 'border-orange-200',
                bg: 'bg-orange-50/50',
                textPrimary: 'text-orange-700',
                textSecondary: 'text-orange-600',
                textTertiary: 'text-orange-500'
              },
              { // Step 5 - Teal
                border: 'border-teal-200',
                bg: 'bg-teal-50/50',
                textPrimary: 'text-teal-700',
                textSecondary: 'text-teal-600',
                textTertiary: 'text-teal-500'
              },
              { // Step 6 - Indigo
                border: 'border-indigo-200',
                bg: 'bg-indigo-50/50',
                textPrimary: 'text-indigo-700',
                textSecondary: 'text-indigo-600',
                textTertiary: 'text-indigo-500'
              }
            ];
            
            // Cycle through colors if more than 6 steps
            const colors = colorSchemes[index % colorSchemes.length];
            
            return (
              <div key={`step-${index}-${refreshKey}-${Date.now()}-${step.keywords?.slice(0,10)}`}>
              {/* Step Box */}
              <Card className={`border ${colors.border} ${colors.bg} shadow-sm hover:shadow-md transition-shadow duration-200`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`font-medium ${colors.textPrimary}`}>
                      {`🔍 ${step.keywords.slice(0, 30)}${step.keywords.length > 30 ? '...' : ''}`}
                    </span>
                    {step.level && (
                      <span className={`text-xs px-2 py-1 rounded-full bg-gray-100 ${colors.textTertiary}`}>
                        Level {step.level}
                      </span>
                    )}
                    {step.searchPath && step.searchPath !== 'ROOT' && (
                      <span className={`text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700`}>
                        Path: {step.searchPath}
                      </span>
                    )}
                  </div>
                  <p className={`font-medium mb-2 ${colors.textSecondary}`}>
                    {step.keywords}
                  </p>
                  {step.refinementReason && (
                    <p className={`text-sm mb-2 ${colors.textTertiary}`}>
                      💡 {step.refinementReason}
                    </p>
                  )}
                  {(step.amazonResults > 0 || step.googleShoppingResults && step.googleShoppingResults > 0 || step.googleMapsResults && step.googleMapsResults > 0 || step.localResults && step.localResults > 0) && (
                    <div className={`flex gap-4 text-sm ${colors.textTertiary} flex-wrap`}>
                      {step.amazonResults > 0 && <span>🛒 Amazon: {step.amazonResults} results</span>}
                      {step.googleShoppingResults !== undefined && step.googleShoppingResults > 0 && <span>🛍️ Google Shopping: {step.googleShoppingResults} results</span>}
                      {step.googleMapsResults !== undefined && step.googleMapsResults > 0 && <span>🗺️ Google Maps: {step.googleMapsResults} results</span>}
                      {step.localResults !== undefined && step.localResults > 0 && <span>🏠 Local: {step.localResults} results</span>}
                    </div>
                  )}
                  {step.priceRange && (
                    <div className={`text-sm ${colors.textTertiary}`}>
                      💰 Price range: ${step.priceRange.min || 'any'} - ${step.priceRange.max || 'any'}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
            );
          })}
        </div>
      )}


              
              {/* Separate Products and Services */}
        {(result.recommendedProducts && result.recommendedProducts.length > 0) ? (
          (() => {
            console.log('✅ RENDERING BUNDLE with', result.recommendedProducts.length, 'items');
            
            // Separate products and services
            const products = result.recommendedProducts.filter(item => 
              item.type === 'product' || item.source === 'amazon' || item.source === 'google_shopping'
            );
            const services = result.recommendedProducts.filter(item => 
              item.type === 'service'
            );
            
            console.log('📦 Products:', products.length, 'Services:', services.length);
            
            return (
              <div className="space-y-6">
                {/* Products Section */}
                {products.length > 0 && (
                  <Card className="border-2 border-blue-300 bg-gradient-to-br from-blue-50 via-indigo-50 to-violet-50 shadow-xl">
                    <CardContent className="p-6">
                      {/* Header */}
                      <div className="flex justify-between items-start mb-6">
                        <div>
                          <h3 className="text-xl font-semibold text-blue-800 mb-2">
                            Recommended Products Bundle
                          </h3>
                          <div className="flex items-center gap-4">
                            <span className="bg-blue-100 text-blue-800 text-sm font-medium px-3 py-1 rounded-full">
                              {products.filter((_, index) => !removedProductIndices.has(index)).length} products
                            </span>
                            <div className="bg-green-100 text-green-800 px-4 py-2 rounded-lg border border-green-200">
                              <span className="text-sm font-medium">Bundle Total: </span>
                              <span className="text-lg font-bold">
                                ${(() => {
                                  const total = products
                                    .filter((_, index) => !removedProductIndices.has(index))
                                    .reduce((sum: number, product: any) => {
                                      const price = parseFloat(product.price?.toString().replace('$', '') || '0');
                                      return sum + (isNaN(price) ? 0 : price);
                                    }, 0);
                                  return total.toFixed(2);
                                })()}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="bg-gradient-to-r from-purple-100 to-pink-100 text-purple-800 px-3 py-2 rounded-lg border border-purple-200">
                            <div className="text-xs font-medium">Curated Selection</div>
                            <div className="text-sm">✨ Bundle Deal</div>
                          </div>
                        </div>
                      </div>
              
                      {/* Products Grid */}
                      <div className="space-y-4">
                        {(() => {
                          const visibleProducts = products
                            .map((product: any, index: number) => ({ product, originalIndex: index }))
                            .filter(({ originalIndex }) => !removedProductIndices.has(originalIndex));
                  
                  if (visibleProducts.length === 0) {
                    return (
                      <div className="text-center py-8">
                        <div className="text-gray-500 text-lg mb-2">🛒 No products in bundle</div>
                        <p className="text-gray-400 text-sm">All products have been removed from this bundle.</p>
                      </div>
                    );
                  }
                  
                  return visibleProducts.map(({ product, originalIndex }, displayIndex) => (
                  <div key={`product-${refreshKey}-${originalIndex}-${product?.title?.slice(0,10) || 'no-product'}`} 
                       className={`border border-gray-200 bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-all duration-300 ${
                         refreshingProduct ? 'opacity-60' : ''
                       }`}>
                    
                    {/* Bundle Item Header */}
                    <div className="flex justify-between items-center mb-3">
                      <div className="flex items-center gap-3">
                        <span className="bg-blue-600 text-white text-sm font-bold px-3 py-1 rounded-full min-w-[32px] text-center">
                          {displayIndex + 1}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-lg font-bold text-green-600">
                          {product.price?.toString().startsWith('$') 
                            ? product.price 
                            : `$${product.price}`}
                        </div>
                        {/* Remove Button */}
                        <button
                          onClick={() => handleRemoveProduct(originalIndex)}
                          className="p-1 rounded-full hover:bg-red-50 transition-colors text-red-500 hover:text-red-700 hover:bg-red-100"
                          title="Remove this product"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    
                                        {/* Product Details */}
                    <div className="space-y-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 mr-4">
                          <h4 className="font-medium text-gray-900 mb-3 line-clamp-2 text-lg">
                            {product.title}
                          </h4>
                          
                          {/* Source Badge and Rating */}
                          <div className="flex items-center gap-2 mb-3">
                            <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                              product.source === 'amazon' 
                                ? 'bg-orange-100 text-orange-800 border border-orange-200' 
                                : product.source === 'google_shopping'
                                ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                : 'bg-purple-100 text-purple-800 border border-purple-200'
                            }`}>
                              {product.source === 'amazon' 
                                ? '🛒 Amazon' 
                                : '🛍️ Google Shopping'}
                            </span>
                            {product.seller && product.source === 'google_shopping' && (
                              <span className="px-2 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full border border-green-200">
                                📍 {product.seller}
                              </span>
                            )}
                            {product.is_prime && (
                              <span className="px-2 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full border border-blue-200">
                                Prime
                              </span>
                            )}
                          </div>
                          
                          {/* Source Query Badge */}
                          {(product as any).sourceQuery && (
                            <div className="mb-3">
                              <span className="px-2 py-1 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full border border-indigo-200">
                                🔍 From: {(product as any).sourceQuery} (Level {(product as any).sourceLevel})
                              </span>
                            </div>
                          )}
                          
                          <div className="flex items-center mb-3">
                            <div className="flex items-center text-yellow-400 mr-3">
                              <Star className="h-4 w-4 fill-current" />
                              <span className="ml-1 text-sm font-medium text-gray-700">
                                {product.rating}
                              </span>
                            </div>
                            <span className="text-sm text-gray-500">
                              ({product.reviews?.toLocaleString()} reviews)
                            </span>
                          </div>
                        </div>
                        
                        {/* Product Image */}
                        <div className="w-32 h-32 bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0 shadow-md border border-gray-200">
                          {(() => {
                            const imageUrl = product.thumbnail || product.image || 
                                           product.product_photos?.[0] || product.images?.[0] || 
                                           product.photo || product.img;
                            
                            if (imageUrl) {
                              return (
                                <img 
                                  src={imageUrl} 
                                  alt={product.title}
                                  className="w-full h-full object-cover rounded-xl"
                                  onError={(e) => {
                                    e.currentTarget.style.display = 'none';
                                    const parent = e.currentTarget.parentElement;
                                    if (parent) {
                                      parent.innerHTML = `
                                        <div class="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center">
                                          <span class="text-gray-500 text-xs font-medium">No image</span>
                                        </div>
                                      `;
                                    }
                                  }}
                                />
                              );
                            }
                            
                            return (
                              <div className="w-full h-full bg-gradient-to-br from-gray-100 to-gray-200 rounded-xl flex items-center justify-center">
                                <span className="text-gray-500 text-xs font-medium">No image</span>
                              </div>
                            );
                          })()}
                        </div>
                      </div>
                    </div>
                    
                    {/* Evaluation Score & Reasoning */}
                    {product.evaluation && (
                        <div className="bg-gradient-to-r from-slate-50 via-blue-50 to-indigo-50 border border-slate-200 rounded-xl p-4 shadow-sm">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium text-slate-800">AI Recommendation Score</span>
                            <div className="flex items-center">
                              <TrendingUp className="h-4 w-4 text-indigo-600 mr-1" />
                              <span className="font-bold text-indigo-700">
                                {product.evaluation.score}/100
                              </span>
                            </div>
                          </div>
                          
                          {product.evaluation.reasoning && (
                            <p className="text-sm text-slate-700 mb-3 leading-relaxed">
                              {product.evaluation.reasoning}
                            </p>
                          )}
                          
                          {product.evaluation.reasons && product.evaluation.reasons.length > 0 && (
                            <div>
                              <span className="text-xs font-medium text-slate-800 uppercase tracking-wide block mb-2">
                                Key Features
                              </span>
                              <div className="flex flex-wrap gap-2">
                                {product.evaluation.reasons.map((reason: string, reasonIndex: number) => (
                                  <span 
                                    key={reasonIndex} 
                                    className="inline-block bg-gradient-to-r from-violet-100 to-purple-100 text-violet-800 text-xs px-3 py-1.5 rounded-full border border-violet-300 shadow-sm hover:shadow-md transition-all duration-200 hover:scale-105"
                                  >
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    
                    {/* Action Button */}
                    {product.link && (
                      <Button 
                        onClick={() => product.link && window.open(product.link, '_blank')}
                        className="w-full mt-4 bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-700 hover:via-indigo-700 hover:to-violet-700 shadow-lg hover:shadow-xl transition-all duration-300"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        View Product
                      </Button>
                    )}
                  </div>
              ));
                })()}
                      </div>
                      </CardContent>
                    </Card>
                  )}
                  
                  {/* Services Section */}
                  {services.length > 0 && (
                    <Card className="border-2 border-purple-300 bg-gradient-to-br from-purple-50 via-violet-50 to-indigo-50 shadow-xl">
                      <CardContent className="p-6">
                        {/* Header */}
                        <div className="flex justify-between items-start mb-6">
                          <div>
                            <h3 className="text-xl font-semibold text-purple-800 mb-2">
                              Recommended Services
                            </h3>
                            <div className="flex items-center gap-4">
                              <span className="bg-purple-100 text-purple-800 text-sm font-medium px-3 py-1 rounded-full">
                                {services.length} services
                              </span>
                              <div className="bg-green-100 text-green-800 px-4 py-2 rounded-lg border border-green-200">
                                <span className="text-sm font-medium">Services Total: </span>
                                <span className="text-lg font-bold">
                                  ${(() => {
                                    const total = services.reduce((sum: number, service: any) => {
                                      const price = parseFloat(service.price?.toString().replace('$', '') || '0');
                                      return sum + (isNaN(price) ? 0 : price);
                                    }, 0);
                                    return total.toFixed(2);
                                  })()}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="bg-gradient-to-r from-violet-100 to-purple-100 text-violet-800 px-3 py-2 rounded-lg border border-violet-200">
                              <div className="text-xs font-medium">Local Providers</div>
                              <div className="text-sm">🏢 Services</div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Services Grid */}
                        <div className="space-y-4">
                          {services.map((service: any, index: number) => (
                            <div key={`service-${refreshKey}-${index}-${service?.title?.slice(0,10) || 'no-service'}`} 
                                 className="border border-purple-200 bg-white rounded-lg p-4 shadow-sm hover:shadow-md transition-all duration-300">
                              
                              {/* Service Header */}
                              <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center gap-3">
                                  <span className="bg-purple-600 text-white text-sm font-bold px-3 py-1 rounded-full min-w-[32px] text-center">
                                    {index + 1}
                                  </span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="text-lg font-bold text-green-600">
                                    {service.price ? (typeof service.price === 'string' ? (service.price.startsWith('$') ? service.price : `$${service.price}`) : `$${(service.price / 100).toFixed(2)}`) : '$0.00'}
                                  </div>
                                </div>
                              </div>
                              
                              {/* Service Details */}
                              <div className="space-y-4">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 mr-4">
                                    <h4 className="font-medium text-gray-900 mb-3 line-clamp-2 text-lg">
                                      {service.title || service.serviceDescription || 'Local Service'}
                                    </h4>
                                    
                                    {/* Source Badge */}
                                    <div className="flex items-center gap-2 mb-3">
                                      <span className="bg-purple-100 text-purple-800 border border-purple-200 px-3 py-1 rounded-full text-sm font-semibold">
                                        {service.website ? '🗺️ Google Maps' : '🏢 Local Service'}
                                      </span>
                                      {service.rating && (
                                        <div className="flex items-center gap-1">
                                          <div className="flex">
                                            {Array.from({ length: 5 }, (_, i) => (
                                              <Star key={i} className={`h-3 w-3 ${i < Math.floor(service.rating) ? 'fill-yellow-400 text-yellow-400' : 'fill-gray-200 text-gray-200'}`} />
                                            ))}
                                          </div>
                                          <span className="text-sm text-gray-600">
                                            {service.rating}★ {service.reviews && `(${service.reviews} reviews)`}
                                          </span>
                                        </div>
                                      )}
                                    </div>
                                    
                                    {/* Service Description */}
                                    <p className="text-sm text-gray-600 mb-3 line-clamp-3">
                                      {service.description || service.serviceDescription || 'Professional local service provider'}
                                    </p>
                                    
                                    {/* Service Info */}
                                    <div className="text-sm text-gray-500 space-y-1">
                                      {service.address && (
                                        <div>
                                          📍{' '}
                                          <a 
                                            href={`https://www.google.com/maps/search/${encodeURIComponent(service.address)}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                                          >
                                            {service.address}
                                          </a>
                                        </div>
                                      )}
                                      {service.phone && (
                                        <div>📞 {service.phone}</div>
                                      )}
                                      {service.open_state && (
                                        <div className={`font-medium ${service.open_state.toLowerCase().includes('open') ? 'text-green-600' : 'text-red-600'}`}>
                                          🕒 {service.open_state}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                  
                                  {/* Service Image */}
                                  <div className="flex-shrink-0">
                                    {(service.image || service.thumbnail) ? (
                                      <img 
                                        src={service.image || service.thumbnail} 
                                        alt={service.title || 'Service'}
                                        className="w-24 h-24 object-cover rounded-lg border"
                                      />
                                    ) : (
                                      <div className="w-24 h-24 bg-gradient-to-br from-purple-100 to-violet-200 rounded-lg flex items-center justify-center">
                                        <span className="text-2xl">🏢</span>
                                      </div>
                                    )}
                                  </div>
                                </div>
                                
                                {/* Action Button */}
                                <div className="flex">
                                  <Button
                                    className="bg-purple-600 hover:bg-purple-700 text-white flex items-center gap-2 w-full justify-center"
                                    onClick={() => {
                                      // Handle different URL field names for Google Maps vs Local services
                                      const serviceUrl = service.website || service.url || service.product_link;
                                      if (serviceUrl && serviceUrl !== '#') {
                                        window.open(serviceUrl, '_blank');
                                      } else {
                                        // If no direct URL, try to open Google Maps with place info
                                        if (service.title && service.address) {
                                          const searchQuery = encodeURIComponent(`${service.title} ${service.address}`);
                                          window.open(`https://www.google.com/maps/search/${searchQuery}`, '_blank');
                                        }
                                      }
                                    }}
                                    disabled={!service.website && !service.url && !service.product_link && (!service.title || !service.address)}
                                  >
                                    <span>Contact Provider</span>
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
            );
          })()
        ) : result.recommendedProduct && (
          (() => {
            console.log('⚠️ FALLING BACK TO SINGLE PRODUCT SECTION');
            return (
            <Card key={`product-${refreshKey}-${Date.now()}-${result.recommendedProduct?.title?.slice(0,10) || 'no-product'}`} className={`border border-green-200 bg-gradient-to-r from-green-50/50 to-emerald-50/50 shadow-sm hover:shadow-md transition-shadow duration-200 ${
              refreshingProduct ? 'opacity-60' : ''
            }`}>
            <CardContent className="p-6">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-semibold text-green-800">Recommended Product</h3>
                {/* Refresh Icon for Product */}
                <button
                  onClick={handleProductRefresh}
                  disabled={refreshingProduct}
                  className={`p-1 rounded-full hover:bg-white/50 transition-colors text-green-600 hover:text-green-700 ${
                    refreshingProduct ? 'animate-spin' : ''
                  }`}
                  title="Re-select best product from all results"
                >
                                </button>
            </div>
              
              {refreshingProduct ? (
                <div className="flex items-center justify-center gap-2 py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></div>
                  <span className="text-gray-600">Re-selecting best product...</span>
                </div>
              ) : (
                <div className="flex gap-6">
                  {/* Product Image */}
                  {result.recommendedProduct.thumbnail && (
                    <div className="flex-shrink-0">
                      <img
                        src={result.recommendedProduct.thumbnail}
                        alt={result.recommendedProduct.title}
                        className="w-32 h-32 object-cover rounded-lg shadow-md"
                      />
                    </div>
                  )}
                  
                  {/* Product Details */}
                  <div className="flex-1 space-y-3">
                    <h4 className="text-xl font-bold text-gray-800 line-clamp-2">
                      {result.recommendedProduct.title}
                    </h4>
                    
                    {/* Source Badge - Prominent Position */}
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${
                        result.recommendedProduct.source === 'amazon' 
                          ? 'bg-orange-100 text-orange-800 border border-orange-200' 
                          : result.recommendedProduct.source === 'google_shopping'
                          ? 'bg-blue-100 text-blue-800 border border-blue-200'
                          : 'bg-purple-100 text-purple-800 border border-purple-200'
                      }`}>
                        {result.recommendedProduct.source === 'amazon' 
                          ? '🛒 Amazon' 
                          : '🛍️ Google Shopping'}
                      </span>
                      {result.recommendedProduct.seller && result.recommendedProduct.source === 'google_shopping' && (
                        <span className="px-2 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-full border border-green-200">
                          📍 {result.recommendedProduct.seller}
                        </span>
                      )}
                      {result.recommendedProduct.is_prime && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-sm font-medium rounded-full border border-blue-200">
                          Prime
                        </span>
                      )}
                    </div>
                    
                    {/* Source Query Badge */}
                    {(result.recommendedProduct as any).sourceQuery && (
                      <div>
                        <span className="px-2 py-1 bg-indigo-100 text-indigo-800 text-xs font-medium rounded-full border border-indigo-200">
                          🔍 From: {(result.recommendedProduct as any).sourceQuery} (Level {(result.recommendedProduct as any).sourceLevel})
                        </span>
                      </div>
                    )}
                    
                    <div className="flex items-center gap-4">
                      {result.recommendedProduct.rating && (
                        <div className="flex items-center gap-1">
                          {getRatingStars(result.recommendedProduct.rating)}
                          {result.recommendedProduct.reviews && (
                            <span className="text-sm text-gray-600">
                              ({result.recommendedProduct.reviews.toLocaleString()} reviews)
                            </span>
                          )}
                        </div>
                      )}
                      
                      {result.recommendedProduct.extracted_price && (
                        <div className="flex items-center gap-2">
                          <span className="text-2xl font-bold text-green-600">
                            {formatPrice(result.recommendedProduct.extracted_price)}
                          </span>
                          {result.recommendedProduct.extracted_original_price && 
                           result.recommendedProduct.extracted_original_price > result.recommendedProduct.extracted_price && (
                            <span className="text-lg text-gray-500 line-through">
                              {formatPrice(result.recommendedProduct.extracted_original_price)}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Recommend Evaluation */}
                    <div className="bg-white rounded-lg p-3 border">
                      <div className="flex items-center gap-2 mb-2">
                        <TrendingUp className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-gray-700">
                          Recommend Score: {result.recommendedProduct.evaluation.score}/100
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {result.recommendedProduct.evaluation.reasons.map((reason: string, idx: number) => (
                          <span
                            key={idx}
                            className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full"
                          >
                            {reason}
                          </span>
                        ))}
                      </div>
                    </div>



                    {/* Action Button */}
                    <Button
                      onClick={() => window.open(result.recommendedProduct!.link, '_blank')}
                      className="w-full mt-4 bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      View Product
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
            );
          })()
        )}



        </>
      )} {/* End of !isBlockedSearch conditional */}
      </div>
    </>
  );
}

// Tool UI wrapper for the assistant
type ProductSearchArgs = {
  query: string;
};

type ProductSearchToolResult = {
  type: "product_search";
  result: ProductSearchResult;
  ui: {
    type: "product_search";
    title: string;
    description: string;
  };
};

export const ProductSearchToolUI = makeAssistantToolUI<
  ProductSearchArgs,
  ProductSearchToolResult
>({
  toolName: "intelligent_product_search",
  render: ({ args, result, status }: { args: ProductSearchArgs; result?: ProductSearchToolResult; status: any }) => {
    console.log('🎯 ProductSearchToolUI render called:', { 
      statusType: status?.type, 
      hasResult: !!result, 
      query: args?.query,
      timestamp: new Date().toISOString(),
      fullStatus: status
    });
    
    // No need for forced loading here since we have global loading overlay
    console.log('🔄 ProductSearchToolUI: Global loading overlay will handle the loading state');

    if (!result) {
      console.error('🚨 ProductSearchToolUI: result is null or undefined');
      return null;
    }

    console.log('✅ ProductSearchToolUI: result received:', result);
    console.log('🔍 Result type:', typeof result);
    console.log('🔍 Result keys:', Object.keys(result || {}));
    console.log('🔍 Has result.result:', !!result.result);
    console.log('🔍 Has result.originalQuery:', !!(result as any).originalQuery);
    console.log('🔍 result.result type:', typeof result.result);
    console.log('🔍 result.result keys:', Object.keys(result.result || {}));
    
    // Check if this is an error response from the backend
    if ((result as any).type === 'error') {
      console.error('🚨 ProductSearchToolUI: Backend returned error:', result);
      const errorMessage = result.ui?.description || 'Product search failed';
      return (
        <div className="p-6 bg-red-50 border border-red-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
              <span className="text-white text-xs">!</span>
            </div>
            <h3 className="text-red-700 font-semibold">Product Search Failed</h3>
          </div>
          <p className="text-red-600 text-sm">{errorMessage}</p>
          <p className="text-red-500 text-xs mt-2">Please try searching again in a few moments.</p>
        </div>
      );
    }

    // The assistant-ui library passes the tool return object as result
    // Backend returns: { type: "product_search", result: ProductSearchResult, ui: {...} }
    // So the actual ProductSearchResult is in result.result
    let productSearchResult: any;
    
    if (result.result && typeof result.result === 'object') {
      // New structure: result contains the tool return object
      productSearchResult = result.result;
      console.log('🔍 Using result.result structure');
    } else if ((result as any).originalQuery) {
      // Old structure: result IS the ProductSearchResult 
      productSearchResult = result;
      console.log('🔍 Using direct result structure');
    } else {
      console.error('🚨 ProductSearchToolUI: Cannot find ProductSearchResult in result structure');
      console.error('🔍 Full result object received:', JSON.stringify(result, null, 2));
      return <div className="p-4 text-red-600">Error: No search results data found</div>;
    }

    return <ProductSearchDisplay result={productSearchResult} />;
  },
}); 