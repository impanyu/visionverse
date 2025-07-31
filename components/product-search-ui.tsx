"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Star, TrendingUp, RefreshCw, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { AmazonProduct } from "@/lib/amazon-search";
import { makeAssistantToolUI, ThreadPrimitive } from "@assistant-ui/react";

export interface SearchStep {
  keywords: string;
  amazonResults: number;
  googleShoppingResults?: number;
  localResults: number;
  refinementReason?: string;
  stepType?: 'intent' | 'search' | 'refinement';
  priceRange?: {
    min?: number;
    max?: number;
  };
  // Add iteration-specific data for refresh functionality
  iterationProducts?: any[]; // Products found in this specific iteration
  allProductsUpToHere?: any[]; // Accumulated products up to this iteration
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
    source: 'amazon' | 'local' | 'google_shopping';
  };
  // New field for TikTok-style product browsing
  recommendedProducts?: Array<any & {
    evaluation: {
      score: number;
      reasons: string[];
      isRecommended: boolean;
    };
    source: 'amazon' | 'local' | 'google_shopping';
  }>;
  searchSummary: string;
  // Add session data for refresh functionality
  sessionId?: string;
  allAccumulatedProducts?: any[]; // All products from all iterations
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
    source: 'amazon' | 'local' | 'google_shopping';
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
      {/* Product Counter and Navigation */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-600">
            Product {currentIndex + 1} of {products.length}
          </span>
                    <span className="text-xs text-gray-500">
            Hover to scroll ↕ or use arrow keys
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={goToPrevious}
            className="p-1"
          >
            <ChevronUp className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={goToNext}
            className="p-1"
          >
            <ChevronDown className="w-4 h-4" />
          </Button>
        </div>
      </div>

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
                    : currentProduct.source === 'google_shopping'
                    ? '🛍️ Google Shopping'
                    : '🏪 Local Store'}
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
  
  const [result, setResult] = useState(initialResult);
  const [refreshingProduct, setRefreshingProduct] = useState(false);
  const [searchStepsExpanded, setSearchStepsExpanded] = useState(false);
  const [refreshingSearch, setRefreshingSearch] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // Force re-render key
  
  // Update result when initialResult changes (for normal searches, not refresh)
  useEffect(() => {
    console.log('🔄 ProductSearchDisplay: initialResult changed, updating state');
    console.log('🔄 ProductSearchDisplay: New initialResult:', initialResult);
    setResult(initialResult);
  }, [initialResult, refreshingSearch]); // Keep same dependency array size

  // DEBUG: Watch for changes in the result state to track re-renders
  useEffect(() => {
    console.log(`🔄 ProductSearchDisplay: ===== RESULT STATE CHANGED =====`);
    console.log(`🔄 ProductSearchDisplay: Current result keys:`, Object.keys(result));
    console.log(`🔄 ProductSearchDisplay: Current search steps count:`, result.searchSteps?.length);
    if (result.searchSteps && result.searchSteps.length > 0) {
      console.log(`🔄 ProductSearchDisplay: First step keywords:`, result.searchSteps[0]?.keywords);
      console.log(`🔄 ProductSearchDisplay: First step price range:`, result.searchSteps[0]?.priceRange);
    }
    console.log(`🔄 ProductSearchDisplay: Current product:`, result.recommendedProduct?.title);
    console.log(`🔄 ProductSearchDisplay: Current refreshKey:`, refreshKey);
    console.log(`🔄 ProductSearchDisplay: ===============================`);
  }, [result, refreshKey]);
  
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
    try {
      console.log(`🔄 Refreshing recommended product`);
      
      setRefreshingProduct(true);

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
    }
  };

  // Handle filtering of existing search results based on price range
  const handleRefreshSearch = async () => {
    if (refreshingSearch || !result?.allAccumulatedProducts) return;
    
    setRefreshingSearch(true);
    console.log('🔄 Frontend: Filtering current results with price range:', selectedPriceRange);
    
    try {
      // Filter existing products based on price range
      const filteredProducts = result.allAccumulatedProducts.filter(product => {
        const price = product.extracted_price || product.price_value || 0;
        return price >= selectedPriceRange.min && price <= selectedPriceRange.max;
      });
      
      console.log(`🔄 Frontend: Filtered ${result.allAccumulatedProducts.length} products to ${filteredProducts.length} within price range $${selectedPriceRange.min}-$${selectedPriceRange.max}`);
      
      // Sort by score and take top 10
      const sortedProducts = filteredProducts
        .sort((a, b) => (b.score || 0) - (a.score || 0))
        .slice(0, 10);
      
      console.log(`🔄 Frontend: Selected top ${sortedProducts.length} products by score`);
      
      // Create updated result with filtered products
      const updatedResult: ProductSearchResult = {
        ...result,
        recommendedProducts: sortedProducts,
        searchSummary: sortedProducts.length > 0 
          ? `Found ${sortedProducts.length} products within your price range of $${selectedPriceRange.min}-$${selectedPriceRange.max}. ${sortedProducts.length > 1 ? 'Swipe to browse them all!' : ''}`
          : `No products found within your price range of $${selectedPriceRange.min}-$${selectedPriceRange.max}. Try adjusting the price range.`,
        // Keep the same search steps and original query
        searchSteps: result.searchSteps,
        originalQuery: result.originalQuery,
        allAccumulatedProducts: result.allAccumulatedProducts,
        sessionId: result.sessionId
      };
      
      // Multi-step forced re-render strategy
      console.log('🔄 Frontend: Step 1 - Clearing result state');
      setResult({
        originalQuery: '',
        searchSteps: [],
        recommendedProduct: null,
        recommendedProducts: [],
        searchSummary: '',
        allAccumulatedProducts: [],
        sessionId: ''
      });
      
      console.log('🔄 Frontend: Step 2 - Incrementing refresh key');
      setRefreshKey(prev => prev + 1);
      
      // Small delay to allow state clearing
      setTimeout(() => {
        console.log('🔄 Frontend: Step 3 - Setting filtered result');
        setResult(updatedResult);
        
        console.log('🔄 Frontend: Step 4 - Final refresh key increment');
        setRefreshKey(prev => prev + 1);
      }, 10);
      
    } catch (error) {
      console.error('🔄 Frontend: ❌ Error during filtering:', error);
    } finally {
      setRefreshingSearch(false);
    }
  };

  return (
    <>

      
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
      {/* Original Query Box */}
      <Card className="border border-gray-200 bg-gray-50/50 shadow-sm hover:shadow-md transition-shadow duration-200">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 bg-gray-400 rounded-full"></div>
              <span className="font-medium text-gray-800">Search Query</span>
            </div>
            <div className="flex items-center gap-3">
              {/* Refresh Search Button */}
              <button
                onClick={handleRefreshSearch}
                disabled={refreshingSearch}
                className={`p-2 rounded-full bg-blue-100 hover:bg-blue-200 transition-colors text-blue-600 hover:text-blue-700 ${
                  refreshingSearch ? 'animate-spin' : ''
                }`}
                title="Refresh search with current price range"
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
          <p className="mt-2 text-gray-700 font-medium">"{result.originalQuery}"</p>
          
          {/* Price Range Slider */}
          <div className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-700">Price Range Filter</span>
              <span className="text-sm text-gray-600 font-mono">
                ${selectedPriceRange.min} - ${selectedPriceRange.max}
              </span>
            </div>
            
            {/* Dual Range Slider */}
            <div className="relative">
              {/* Price labels */}
              <div className="flex justify-between text-xs text-gray-500 mb-2">
                <span>${priceRange.min}</span>
                <span>${priceRange.max}</span>
              </div>
              
              {/* Slider container */}
              <div 
                className="relative h-8 flex items-center"
                onMouseDown={handleSliderMouseDown}
                onMouseLeave={() => {
                  // Reset active slider when mouse leaves the container
                  setTimeout(() => setActiveSlider(null), 100);
                }}
              >
                {/* Background track */}
                <div className="absolute w-full h-4 bg-gray-200 rounded-lg"></div>
                
                {/* Highlighted range */}
                <div 
                  className="absolute h-4 bg-blue-500 rounded-lg"
                  style={{
                    left: `${((selectedPriceRange.min - priceRange.min) / (priceRange.max - priceRange.min)) * 100}%`,
                    width: `${((selectedPriceRange.max - selectedPriceRange.min) / (priceRange.max - priceRange.min)) * 100}%`
                  }}
                ></div>
                
                {/* Min range input */}
                <input
                  ref={minSliderRef}
                  type="range"
                  min={priceRange.min}
                  max={priceRange.max}
                  value={selectedPriceRange.min}
                  onChange={(e) => {
                    const newMin = Number(e.target.value);
                    if (newMin <= selectedPriceRange.max) {
                      setSelectedPriceRange(prev => ({ ...prev, min: newMin }));
                    }
                  }}
                  onFocus={() => {
                    setActiveSlider('min');
                    setMinSliderZIndex(20);
                    setMaxSliderZIndex(9);
                  }}
                  onMouseDown={(e) => {
                    setActiveSlider('min');
                    setMinSliderZIndex(20);
                    setMaxSliderZIndex(9);
                  }}
                  onMouseUp={() => {
                    console.log('🖱️ Min slider mouse up');
                    setTimeout(() => setActiveSlider(null), 100);
                  }}
                  className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer dual-range-slider"
                  style={{ 
                    zIndex: minSliderZIndex,
                    pointerEvents: 'auto'
                  }}
                />
                
                {/* Max range input */}
                <input
                  ref={maxSliderRef}
                  type="range"
                  min={priceRange.min}
                  max={priceRange.max}
                  value={selectedPriceRange.max}
                  onChange={(e) => {
                    const newMax = Number(e.target.value);
                    if (newMax >= selectedPriceRange.min) {
                      setSelectedPriceRange(prev => ({ ...prev, max: newMax }));
                    }
                  }}
                  onFocus={() => {
                    setActiveSlider('max');
                    setMaxSliderZIndex(20);
                    setMinSliderZIndex(10);
                  }}
                  onMouseDown={(e) => {
                    setActiveSlider('max');
                    setMaxSliderZIndex(20);
                    setMinSliderZIndex(10);
                  }}
                  onMouseUp={() => {
                    console.log('🖱️ Max slider mouse up');
                    setTimeout(() => setActiveSlider(null), 100);
                  }}
                  className="absolute w-full h-2 bg-transparent appearance-none cursor-pointer dual-range-slider"
                  style={{ 
                    zIndex: maxSliderZIndex,
                    pointerEvents: 'auto'
                  }}
                />
              </div>
            </div>
            
            {refreshingSearch && (
              <div className="flex items-center justify-center gap-2 py-2">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                <span className="text-sm text-gray-600">Searching with new price range...</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
      
      {/* Search Steps Flow - Only show when expanded */}
            {searchStepsExpanded && (
        <div className="space-y-4 animate-in slide-in-from-top-2 duration-300" key={`search-steps-${refreshKey}-${Date.now()}`}>
          {result.searchSteps.filter(step => step.stepType !== 'intent').map((step, index) => {
            console.log(`🔍 Rendering search step ${index + 1}:`, step);
            console.log(`🔍 Step ${index + 1} price range:`, step.priceRange);
            return (
              <div key={`step-${index}-${refreshKey}-${Date.now()}-${step.keywords?.slice(0,10)}`}>
              {/* Step Box */}
              <Card className={`border ${
                step.stepType === 'refinement'
                  ? 'border-orange-200 bg-orange-50/50'
                  : 'border-blue-200 bg-blue-50/50'
              } shadow-sm hover:shadow-md transition-shadow duration-200`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-3 h-3 rounded-full ${
                      step.stepType === 'refinement'
                        ? 'bg-orange-400'
                        : 'bg-blue-400'
                    }`}></div>
                    <span className={`font-medium ${
                      step.stepType === 'refinement'
                        ? 'text-orange-700'
                        : 'text-blue-700'
                    }`}>
                      {`🔍 Search ${index + 1}`}
                    </span>
                  </div>
                  <p className={`font-medium mb-2 ${
                    step.stepType === 'refinement'
                      ? 'text-orange-600'
                      : 'text-blue-600'
                  }`}>
                    {step.keywords}
                  </p>
                  {step.refinementReason && (
                    <p className={`text-sm mb-2 ${
                      step.stepType === 'refinement'
                        ? 'text-orange-500'
                        : 'text-blue-500'
                    }`}>
                      💡 {step.refinementReason}
                    </p>
                  )}
                  {(step.amazonResults > 0 || step.localResults > 0 || step.googleShoppingResults && step.googleShoppingResults > 0) && (
                    <div className={`flex gap-4 text-sm ${
                      step.stepType === 'refinement'
                        ? 'text-orange-500'
                        : 'text-blue-500'
                    }`}>
                      <span>🛒 Amazon: {step.amazonResults} results</span>
                      {step.googleShoppingResults !== undefined && <span>🛍️ Google Shopping: {step.googleShoppingResults} results</span>}
                      <span>🏪 Local: {step.localResults} results</span>
                    </div>
                  )}
                  {step.priceRange && (
                    <div className={`text-sm ${
                      step.stepType === 'refinement'
                        ? 'text-orange-500'
                        : 'text-blue-500'
                    }`}>
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

              {/* TikTok-Style Product Browser */}
        {(result.recommendedProducts && result.recommendedProducts.length > 0) ? (
          <TikTokProductBrowser products={result.recommendedProducts} />
        ) : result.recommendedProduct && (
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
                  <RefreshCw className="h-4 w-4" />
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

                    {/* Source Badge */}
                    <div className="flex items-center gap-2">
                      <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                        result.recommendedProduct.source === 'amazon' 
                          ? 'bg-orange-100 text-orange-800' 
                          : result.recommendedProduct.source === 'google_shopping'
                          ? 'bg-blue-100 text-blue-800'
                          : 'bg-purple-100 text-purple-800'
                      }`}>
                        {result.recommendedProduct.source === 'amazon' 
                          ? '🛒 Amazon' 
                          : result.recommendedProduct.source === 'google_shopping'
                          ? '🛍️ Google Shopping'
                          : '🏪 Local Store'}
                      </span>
                      {result.recommendedProduct.is_prime && (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded-full">
                          Prime
                        </span>
                      )}
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
        )}



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
    if (status.type === "running") {
      return (
        <div className="flex flex-col items-center justify-center p-12 space-y-4">
                        <div className="flex items-center gap-3">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <span className="text-lg font-medium text-gray-700">Searching for the most suitable product</span>
              </div>
          <div className="text-center space-y-2">
            <p className="text-gray-600">🔍 Searching Amazon marketplace</p>
            <p className="text-gray-600">🛒 Searching Google Shopping</p>
            <p className="text-gray-600">🏪 Checking local products</p>
            <p className="text-gray-600">🤖 Evaluating product quality</p>
          </div>
        </div>
      );
    }

    if (!result) {
      console.error('🚨 ProductSearchToolUI: result is null or undefined');
      return null;
    }

    console.log('✅ ProductSearchToolUI: result received:', result);
    
    if (!result.result) {
      console.error('🚨 ProductSearchToolUI: result.result is null or undefined');
      return <div className="p-4 text-red-600">Error: No search results data found</div>;
    }

    return <ProductSearchDisplay result={result.result} />;
  },
}); 