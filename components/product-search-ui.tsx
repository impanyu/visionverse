"use client";

import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Search, ArrowDown, ExternalLink, Star, Package, TrendingUp, ShoppingCart, CheckCircle } from "lucide-react";
import { AmazonProduct } from "@/lib/amazon-search";
import { makeAssistantToolUI } from "@assistant-ui/react";

export interface SearchStep {
  keywords: string;
  amazonResults: number;
  localResults: number;
  refinementReason?: string;
}

export interface ProductSearchResult {
  originalQuery: string;
  searchSteps: SearchStep[];
  recommendedProduct?: AmazonProduct & {
    evaluation: {
      score: number;
      reasons: string[];
      isRecommended: boolean;
    };
    source: 'amazon' | 'local';
  };
  alternativeProducts?: Array<AmazonProduct & {
    evaluation: {
      score: number;
      reasons: string[];
      isRecommended: boolean;
    };
    source: 'amazon' | 'local';
  }>;
  searchSummary: string;
}

interface ProductSearchDisplayProps {
  result: ProductSearchResult;
}

export function ProductSearchDisplay({ result }: ProductSearchDisplayProps) {
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
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Product Search Results</h2>
        <p className="text-gray-600">Searching for: "{result.originalQuery}"</p>
      </div>

      {/* Search Flow */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
          <Search className="h-5 w-5" />
          Search Flow
        </h3>
        
        <div className="relative">
          {result.searchSteps.map((step, index) => (
            <div key={index} className="relative">
              {/* Search Step Box */}
              <Card className="border-2 border-blue-200 bg-blue-50">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <Search className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-blue-800">
                          Search {index + 1}: "{step.keywords}"
                        </span>
                      </div>
                      {step.refinementReason && (
                        <p className="text-sm text-blue-700 mb-2">
                          💡 {step.refinementReason}
                        </p>
                      )}
                      <div className="flex gap-4 text-sm text-blue-600">
                        <span>🛒 Amazon: {step.amazonResults} results</span>
                        <span>🏪 Local: {step.localResults} results</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Arrow connector */}
              {index < result.searchSteps.length - 1 && (
                <div className="flex justify-center py-3">
                  <ArrowDown className="h-6 w-6 text-blue-400" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Recommended Product */}
      {result.recommendedProduct && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-600" />
            Recommended Product
          </h3>
          
          <Card className="border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50">
            <CardContent className="p-6">
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

                  {/* Quality Evaluation */}
                  <div className="bg-white rounded-lg p-3 border">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="h-4 w-4 text-blue-600" />
                      <span className="font-medium text-gray-700">
                        Quality Score: {result.recommendedProduct.evaluation.score}/100
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {result.recommendedProduct.evaluation.reasons.map((reason, idx) => (
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
                        : 'bg-purple-100 text-purple-800'
                    }`}>
                      {result.recommendedProduct.source === 'amazon' ? '🛒 Amazon' : '🏪 Local Store'}
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
            </CardContent>
          </Card>
        </div>
      )}

      {/* Search Summary */}
      <div className="bg-gray-50 rounded-lg p-4">
        <h4 className="font-medium text-gray-700 mb-2">Search Summary</h4>
        <p className="text-gray-600 text-sm">{result.searchSummary}</p>
      </div>

      {/* Alternative Products */}
      {result.alternativeProducts && result.alternativeProducts.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-gray-700 flex items-center gap-2">
            <Package className="h-5 w-5" />
            Alternative Options
          </h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {result.alternativeProducts.slice(0, 4).map((product, index) => (
              <Card key={product.asin || index} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex gap-3">
                    {product.thumbnail && (
                      <img
                        src={product.thumbnail}
                        alt={product.title}
                        className="w-16 h-16 object-cover rounded"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <h5 className="font-medium text-gray-800 text-sm line-clamp-2 mb-1">
                        {product.title}
                      </h5>
                      <div className="flex items-center gap-2 mb-2">
                        {product.rating && getRatingStars(product.rating)}
                        {product.extracted_price && (
                          <span className="text-sm font-medium text-green-600">
                            {formatPrice(product.extracted_price)}
                          </span>
                        )}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(product.link, '_blank')}
                        className="w-full"
                      >
                        <ExternalLink className="h-3 w-3 mr-1" />
                        View
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
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
            <span className="text-lg font-medium text-gray-700">Searching for products...</span>
          </div>
          <div className="text-center space-y-2">
            <p className="text-gray-600">🔍 Searching Amazon marketplace</p>
            <p className="text-gray-600">🏪 Checking local products</p>
            <p className="text-gray-600">🤖 Evaluating product quality</p>
          </div>
        </div>
      );
    }

    if (!result) {
      return null;
    }

    return <ProductSearchDisplay result={result.result} />;
  },
}); 