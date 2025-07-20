"use client";

import React, { useState, useEffect } from 'react';
import { Product } from '@/types/product';
import { CreateProductResponse } from '@/types/product';
import { makeAssistantToolUI, useAssistantRuntime, ThreadPrimitive } from "@assistant-ui/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X, Package, AlertCircle, FileText, Hash, User, Eye, Image, CheckCircle, Globe, ExternalLink } from "lucide-react";

// Product Form UI Component - for showing the form when user types "create product"
type ProductFormArgs = {
  message: string;
};

type ProductFormResult = {
  type: "product_creation_ui";
  message: string;
  ui_components: {
    title: string;
    description: string;
    form_fields: Array<{
      type: string;
      name: string;
      label: string;
      placeholder?: string;
      required: boolean;
      rows?: number;
      accept?: string;
    }>;
    submit_button: {
      text: string;
      endpoint: string;
    };
  };
};

export const ProductFormToolUI = makeAssistantToolUI<
  ProductFormArgs,
  ProductFormResult
>({
  toolName: "create_product_form",
  render: ({ args, result, status }: { args: ProductFormArgs; result?: ProductFormResult; status: any }) => {
    const [formData, setFormData] = useState({
      productDescription: "",
      imageFile: null as File | null,
      url: "" as string,
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitResult, setSubmitResult] = useState<(CreateProductResponse & { products?: Product[] }) | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hasSubmitted, setHasSubmitted] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      
      // Prevent double submission
      if (isSubmitting || hasSubmitted) {
        return;
      }
      
      setIsSubmitting(true);
      setHasSubmitted(true);
      setError(null);

      if (!formData.productDescription.trim()) {
        setError("Product description is required");
        setIsSubmitting(false);
        return;
      }

      if (!formData.url.trim()) {
        setError("Product URL is required");
        setIsSubmitting(false);
        return;
      }

      try {
        setIsSubmitting(true);
        setError("");

        // Create FormData for file upload
        const formDataToSend = new FormData();
        formDataToSend.append("productDescription", formData.productDescription);
        formDataToSend.append("url", formData.url.trim());
        
        if (formData.imageFile) {
          formDataToSend.append("imageFile", formData.imageFile);
        }

        const response = await fetch("/api/create_product", {
          method: "POST",
          credentials: "include",
          body: formDataToSend,
        });

        if (response.ok) {
          const result: CreateProductResponse = await response.json();
          
          // Fetch updated product list
          try {
            const productListResponse = await fetch("/api/create_product", {
              method: "GET",
              credentials: "include",
            });
            
            if (productListResponse.ok) {
              const productListData = await productListResponse.json();
              
              // Set the result to include the product list
              setSubmitResult({
                ...result,
                products: productListData.products || [],
              });
            } else {
              // If product list fetch fails, just show the success message
              setSubmitResult(result);
            }
          } catch (listError) {
            console.error("Error fetching product list:", listError);
            // If product list fetch fails, just show the success message
            setSubmitResult(result);
          }
        } else {
          const errorText = await response.text();
          setError(`Failed to create product: ${errorText}`);
        }
      } catch (err) {
        setError(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
      } finally {
        setIsSubmitting(false);
      }
    };

    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading Product Form...
            </CardTitle>
          </CardHeader>
        </Card>
      );
    }

    // Helper functions
    const isImageFile = (filePath: string) => {
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const ext = filePath.toLowerCase().split('.').pop();
      return ext && imageExtensions.includes(`.${ext}`);
    };

    const getFileUrl = (filePath: string) => {
      if (!filePath || filePath === "/no-file" || filePath.trim() === "") return null;
      const relativePath = filePath.replace('/data/', '');
      return `/api/files/${relativePath}`;
    };

    if (submitResult) {
      const fileUrl = getFileUrl(submitResult.product.filePath);
      const isImage = submitResult.product.filePath !== "/no-file" && isImageFile(submitResult.product.filePath);
      const products = submitResult.products || [];

      return (
        <div className="p-6 bg-white rounded-lg shadow-lg max-w-4xl mx-auto">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 bg-gradient-to-r from-emerald-400 to-green-500 rounded-full shadow-sm"></div>
              <h2 className="text-xl font-bold text-gray-800">Product Created Successfully!</h2>
            </div>
            
            {/* Created Product Display */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-green-800 mb-2">New Product:</h3>
              <p className="text-gray-700 mb-2">{submitResult.product.productDescription}</p>
              
              {submitResult.product.url && submitResult.product.url.trim() && (
                <p className="text-sm text-gray-600 mb-2">
                  URL: <a href={submitResult.product.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{submitResult.product.url}</a>
                </p>
              )}
              
              {isImage && fileUrl && (
                <div className="mt-2">
                  <img 
                    src={fileUrl} 
                    alt="Product" 
                    className="max-w-xs h-auto rounded-lg shadow-sm"
                  />
                </div>
              )}
              
              {/* Vision Linking Display */}
              {submitResult.linkedVision && (
                <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <ThreadPrimitive.Suggestion
                    prompt={`show vision ${submitResult.linkedVision.id}`}
                    method="replace"
                    autoSend={true}
                    className="font-semibold text-blue-800 hover:text-blue-900 cursor-pointer underline mb-1 block"
                  >
                    🔗 Linked to Vision:
                  </ThreadPrimitive.Suggestion>
                  <p className="text-sm text-blue-700 mb-1">{submitResult.linkedVision.visionDescription}</p>
                  <p className="text-xs text-blue-600">
                    Similarity: {(submitResult.linkedVision.similarityScore * 100).toFixed(1)}%
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Products List */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              All My Products ({products.length})
            </h3>
            
            {products.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No products found.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {products.map((product: Product) => (
                  <ExpandableProductCard 
                    key={product.id} 
                    product={product}
                    isNewlyCreated={product.id === submitResult.product.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex gap-3">
            <ThreadPrimitive.Suggestion
              prompt="Create a new product"
              method="replace"
              autoSend={true}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Create Another Product
            </ThreadPrimitive.Suggestion>
            
            <ThreadPrimitive.Suggestion
              prompt="list my products"
              method="replace"
              autoSend={true}
              className="px-4 py-2 bg-gradient-to-r from-slate-500 to-slate-600 text-white rounded-lg hover:from-slate-600 hover:to-slate-700 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Refresh List
            </ThreadPrimitive.Suggestion>
          </div>
        </div>
      );
    }

    if (result) {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="w-5 h-5" />
              {result.ui_components.title}
            </CardTitle>
            <CardDescription>
              Describe your product and optionally upload supporting files. You can also specify a price if you want to sell your product.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="productDescription" className="text-sm font-medium">
                  Product Description
                </label>
                <textarea
                  id="productDescription"
                  value={formData.productDescription}
                  onChange={(e) => setFormData(prev => ({ ...prev, productDescription: e.target.value }))}
                  placeholder="Describe your product in detail..."
                  className="w-full p-3 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={4}
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="url" className="text-sm font-medium text-gray-700">
                  Product URL *
                </label>
                <input
                  type="url"
                  id="url"
                  name="url"
                  value={formData.url}
                  onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="https://example.com/product-page"
                  required
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="imageFile" className="text-sm font-medium">
                  Product Image (Optional)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    id="imageFile"
                    type="file"
                    onChange={(e) => setFormData(prev => ({ ...prev, imageFile: e.target.files?.[0] || null }))}
                    accept="image/*"
                    className="hidden"
                  />
                  <label
                    htmlFor="imageFile"
                    className="flex items-center gap-2 px-3 py-2 border border-dashed rounded-md cursor-pointer hover:bg-gray-50"
                  >
                    <Upload className="h-4 w-4" />
                    {formData.imageFile ? formData.imageFile.name : "Choose image"}
                  </label>
                  {formData.imageFile && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setFormData(prev => ({ ...prev, imageFile: null }))}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-700 text-sm">{error}</p>
                </div>
              )}

              <Button
                type="submit"
                disabled={isSubmitting || !formData.productDescription.trim() || !formData.url.trim()}
                className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white py-2 px-4 rounded-md hover:from-indigo-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Product...
                  </>
                ) : (
                  "Create Product"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      );
    }

    return null;
  },
});

// Type definitions for product creation
type CreateProductFormArgs = {
  productDescription: string;
  filePath?: string;
  price?: number;
};

type CreateProductFormResult = {
  type: "product_creation_ui";
  message: string;
};

function ProductCreationToolUIComponent({ args }: { args: CreateProductFormArgs }) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<CreateProductResponse | null>(null);

  const [formData, setFormData] = useState({
    productDescription: args.productDescription || '',
    url: '', // URL is now required
    imageFile: null as File | null,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.productDescription.trim()) {
      setError("Product description is required");
      return;
    }

    if (!formData.url.trim()) {
      setError("Product URL is required");
      return;
    }

    try {
      setIsSubmitting(true);
      setError("");

      // Create FormData for file upload
      const formDataToSend = new FormData();
      formDataToSend.append("productDescription", formData.productDescription);
      formDataToSend.append("url", formData.url.trim());
      
      if (formData.imageFile) {
        formDataToSend.append("imageFile", formData.imageFile);
      }

      const response = await fetch('/api/create_product', {
        method: 'POST',
        body: formDataToSend,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText);
      }

      const result: CreateProductResponse = await response.json();
      setSubmitResult(result);
      
      // Fetch updated product list
      const listResponse = await fetch('/api/create_product?limit=20');
      if (listResponse.ok) {
        const listResult = await listResponse.json();
        setSubmitResult(prev => prev ? {...prev, products: listResult.products} : null);
      }
      
    } catch (err) {
      console.error('Error creating product:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setIsSubmitting(false);
      setHasSubmitted(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setFormData(prev => ({ ...prev, imageFile: file }));
  };

  // Helper functions
  const isImageFile = (filePath: string) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = filePath.toLowerCase().split('.').pop();
    return ext && imageExtensions.includes(`.${ext}`);
  };

  const getFileUrl = (filePath: string) => {
    if (!filePath || filePath === "/no-file" || filePath.trim() === "") return null;
    const relativePath = filePath.replace('/data/', '');
    return `/api/files/${relativePath}`;
  };

  if (submitResult) {
    const fileUrl = getFileUrl(submitResult.product.filePath);
    const isImage = submitResult.product.filePath !== "/no-file" && isImageFile(submitResult.product.filePath);

    const products = (submitResult as any).products || [];

    return (
      <div className="p-6 bg-white rounded-lg shadow-lg max-w-4xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-3 bg-gradient-to-r from-emerald-400 to-green-500 rounded-full shadow-sm"></div>
            <h2 className="text-xl font-bold text-gray-800">Product Created Successfully!</h2>
          </div>
          
          {/* Created Product Display */}
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <h3 className="font-semibold text-green-800 mb-2">New Product:</h3>
            <p className="text-gray-700 mb-2">{submitResult.product.productDescription}</p>
            
            {submitResult.product.url && submitResult.product.url.trim() && (
              <p className="text-sm text-gray-600 mb-2">
                URL: <a href={submitResult.product.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{submitResult.product.url}</a>
              </p>
            )}
            
            {isImage && fileUrl && (
              <div className="mt-2">
                <img 
                  src={fileUrl} 
                  alt="Product" 
                  className="max-w-xs h-auto rounded-lg shadow-sm"
                />
              </div>
            )}
            
            {/* Vision Linking Display */}
            {submitResult.linkedVision && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <ThreadPrimitive.Suggestion
                  prompt={`show vision ${submitResult.linkedVision.id}`}
                  method="replace"
                  autoSend={true}
                  className="font-semibold text-blue-800 hover:text-blue-900 cursor-pointer underline mb-1 block"
                >
                  🔗 Linked to Vision:
                </ThreadPrimitive.Suggestion>
                <p className="text-sm text-blue-700 mb-1">{submitResult.linkedVision.visionDescription}</p>
                <p className="text-xs text-blue-600">
                  Similarity: {(submitResult.linkedVision.similarityScore * 100).toFixed(1)}%
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Products List */}
        <div>
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            All My Products ({products.length})
          </h3>
          
          {products.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No products found.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {products.map((product: Product) => (
                <ExpandableProductCard 
                  key={product.id} 
                  product={product}
                />
              ))}
            </div>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 flex gap-3">
          <ThreadPrimitive.Suggestion
            prompt="Create a new product"
            method="replace"
            autoSend={true}
            className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
          >
            Create Another Product
          </ThreadPrimitive.Suggestion>
          
          <ThreadPrimitive.Suggestion
            prompt="list my products"
            method="replace"
            autoSend={true}
            className="px-4 py-2 bg-gradient-to-r from-slate-500 to-slate-600 text-white rounded-lg hover:from-slate-600 hover:to-slate-700 transition-all duration-200 shadow-md hover:shadow-lg"
          >
            Refresh List
          </ThreadPrimitive.Suggestion>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Create New Product</h2>
        <p className="text-gray-600">Fill in the details to create your product</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Product Description */}
        <div>
          <label htmlFor="productDescription" className="block text-sm font-medium text-gray-700 mb-2">
            Product Description *
          </label>
          <textarea
            id="productDescription"
            name="productDescription"
            value={formData.productDescription}
            onChange={handleInputChange}
            required
            rows={4}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Describe your product..."
          />
        </div>

        {/* URL */}
        <div>
          <label htmlFor="url" className="block text-sm font-medium text-gray-700 mb-2">
            Product URL *
          </label>
          <input
            type="url"
            id="url"
            name="url"
            value={formData.url}
            onChange={handleInputChange}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="https://example.com/product-page"
            required
          />
        </div>

        {/* Image Upload */}
        <div>
          <label htmlFor="imageFile" className="block text-sm font-medium text-gray-700 mb-2">
            Product Image
          </label>
          <input
            type="file"
            id="imageFile"
            onChange={handleFileChange}
            accept="image/*"
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {formData.imageFile && (
            <p className="text-sm text-gray-600 mt-1">
              Selected: {formData.imageFile.name}
            </p>
          )}
        </div>

        {/* Error Display */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting || !formData.productDescription.trim() || !formData.url.trim()}
          className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white py-2 px-4 rounded-md hover:from-indigo-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg"
        >
          {isSubmitting ? 'Creating Product...' : 'Create Product'}
        </button>
      </form>
    </div>
  );
}

export const ProductCreationToolUI = makeAssistantToolUI<
  CreateProductFormArgs,
  CreateProductFormResult
>({
  toolName: "create_product",
  render: ProductCreationToolUIComponent,
});

// Product Created with List UI Component
type ProductCreatedWithListArgs = {
  title: string;
  description: string;
  product: Product;
  linkedVision?: {
    id: string;
    visionDescription: string;
    similarityScore: number;
  };
  products: Product[];
};

type ProductCreatedWithListResult = {
  type: "product_created_with_list";
  product: Product;
  products: Product[];
  success: boolean;
  suppressOutput: true;
  ui: {
    type: "product_created_with_list";
    title: string;
    description: string;
    product: Product;
    products: Product[];
  };
};

function ProductCreatedWithListToolUIComponent({ args }: { args: ProductCreatedWithListArgs }) {
  const { title, description, product, linkedVision, products } = args;

  // Helper functions
  const isImageFile = (filePath: string) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = filePath.toLowerCase().split('.').pop();
    return ext && imageExtensions.includes(`.${ext}`);
  };

  const getFileUrl = (filePath: string) => {
    if (!filePath || filePath === "/no-file" || filePath.trim() === "") return null;
    const relativePath = filePath.replace('/data/', '');
    return `/api/files/${relativePath}`;
  };

  const fileUrl = getFileUrl(product.filePath);
  const isImage = product.filePath !== "/no-file" && isImageFile(product.filePath);

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          <h2 className="text-xl font-bold text-gray-800">{title}</h2>
        </div>
        
        {/* Created Product Display */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <h3 className="font-semibold text-green-800 mb-2">New Product:</h3>
          <p className="text-gray-700 mb-2">{product.productDescription}</p>
          
          {product.url && product.url.trim() && (
            <p className="text-sm text-gray-600 mb-2">
              URL: <a href={product.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{product.url}</a>
            </p>
          )}
          
          {isImage && fileUrl && (
            <div className="mt-2">
              <img 
                src={fileUrl} 
                alt="Product" 
                className="max-w-xs h-auto rounded-lg shadow-sm"
              />
            </div>
          )}
          
          {/* Vision Linking Display */}
          {linkedVision && (
            <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <ThreadPrimitive.Suggestion
                prompt={`show vision ${linkedVision.id}`}
                method="replace"
                autoSend={true}
                className="font-semibold text-blue-800 hover:text-blue-900 cursor-pointer underline mb-1 block"
              >
                🔗 Linked to Vision:
              </ThreadPrimitive.Suggestion>
              <p className="text-sm text-blue-700 mb-1">{linkedVision.visionDescription}</p>
              <p className="text-xs text-blue-600">
                Similarity: {(linkedVision.similarityScore * 100).toFixed(1)}%
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Products List */}
      <div>
        <h3 className="text-lg font-semibold text-gray-800 mb-4">
          All My Products ({products.length})
        </h3>
        
        {products.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No products found.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {products.map((prod: Product) => (
              <ExpandableProductCard 
                key={prod.id} 
                product={prod}
                isNewlyCreated={prod.id === product.id}
              />
            ))}
          </div>
        )}
      </div>

      {/* Action Buttons */}
      <div className="mt-6 flex gap-3">
        <ThreadPrimitive.Suggestion
          prompt="Create a new product"
          method="replace"
          autoSend={true}
          className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
        >
          Create New Product
        </ThreadPrimitive.Suggestion>
        
        <ThreadPrimitive.Suggestion
          prompt="list my products"
          method="replace"
          autoSend={true}
          className="px-4 py-2 bg-gradient-to-r from-slate-500 to-slate-600 text-white rounded-lg hover:from-slate-600 hover:to-slate-700 transition-all duration-200 shadow-md hover:shadow-lg"
        >
          Refresh List
        </ThreadPrimitive.Suggestion>
      </div>
    </div>
  );
}

export const ProductCreatedWithListToolUI = makeAssistantToolUI<
  ProductCreatedWithListArgs,
  ProductCreatedWithListResult
>({
  toolName: "product_created_with_list",
  render: ProductCreatedWithListToolUIComponent,
});

// Products List UI Component
type ProductsListArgs = {
  title: string;
  description: string;
  products?: Product[];
  pagination?: {
    total: number;
    skip: number;
    limit: number;
    hasMore: boolean;
  };
};

type ProductsListResult = {
  type: "products_list";
  products: Product[];
  totalCount: number;
  limit: number;
  skip: number;
  hasMore: boolean;
  success: boolean;
  suppressOutput: true;
  ui: {
    type: "products_list";
    title: string;
    description: string;
    products: Product[];
  };
};

function ProductsListToolUIComponent({ args, result, status }: { args: ProductsListArgs; result?: ProductsListResult; status: any }) {
  if (status.type === "running") {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading Your Products...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (result?.ui && result.ui.type === "products_list") {
    const { ui } = result;
    const products = ui.products || [];
    const title = ui.title || "My Products";
    const description = ui.description || "Your products";
    
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {title}
          </CardTitle>
          <CardDescription>
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {products.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 text-6xl mb-4">📦</div>
              <h3 className="text-lg font-semibold text-gray-600 mb-2">No Products Yet</h3>
              <p className="text-gray-500 mb-6">Create your first product to get started!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {products.map((product: Product) => (
                <ExpandableProductCard 
                  key={product.id} 
                  product={product}
                />
              ))}
            </div>
          )}

          {/* Pagination Info */}
          {result.hasMore && (
            <div className="mt-6 text-sm text-gray-600 text-center">
              Showing {products.length} of {result.totalCount} products
              <span className="ml-2">
                <ThreadPrimitive.Suggestion
                  prompt={`list my products skip ${result.skip + result.limit}`}
                  method="replace"
                  autoSend={true}
                  className="text-blue-600 hover:text-blue-800 underline cursor-pointer"
                >
                  Load More
                </ThreadPrimitive.Suggestion>
              </span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-6 flex gap-3">
            <ThreadPrimitive.Suggestion
              prompt="Create a new product"
              method="replace"
              autoSend={true}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Create New Product
            </ThreadPrimitive.Suggestion>
            
            <ThreadPrimitive.Suggestion
              prompt="list my products"
              method="replace"
              autoSend={true}
              className="px-4 py-2 bg-gradient-to-r from-slate-500 to-slate-600 text-white rounded-lg hover:from-slate-600 hover:to-slate-700 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Refresh List
            </ThreadPrimitive.Suggestion>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

export const ProductsListToolUI = makeAssistantToolUI<
  ProductsListArgs,
  ProductsListResult
>({
  toolName: "list_my_products",
  render: ProductsListToolUIComponent,
});

// Product Deleted with List UI Component
type ProductDeletedWithListArgs = {
  productId: string;
};

type ProductDeletedWithListResult = {
  type: "product_deleted_with_list";
  deletedId: string;
  success: boolean;
  products: Product[];
  suppressOutput: true;
  ui: {
    type: "product_deleted_with_list" | "error_card";
    title: string;
    description: string;
    deletedId?: string;
    products?: Product[];
  };
};

export const ProductDeletedWithListToolUI = makeAssistantToolUI<
  ProductDeletedWithListArgs,
  ProductDeletedWithListResult
>({
  toolName: "delete_product",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Deleting Product...
            </CardTitle>
          </CardHeader>
        </Card>
      );
    }

    if (result?.ui) {
      const { ui } = result;
      
      if (ui.type === "error_card") {
        return (
          <Card className="w-full max-w-4xl mx-auto border-red-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-600">
                <AlertCircle className="h-5 w-5" />
                {ui.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-red-600">{ui.description}</p>
            </CardContent>
          </Card>
        );
      }
      
      if (ui.type === "product_deleted_with_list") {
        const products = ui.products || [];
        
        return (
          <Card className="w-full max-w-4xl mx-auto border-green-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                {ui.title}
              </CardTitle>
              <CardDescription>
                {ui.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {products.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-gray-400 text-6xl mb-4">📦</div>
                  <h3 className="text-lg font-semibold text-gray-600 mb-2">No Products Remaining</h3>
                  <p className="text-gray-500 mb-6">All products have been deleted. Create a new one to get started!</p>
                  
                  <ThreadPrimitive.Suggestion
                    prompt="Create a new product"
                    method="replace"
                    autoSend={true}
                    className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    Create New Product
                  </ThreadPrimitive.Suggestion>
                </div>
              ) : (
                <div className="space-y-4">
                  {products.map((product: Product) => (
                    <ExpandableProductCard 
                      key={product.id} 
                      product={product}
                    />
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-6 flex gap-3">
                <ThreadPrimitive.Suggestion
                  prompt="Create a new product"
                  method="replace"
                  autoSend={true}
                  className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
                >
                  Create New Product
                </ThreadPrimitive.Suggestion>
                
                <ThreadPrimitive.Suggestion
                  prompt="list my products"
                  method="replace"
                  autoSend={true}
                  className="px-4 py-2 bg-gradient-to-r from-slate-500 to-slate-600 text-white rounded-lg hover:from-slate-600 hover:to-slate-700 transition-all duration-200 shadow-md hover:shadow-lg"
                >
                  Refresh List
                </ThreadPrimitive.Suggestion>
              </div>
            </CardContent>
          </Card>
        );
      }
    }

    return null;
  },
});

// Show Product UI Component - for displaying a single product
type ShowProductArgs = {
  productId: string;
  visionId?: string; // Optional vision context when coming from a vision
};

type ShowProductResult = {
  type: "show_product";
  product: Product;
  success: boolean;
  suppressOutput: true;
  ui: {
    type: "show_product";
    title: string;
    description: string;
    product: Product;
    visionId?: string; // Pass vision context to UI
  };
};

function ShowProductToolUIComponent({ args, result, status }: { args: ShowProductArgs; result?: ShowProductResult; status: any }) {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [visionDetails, setVisionDetails] = useState<{ [visionId: string]: any }>({});
  const [loadingVisions, setLoadingVisions] = useState<{ [visionId: string]: boolean }>({});

  const isImageFile = (filePath: string) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = filePath.toLowerCase().split('.').pop();
    return ext && imageExtensions.includes(`.${ext}`);
  };

  const getFileUrl = (filePath: string) => {
    if (!filePath || filePath === "/no-file" || filePath.trim() === "") return null;
    const relativePath = filePath.replace('/data/', '');
    return `/api/files/${relativePath}`;
  };

  // Get current user ID
  React.useEffect(() => {
    const getCurrentUser = async () => {
      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const session = await response.json();
          const userId = session?.user?.id || null;
          setCurrentUser(userId);
        }
      } catch (error) {
        console.error('Error getting current user:', error);
      }
    };
    getCurrentUser();
  }, []);

  // Function to fetch vision details
  const fetchVisionDetails = async (visionId: string) => {
    if (visionDetails[visionId] || loadingVisions[visionId]) {
      return; // Already fetched or currently loading
    }

    setLoadingVisions(prev => ({ ...prev, [visionId]: true }));
    
    try {
      const response = await fetch(`/api/visions/${visionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.vision) {
          setVisionDetails(prev => ({
            ...prev,
            [visionId]: data.vision
          }));
        }
      } else {
        console.error('Failed to fetch vision details:', response.status);
      }
    } catch (error) {
      console.error('Error fetching vision details:', error);
    } finally {
      setLoadingVisions(prev => ({ ...prev, [visionId]: false }));
    }
  };

  if (status.type === "running") {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading Product Details...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (result?.ui && result.ui.type === "show_product") {
    const { ui } = result;
    const product = ui.product;
    
    if (!product) {
      return (
        <Card className="w-full max-w-4xl mx-auto border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              {ui.title}
            </CardTitle>
            <CardDescription>
              {ui.description}
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    const fileUrl = getFileUrl(product.filePath);
    const isImage = product.filePath !== "/no-file" && isImageFile(product.filePath);

    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            {ui.title}
          </CardTitle>
          <CardDescription>
            {ui.description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Product Description */}
            <div>
              <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Product Description
              </h3>
              <div className="bg-gray-50 p-4 rounded-lg border">
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {product.productDescription}
                </p>
              </div>
            </div>

            {/* Product Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Product Info */}
              <div>
                <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  Product Details
                </h3>
                <div className="bg-gray-50 p-4 rounded-lg border space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Product ID:</span>
                    <span className="font-mono text-gray-800">{product.id}</span>
                  </div>
                  {product.url && product.url.trim() && (
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600">URL:</span>
                      <a 
                        href={product.url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-blue-600 hover:underline max-w-xs truncate"
                        onClick={async (e) => {
                          // Track click if we have vision context
                          if (ui.visionId) {
                            try {
                              await fetch('/api/track-click', {
                                method: 'POST',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                  visionId: ui.visionId,
                                  productId: product.id
                                })
                              });
                            } catch (error) {
                              console.error('Failed to track click:', error);
                            }
                          }
                        }}
                      >
                        {product.url}
                      </a>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Created:</span>
                    <span className="text-gray-800">
                      {new Date(product.createdAt).toLocaleDateString()} at{" "}
                      {new Date(product.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Updated:</span>
                    <span className="text-gray-800">
                      {new Date(product.updatedAt).toLocaleDateString()} at{" "}
                      {new Date(product.updatedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>

              {/* Creator Info */}
              <div>
                <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Creator Info
                </h3>
                <div className="bg-gray-50 p-4 rounded-lg border space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Name:</span>
                    <span className="text-gray-800">{product.userName}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">Email:</span>
                    <span className="text-gray-800">{product.userEmail}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-600">User ID:</span>
                    <span className="font-mono text-gray-800">{product.userId}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Product Image */}
            {isImage && fileUrl && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Image className="h-4 w-4" />
                  Product Image
                </h3>
                <div className="bg-gray-50 p-4 rounded-lg border">
                  <img
                    src={fileUrl}
                    alt="Product image"
                    className="max-w-full h-auto rounded-md shadow-sm"
                  />
                </div>
              </div>
            )}

            {/* Product URL Section */}
            {product.url && product.url.trim() && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <ExternalLink className="h-4 w-4" />
                  Product URL
                </h3>
                <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div className="flex-1 mr-4">
                      {ui.visionId && (
                        <p className="text-xs text-green-600 mt-2">
                          ✓ Click tracking enabled (from vision {ui.visionId.slice(-8)})
                        </p>
                      )}
                    </div>
                    <a
                      href={product.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg hover:from-emerald-600 hover:to-teal-700 transition-all duration-200 font-medium text-sm shadow-md hover:shadow-lg"
                      onClick={async (e) => {
                        // Track click if we have vision context
                        if (ui.visionId) {
                          try {
                            await fetch('/api/track-click', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                visionId: ui.visionId,
                                productId: product.id
                              })
                            });
                            console.log(`Tracked click: Vision ${ui.visionId} → Product ${product.id}`);
                          } catch (error) {
                            console.error('Failed to track click:', error);
                          }
                        }
                      }}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Visit Product
                    </a>
                  </div>
                </div>
              </div>
            )}

            {/* Linked Vision Section - Moved to bottom */}
            {product.linkedVision && Object.keys(product.linkedVision).length > 0 && (
              <div>
                <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Linked Visions ({Object.keys(product.linkedVision).length})
                  {product.clicks && Object.keys(product.clicks).length > 0 && (
                    <span className="ml-2 text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                      {Object.values(product.clicks).reduce((sum: number, count: number) => sum + count, 0)} total clicks
                    </span>
                  )}
                </h3>
                <div className="space-y-4">
                  {Object.entries(product.linkedVision).map(([visionId, similarityScore]) => {
                    const vision = visionDetails[visionId];
                    const isLoading = loadingVisions[visionId];
                    
                    // Trigger fetch if not already loaded
                    if (!vision && !isLoading) {
                      fetchVisionDetails(visionId);
                    }

                    return (
                      <div key={visionId} className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Eye className="h-5 w-5 text-blue-600" />
                            <span className="font-medium text-blue-900">
                              {vision ? vision.visionDescription : isLoading ? 'Loading...' : `Vision ${visionId.slice(-8)}`}
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-sm bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                              {(similarityScore * 100).toFixed(1)}% match
                            </span>
                            {product.clicks && product.clicks[visionId] !== undefined && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                                {product.clicks[visionId]} clicks from this vision
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {vision && (
                          <div className="space-y-2">
                            <p className="text-sm text-gray-600">
                              By {vision.userName} • {new Date(vision.createdAt).toLocaleDateString()}
                            </p>
                            
                            {vision.filePath && vision.filePath !== "/no-file" && isImageFile(vision.filePath) && (() => {
                              const visionFileUrl = getFileUrl(vision.filePath);
                              return visionFileUrl ? (
                                <div className="mt-2">
                                  <img
                                    src={visionFileUrl}
                                    alt="Vision"
                                    className="w-20 h-20 object-cover rounded border"
                                  />
                                </div>
                              ) : null;
                            })()}
                          </div>
                        )}
                        
                        <div className="mt-3 flex gap-2">
                          <ThreadPrimitive.Suggestion
                            prompt={`show vision ${visionId}`}
                            method="replace"
                            autoSend={true}
                            className="px-3 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg hover:from-cyan-600 hover:to-blue-700 transition-all duration-200 text-sm shadow-md hover:shadow-lg"
                          >
                            View Vision Details
                          </ThreadPrimitive.Suggestion>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t">
              <ThreadPrimitive.Suggestion
                prompt="list my products"
                method="replace"
                autoSend={true}
                className="px-4 py-2 bg-gradient-to-r from-slate-500 to-slate-600 text-white rounded-lg hover:from-slate-600 hover:to-slate-700 transition-all duration-200 shadow-md hover:shadow-lg"
              >
                Back to Products
              </ThreadPrimitive.Suggestion>
              
              <ThreadPrimitive.Suggestion
                prompt={`delete product ${product.id}`}
                method="replace"
                autoSend={true}
                className="px-4 py-2 bg-gradient-to-r from-rose-500 to-red-600 text-white rounded-lg hover:from-rose-600 hover:to-red-700 transition-all duration-200 shadow-md hover:shadow-lg"
              >
                Delete Product
              </ThreadPrimitive.Suggestion>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}

export const ShowProductToolUI = makeAssistantToolUI<
  ShowProductArgs,
  ShowProductResult
>({
  toolName: "show_product",
  render: ShowProductToolUIComponent,
});

// Expandable Product Card Component
interface ExpandableProductCardProps {
  product: Product;
  isNewlyCreated?: boolean;
}

function ExpandableProductCard({ product, isNewlyCreated = false }: ExpandableProductCardProps) {
  const [isExpanded, setIsExpanded] = useState(isNewlyCreated);
  const [visionDetails, setVisionDetails] = useState<{ [visionId: string]: any }>({});
  const [loadingVisions, setLoadingVisions] = useState<{ [visionId: string]: boolean }>({});
  
  // Add state for current user
  const [currentUser, setCurrentUser] = useState<string | null>(null);

  // Get current user ID
  React.useEffect(() => {
    const getCurrentUser = async () => {
      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const session = await response.json();
          const userId = session?.user?.id || null;
          setCurrentUser(userId);
        }
      } catch (error) {
        console.error('Error getting current user:', error);
      }
    };
    getCurrentUser();
  }, []);

  // Helper functions
  const isImageFile = (filePath: string) => {
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = filePath.toLowerCase().split('.').pop();
    return ext && imageExtensions.includes(`.${ext}`);
  };

  const getFileUrl = (filePath: string) => {
    if (!filePath || filePath === "/no-file" || filePath.trim() === "") return null;
    const relativePath = filePath.replace('/data/', '');
    return `/api/files/${relativePath}`;
  };

  // Function to fetch vision details
  const fetchVisionDetails = async (visionId: string) => {
    if (visionDetails[visionId] || loadingVisions[visionId]) {
      return; // Already fetched or currently loading
    }

    setLoadingVisions(prev => ({ ...prev, [visionId]: true }));
    
    try {
      const response = await fetch(`/api/visions/${visionId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.vision) {
          setVisionDetails(prev => ({
            ...prev,
            [visionId]: data.vision
          }));
        }
      } else {
        console.error('Failed to fetch vision details:', response.status);
      }
    } catch (error) {
      console.error('Error fetching vision details:', error);
    } finally {
      setLoadingVisions(prev => ({ ...prev, [visionId]: false }));
    }
  };

  const fileUrl = getFileUrl(product.filePath);
  const isImage = product.filePath !== "/no-file" && isImageFile(product.filePath);

  return (
    <div className={`border rounded-lg p-4 transition-all duration-200 ${
      isNewlyCreated ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-gray-300'
    }`}>
      {/* Collapsed View */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-800 line-clamp-1">
              {product.productDescription.length > 100 
                ? `${product.productDescription.substring(0, 100)}...` 
                : product.productDescription}
            </h3>
            {isNewlyCreated && (
              <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded">
                New
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>Created: {new Date(product.createdAt).toLocaleDateString()}</span>
            {/* Removed linked vision info from collapsed view */}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="px-3 py-1 text-sm bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 hover:from-slate-200 hover:to-slate-300 rounded transition-all duration-200 shadow-sm hover:shadow-md"
          >
            {isExpanded ? 'Collapse' : 'Expand'}
          </button>
          
          <ThreadPrimitive.Suggestion
            prompt={`show product ${product.id}`}
            method="replace"
            autoSend={true}
            className="px-3 py-1 text-sm bg-gradient-to-r from-cyan-100 to-blue-100 text-cyan-700 hover:from-cyan-200 hover:to-blue-200 rounded transition-all duration-200 shadow-sm hover:shadow-md"
          >
            View Details
          </ThreadPrimitive.Suggestion>
          
          <ThreadPrimitive.Suggestion
            prompt={`delete product ${product.id}`}
            method="replace"
            autoSend={true}
            className="px-3 py-1 text-sm bg-gradient-to-r from-rose-100 to-red-100 text-rose-700 hover:from-rose-200 hover:to-red-200 rounded transition-all duration-200 shadow-sm hover:shadow-md"
          >
            Delete
          </ThreadPrimitive.Suggestion>
        </div>
      </div>

      {/* Expanded View */}
      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-gray-200">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold text-gray-800 mb-2">Product Details</h4>
              <p className="text-gray-700 mb-3">{product.productDescription}</p>
              
              <div className="space-y-1 text-sm text-gray-600">
                <p><strong>Product ID:</strong> {product.id}</p>
                {product.url && product.url.trim() && (
                  <p><strong>URL:</strong> 
                    <a 
                      href={product.url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="ml-2 inline-flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg hover:from-emerald-600 hover:to-teal-700 transition-all duration-200 font-medium text-sm shadow-md hover:shadow-lg"
                      onClick={async (e) => {
                        // Check if we have vision tracking parameters in the current URL
                        const urlParams = new URLSearchParams(window.location.search);
                        const visionId = urlParams.get('visionId');
                        const productId = urlParams.get('productId');
                        
                        // Only track if we have vision context
                        if (visionId && productId === product.id) {
                          try {
                            await fetch('/api/track-click', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                              },
                              body: JSON.stringify({
                                visionId: visionId,
                                productId: product.id
                              })
                            });
                          } catch (error) {
                            console.error('Failed to track click:', error);
                          }
                        }
                      }}
                    >
                      <ExternalLink className="h-3 w-3" />
                      Visit Product
                    </a>
                  </p>
                )}
                <p><strong>Created:</strong> {new Date(product.createdAt).toLocaleString()}</p>
                <p><strong>Updated:</strong> {new Date(product.updatedAt).toLocaleString()}</p>
              </div>
            </div>

            <div>
              {isImage && fileUrl ? (
                <div>
                  <h4 className="font-semibold text-gray-800 mb-2">Product Image</h4>
                  <img 
                    src={fileUrl} 
                    alt="Product" 
                    className="w-full max-w-sm h-auto rounded-lg shadow-sm"
                  />
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-4xl mb-2">📦</div>
                  <p>No image available</p>
                </div>
              )}
            </div>
          </div>

          {/* Linked Visions Section - Enhanced for Expanded View */}
          {product.linkedVision && Object.keys(product.linkedVision).length > 0 && (
            <div className="mt-6 pt-4 border-t border-gray-200">
              <h4 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
                <Eye className="h-5 w-5 text-blue-600" />
                Linked Visions ({Object.keys(product.linkedVision).length})
                {product.clicks && Object.keys(product.clicks).length > 0 && (
                  <span className="ml-2 text-sm bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                    {Object.values(product.clicks).reduce((sum: number, count: number) => sum + count, 0)} total clicks
                  </span>
                )}
              </h4>
              <div className="space-y-4">
                {Object.entries(product.linkedVision).map(([visionId, similarityScore]) => {
                  const vision = visionDetails[visionId];
                  const isLoading = loadingVisions[visionId];
                  
                  // Trigger fetch if not already loaded
                  if (!vision && !isLoading) {
                    fetchVisionDetails(visionId);
                  }

                  return (
                    <div key={visionId} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-all duration-200">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <Eye className="h-5 w-5 text-blue-600 flex-shrink-0" />
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-gray-900">
                                {vision ? 'Vision' : `Vision ${visionId.slice(-8)}`}
                              </span>
                              <span className="text-sm bg-green-100 text-green-700 px-2 py-1 rounded-full font-medium">
                                {(similarityScore * 100).toFixed(1)}% match
                              </span>
                              {product.clicks && product.clicks[visionId] !== undefined && (
                                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                                  {product.clicks[visionId]} clicks from this vision
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {isLoading ? (
                        <div className="space-y-3">
                          <div className="animate-pulse">
                            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                            <div className="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
                            <div className="h-3 bg-gray-200 rounded w-1/4"></div>
                          </div>
                        </div>
                      ) : vision ? (
                        <div className="space-y-3">
                          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-3 rounded-lg border border-blue-200">
                            <p className="text-gray-700 leading-relaxed line-clamp-3">
                              {vision.visionDescription}
                            </p>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {/* Creator Information */}
                            <div className="bg-gray-50 p-3 rounded-lg">
                              <h6 className="font-medium text-gray-900 mb-2">Creator</h6>
                              <p className="text-sm text-gray-600">{vision.userName}</p>
                              <p className="text-xs text-gray-500">{vision.userEmail}</p>
                            </div>

                            {/* Vision Details */}
                            <div className="bg-gray-50 p-3 rounded-lg">
                              <h6 className="font-medium text-gray-900 mb-2">Details</h6>
                              <p className="text-xs text-gray-500">
                                Created: {new Date(vision.createdAt).toLocaleDateString()}
                              </p>
                              {vision.onSale && vision.price && (
                                <p className="text-xs text-green-600 font-medium mt-1">
                                  Price: ${(vision.price / 100).toFixed(2)}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="text-gray-500 bg-gray-50 p-3 rounded-lg">
                          <div className="flex items-center gap-2">
                            <Hash className="h-4 w-4" />
                            <span>Vision ID: {visionId.slice(-8)}</span>
                          </div>
                          <p className="text-sm mt-1">Loading vision details...</p>
                        </div>
                      )}
                      
                      <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-3">
                        <div></div>
                        <ThreadPrimitive.Suggestion
                          prompt={`show vision ${visionId}`}
                          method="replace"
                          autoSend={true}
                          className="inline-flex items-center gap-2 px-3 py-1 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-lg hover:from-cyan-600 hover:to-blue-700 transition-all duration-200 font-medium text-sm shadow-md hover:shadow-lg"
                        >
                          <Eye className="h-4 w-4" />
                          View Vision
                        </ThreadPrimitive.Suggestion>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
} 