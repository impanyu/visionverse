import { makeAssistantToolUI, useAssistantRuntime, ThreadPrimitive } from "@assistant-ui/react";
import { VisionCreationForm } from "@/components/vision-creation-form";
import React, { useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SupportButton } from "@/components/ui/support-button";
import { CheckCircle, AlertCircle, Loader2, Upload, FileText, Download, Image, ChevronDown, ChevronUp, Eye, Calendar, User, Hash, FileIcon, Trash2, Package } from "lucide-react";
import { Vision } from "@/types/vision";

// Helper function to check if current user has supported a vision
const checkUserSupport = async (visionId: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/support_vision/check?visionId=${visionId}`);
    if (response.ok) {
      const data = await response.json();
      return data.isSupported || false;
    }
  } catch (error) {
    console.error('Error checking user support:', error);
  }
  return false;
};

type CreateVisionFormArgs = {
  message: string;
};

type CreateVisionFormResult = {
  type: "vision_creation_ui";
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

export const VisionCreationToolUI = makeAssistantToolUI<
  CreateVisionFormArgs,
  CreateVisionFormResult
>({
  toolName: "create_vision_form",
  render: ({ args, result, status }) => {
    const [formData, setFormData] = useState({
      visionDescription: "",
      imageFile: null as File | null,
      price: "" as string,
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitResult, setSubmitResult] = useState<any>(null);
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

      try {
        // Create FormData for file upload
        const formDataToSend = new FormData();
        formDataToSend.append("visionDescription", formData.visionDescription);
        
        if (formData.price.trim()) {
          formDataToSend.append("price", formData.price.trim());
        }
        
        if (formData.imageFile) {
          formDataToSend.append("imageFile", formData.imageFile);
        }

        const response = await fetch("/api/create_vision", {
          method: "POST",
          credentials: "include",
          body: formDataToSend, // Send FormData instead of JSON
        });

        if (response.ok) {
          const result = await response.json();
          
          // Check if this is a duplicate vision
          if (result.isDuplicate) {
            // Handle duplicate case - fetch vision list and show duplicate UI
            try {
              const visionListResponse = await fetch("/api/create_vision", {
                method: "GET",
                credentials: "include",
              });
              
              if (visionListResponse.ok) {
                const visionListData = await visionListResponse.json();
                
                // Set the result to show duplicate detection UI
                setSubmitResult({
                  ...result,
                  visions: visionListData.visions || [],
                  showDuplicateDetection: true,
                  attemptedDescription: formData.visionDescription
                });
              } else {
                // If vision list fetch fails, just show the duplicate message
                setSubmitResult({
                  ...result,
                  showDuplicateDetection: true,
                  attemptedDescription: formData.visionDescription
                });
              }
            } catch (listError) {
              console.error("Error fetching vision list:", listError);
              // If vision list fetch fails, just show the duplicate message
              setSubmitResult({
                ...result,
                showDuplicateDetection: true,
                attemptedDescription: formData.visionDescription
              });
            }
          } else {
            // Normal creation case - fetch vision list and show success UI
            try {
              const visionListResponse = await fetch("/api/create_vision", {
                method: "GET",
                credentials: "include",
              });
              
              if (visionListResponse.ok) {
                const visionListData = await visionListResponse.json();
                
                // Set the result to include the vision list
                setSubmitResult({
                  ...result,
                  visions: visionListData.visions || [],
                  showVisionList: true
                });
              } else {
                // If vision list fetch fails, just show the success message
                setSubmitResult(result);
              }
            } catch (listError) {
              console.error("Error fetching vision list:", listError);
              // If vision list fetch fails, just show the success message
              setSubmitResult(result);
            }
          }
        } else {
          const errorText = await response.text();
          setError(`Failed to create vision: ${errorText}`);
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
              Loading Vision Form...
            </CardTitle>
          </CardHeader>
        </Card>
      );
    }

    if (submitResult) {
      // Helper functions (same as in ListMyVisionsToolUI)
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

      const fileUrl = getFileUrl(submitResult.vision.filePath);
      const isImage = submitResult.vision.filePath !== "/no-file" && isImageFile(submitResult.vision.filePath);

      const handleViewAllVisions = () => {
        // Reload the page to go back to the main interface
        window.location.reload();
      };

      // Check if this is a duplicate detection case
      if (submitResult.showDuplicateDetection) {
        return (
          <div className="w-full max-w-4xl mx-auto space-y-4">
            {/* Duplicate Detection Card */}
            <Card className="border-yellow-200 bg-yellow-50">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-yellow-800">
                  <AlertCircle className="w-5 h-5" />
                  Identical Vision Found - Creation Prevented
                </CardTitle>
                <CardDescription className="text-yellow-700">
                  {submitResult.message || `A very similar vision already exists (similarity: ${submitResult.similarityScore ? (submitResult.similarityScore * 100).toFixed(1) : 'high'}%). Creation has been prevented to avoid duplicates.`}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {/* Attempted Description */}
                  <div className="bg-gray-100 p-4 rounded-lg border">
                    <h4 className="font-semibold text-gray-800 mb-2">Your Attempted Vision:</h4>
                    <p className="text-gray-700 italic">"{submitResult.attemptedDescription}"</p>
                  </div>

                  {/* Duplicate Vision Details */}
                  <div className="bg-yellow-100 p-4 rounded-lg border border-yellow-300">
                    <h4 className="font-semibold text-yellow-800 mb-2 flex items-center gap-2">
                      <Eye className="h-4 w-4" />
                      Similar Vision Found {submitResult.similarityScore && `(Similarity: ${(submitResult.similarityScore * 100).toFixed(1)}%)`}
                    </h4>
                    <div className="space-y-2">
                      <p className="text-yellow-700">{submitResult.vision.visionDescription}</p>
                      <div className="flex items-center gap-4 text-sm text-yellow-600">
                        <span>Created: {new Date(submitResult.vision.createdAt).toLocaleDateString()}</span>
                        <span>ID: {submitResult.vision.id.slice(-8)}</span>
                        {/* Price display hidden */}
                        {/*
                        {submitResult.vision.onSale && submitResult.vision.price && (
                          <span className="font-medium text-green-600">
                            ${((submitResult.vision.price || 0) / 100).toFixed(2)}
                          </span>
                        )}
                        */}
                      </div>
                    </div>
                  </div>

                  {/* All Visions List */}
                  {submitResult.visions && submitResult.visions.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-gray-800">Your Visions ({submitResult.visions.length})</h3>
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {submitResult.visions.map((vision: Vision, index: number) => (
                          <ExpandableVisionCard 
                            key={vision.id} 
                            vision={vision} 
                            index={index}
                            badgeText={vision.id === submitResult.vision.id ? "Duplicate Found" : `Vision #${index + 1}`}
                            badgeColor={vision.id === submitResult.vision.id ? "bg-yellow-100 text-yellow-800" : "bg-blue-100 text-blue-800"}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex justify-center gap-3 pt-4">
                    <Button 
                      onClick={handleViewAllVisions}
                      variant="outline"
                      className="border-yellow-300 text-yellow-700 hover:bg-yellow-100"
                    >
                      Back to Main
                    </Button>
                    <Button 
                      onClick={() => {
                        // Reset form to allow creating a different vision
                        setFormData({
                          visionDescription: "",
                          imageFile: null,
                          price: "",
                        });
                        setSubmitResult(null);
                        setHasSubmitted(false);
                      }}
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Create Different Vision
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        );
      }

      // Normal success case
      return (
        <div className="w-full max-w-4xl mx-auto space-y-4">
          {/* Success Card */}
          <Card className="border-green-200 bg-green-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-800">
                <CheckCircle className="w-5 h-5" />
                Vision Created Successfully!
              </CardTitle>
              <CardDescription className="text-green-700">
                Your vision "{submitResult.vision.visionDescription}" has been saved successfully.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Vision Details */}
                <div className="bg-white rounded-lg p-4 border border-green-200">
                  <h3 className="font-semibold text-green-800 mb-2">Vision Details</h3>
                  <p className="text-sm text-gray-700 mb-3">{submitResult.vision.visionDescription}</p>
                  
                  {/* File Display */}
                  {fileUrl && (
                    <div className="mt-3">
                      {isImage ? (
                        <div className="relative">
                          <img 
                            src={fileUrl} 
                            alt="Vision file" 
                            className="max-w-full h-auto rounded-md border max-h-64 object-contain"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-md border">
                          <FileText className="w-4 h-4 text-gray-600" />
                          <span className="text-sm text-gray-700">
                            {submitResult.vision.filePath.split('/').pop()}
                          </span>
                          <a 
                            href={fileUrl} 
                            download 
                            className="ml-auto text-blue-600 hover:text-blue-800"
                          >
                            <Download className="w-4 h-4" />
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Price Display - HIDDEN */}
                  {/*
                  {submitResult.vision.onSale && submitResult.vision.price && (
                    <div className="mt-3 text-sm text-gray-600">
                      <span className="font-medium">Price:</span> ${(submitResult.vision.price / 100).toFixed(2)}
                    </div>
                  )}
                  */}
                </div>

                {/* Vision List Display */}
                {submitResult.showVisionList && submitResult.visions && submitResult.visions.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="font-semibold text-green-800">Your Visions ({submitResult.visions.length})</h3>
                    <div className="space-y-2 max-h-96 overflow-y-auto">
                      {submitResult.visions.map((vision: Vision, index: number) => (
                        <ExpandableVisionCard 
                          key={vision.id} 
                          vision={vision} 
                          index={index}
                          badgeText={`Vision #${index + 1}`}
                          badgeColor="bg-blue-100 text-blue-800"
                        />
                      ))}
                    </div>
                  </div>
                )}

                {/* Action Button */}
                <div className="flex justify-center pt-4">
                  <Button 
                    onClick={handleViewAllVisions}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    {submitResult.showVisionList ? "Back to Main" : "View All My Visions"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (error) {
      return (
        <Card className="w-full max-w-4xl mx-auto border-red-200">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              Vision Creation Failed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-red-600">{error}</p>
          </CardContent>
        </Card>
      );
    }

    if (result) {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle>{result.ui_components.title}</CardTitle>
            <CardDescription>
              Share your vision, idea, complaint, or dream about a product or service. You can also attach supporting files like images or documents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label htmlFor="visionDescription" className="text-sm font-medium">
                  Vision Description
                </label>
                <textarea
                  id="visionDescription"
                  value={formData.visionDescription}
                  onChange={(e) => setFormData(prev => ({ ...prev, visionDescription: e.target.value }))}
                  placeholder="Describe your vision in detail..."
                  className="w-full p-3 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  rows={4}
                  required
                />
              </div>

              {/* Price Input - HIDDEN but keeping the state for backend compatibility
              <div className="space-y-2">
                <label htmlFor="price" className="text-sm font-medium">
                  Price (Optional)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                  <input
                    id="price"
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.price}
                    onChange={(e) => setFormData(prev => ({ ...prev, price: e.target.value }))}
                    placeholder="0.00"
                    className="w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <p className="text-xs text-gray-500">Set a price if you want to sell or trade this vision</p>
              </div>
              */}

              <div className="space-y-2">
                <label htmlFor="imageFile" className="text-sm font-medium">
                  Supporting File (Optional)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    id="imageFile"
                    type="file"
                    onChange={(e) => setFormData(prev => ({ ...prev, imageFile: e.target.files?.[0] || null }))}
                    accept="image/*,.pdf,.doc,.docx"
                    className="hidden"
                  />
                  <label
                    htmlFor="imageFile"
                    className="flex items-center gap-2 px-3 py-2 border border-dashed rounded-md cursor-pointer hover:bg-gray-50"
                  >
                    <Upload className="h-4 w-4" />
                    {formData.imageFile ? formData.imageFile.name : "Choose file"}
                  </label>
                </div>
              </div>

              <Button
                type="submit"
                disabled={isSubmitting || !formData.visionDescription.trim()}
                className="w-full"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Creating Vision...
                  </>
                ) : (
                  "Create Vision"
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

// New VisionCreationDirectToolUI for handling direct vision creation with UI
type VisionCreationDirectArgs = {
  visionDescription: string;
  filePath: string;
};

type VisionCreationDirectResult = {
  type: "vision_created_direct";
  message: string;
  visionDescription: string;
  filePath: string;
  success?: boolean;
  visionId?: string;
  error?: string;
  ui?: {
    type: "success_card" | "error_card";
    title: string;
    description: string;
    content: any;
    actions?: Array<{
      type: "link";
      text: string;
      url: string;
    }>;
  };
};

export const VisionCreationDirectToolUI = makeAssistantToolUI<
  VisionCreationDirectArgs,
  VisionCreationDirectResult
>({
  toolName: "create_vision_direct",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Creating Vision...
            </CardTitle>
          </CardHeader>
        </Card>
      );
    }

    if (result?.ui) {
      const { ui } = result;
      
      if (ui.type === "success_card") {
        return (
          <Card className="w-full max-w-4xl mx-auto border-green-200">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-600">
                <CheckCircle className="h-5 w-5" />
                {ui.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="p-3 bg-green-50 rounded">
                  <p className="font-medium text-green-800">Vision Description:</p>
                  <p className="text-green-700">{ui.content.visionDescription}</p>
                </div>
                
                {ui.content.price && (
                  <div className="p-3 bg-blue-50 rounded">
                    <p className="font-medium text-blue-800">Price:</p>
                    <p className="text-blue-700 text-lg font-semibold">
                      ${(ui.content.price / 100).toFixed(2)}
                    </p>
                  </div>
                )}
                
                <div className="text-sm">
                  <strong>Vision ID:</strong> {ui.content.visionId}
                </div>
              </div>
            </CardContent>
          </Card>
        );
      }
      
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
              <div className="mt-4 p-3 bg-gray-50 rounded">
                <p className="text-sm text-gray-600">
                  <strong>Attempted Vision:</strong> {ui.content.attemptedVision}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      }
    }

    return null;
  },
});

// List My Visions Tool UI
type ListMyVisionsArgs = {
  limit: number;
};

type ListMyVisionsResult = {
  type: "visions_list";
  message?: string;
  visions: Array<{
    id: string;
    userId: string;
    userName: string;
    userEmail: string;
    visionDescription: string;
    filePath: string;
    price?: number; // Price in cents
    createdAt: string;
    updatedAt: string;
  }>;
  totalCount: number;
  success?: boolean;
  error?: string;
  suppressOutput?: boolean;
  ui?: {
    type: "visions_list" | "error_card";
    title: string;
    description: string;
    visions?: Array<any>;
  };
};

export const ListMyVisionsToolUI = makeAssistantToolUI<
  ListMyVisionsArgs,
  ListMyVisionsResult
>({
  toolName: "list_my_visions",
  render: ({ args, result, status }) => {
    // Helper function to check if file is an image
    const isImageFile = (filePath: string) => {
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
      const ext = filePath.toLowerCase().split('.').pop();
      return ext && imageExtensions.includes(`.${ext}`);
    };

    // Helper function to get file display URL
    const getFileUrl = (filePath: string) => {
      if (!filePath || filePath === "/no-file" || filePath.trim() === "") return null;
      const relativePath = filePath.replace('/data/', '');
      return `/api/files/${relativePath}`;
    };

    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading Your Visions...
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
      
      if (ui.type === "visions_list") {
        const visions = ui.visions || [];
        
        return (
          <Card className="w-full max-w-4xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                {ui.title}
              </CardTitle>
              <CardDescription>
                Here are all the visions you've created. Click on any vision to expand and see full details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {visions.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  No visions found. Create your first vision to get started!
                </p>
              ) : (
                <div className="space-y-4">
                  {visions.map((vision: any, index: number) => (
                    <ExpandableVisionCard
                      key={vision.id}
                      vision={vision}
                      index={index}
                      badgeText={`Vision #${index + 1}`}
                      badgeColor="bg-blue-100 text-blue-800"
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      }
    }

    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle>Loading...</CardTitle>
        </CardHeader>
      </Card>
    );
  },
});

// Search My Visions Tool UI
type SearchMyVisionsArgs = {
  query: string;
  limit: number;
};

type SearchMyVisionsResult = {
  type: "search_results";
  query: string;
  results: Array<{
    vision: Vision;
    similarityScore?: number;
    matchedText?: string;
  }>;
  totalFound: number;
  suppressOutput?: boolean;
  success?: boolean;
  error?: string;
  ui?: {
    type: "search_results" | "error_card";
    title: string;
    description: string;
    query?: string;
    results?: Array<{
      vision: Vision;
      similarityScore?: number;
      matchedText?: string;
    }>;
  };
};

export const SearchMyVisionsToolUI = makeAssistantToolUI<
  SearchMyVisionsArgs,
  SearchMyVisionsResult
>({
  toolName: "search_my_visions",
  render: ({ args, result, status }) => {
    // Helper functions (same as in other components)
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

    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Searching Your Visions...
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
      
      if (ui.type === "search_results") {
        const results = ui.results || [];
        
        return (
          <Card className="w-full max-w-4xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                {ui.title}
              </CardTitle>
              <CardDescription>
                Search results for your visions. Click on any result to see full details and similarity scores.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {results.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">No matching visions found. Try different keywords!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {results.map((item, index) => {
                    const { vision, similarityScore, matchedText } = item;
                    const fileUrl = getFileUrl(vision.filePath);
                    const isImage = vision.filePath !== "/no-file" && isImageFile(vision.filePath);
                    
                    return (
                      <ExpandableVisionCard
                        key={vision.id}
                        vision={vision}
                        index={index}
                        similarityScore={similarityScore}
                        matchedText={matchedText}
                        badgeText={`Match #${index + 1}`}
                      />
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      }
    }

    return null;
  },
});

// Search All Visions Tool UI (searches across all users)
type SearchAllVisionsArgs = {
  query: string;
  limit: number;
};

type SearchAllVisionsResult = {
  type: "search_all_results";
  query: string;
  results: Array<{
    vision: Vision;
    similarityScore?: number;
    matchedText?: string;
  }>;
  totalFound: number;
  suppressOutput?: boolean;
  success?: boolean;
  error?: string;
  ui?: {
    type: "search_all_results" | "error_card";
    title: string;
    description: string;
    query?: string;
    results?: Array<{
      vision: Vision;
      similarityScore?: number;
      matchedText?: string;
    }>;
  };
};

export const SearchAllVisionsToolUI = makeAssistantToolUI<
  SearchAllVisionsArgs,
  SearchAllVisionsResult
>({
  toolName: "search_all_visions",
  render: ({ args, result, status }) => {
    // Helper functions (same as in other components)
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

    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Searching All Visions...
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
      
      if (ui.type === "search_all_results") {
        const results = ui.results || [];
        
        return (
          <Card className="w-full max-w-4xl mx-auto">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Eye className="h-5 w-5" />
                {ui.title}
              </CardTitle>
              <CardDescription>
                Search results from all users' visions. Click on any result to see full details and creator information.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {results.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-gray-500">No matching visions found across all users. Try different keywords!</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {results.map((item, index) => {
                    const { vision, similarityScore, matchedText } = item;
                    const fileUrl = getFileUrl(vision.filePath);
                    const isImage = vision.filePath !== "/no-file" && isImageFile(vision.filePath);
                    
                    return (
                      <ExpandableVisionCard
                        key={vision.id}
                        vision={vision}
                        index={index}
                        similarityScore={similarityScore}
                        matchedText={matchedText}
                        badgeText={`Result #${index + 1}`}
                        badgeColor="bg-purple-100 text-purple-800"
                      />
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      }
    }

    return null;
  },
});

// Add new types for vision deletion with list
type DeleteVisionWithListArgs = {
  visionId: string;
};

type DeleteVisionWithListResult = {
  type: "vision_deleted_with_list";
  deletedId: string;
  success: boolean;
  visions: Vision[];
  suppressOutput: true;
  ui: {
    type: "vision_deleted_with_list" | "error_card";
    title: string;
    description: string;
    deletedId?: string;
    visions?: Vision[];
  };
};

// New component for vision deletion with list
export const DeleteVisionWithListToolUI = makeAssistantToolUI<
  DeleteVisionWithListArgs,
  DeleteVisionWithListResult
>({
  toolName: "delete_vision",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Deleting Vision...
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
      
      if (ui.type === "vision_deleted_with_list") {
        const visions = ui.visions || [];
        
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
              {visions.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">
                    No visions remaining. Create your first vision to get started!
                  </p>
                  <Button 
                    onClick={() => {
                      // Trigger the create vision form
                      const event = new CustomEvent('create-vision');
                      window.dispatchEvent(event);
                    }}
                    className="bg-blue-500 hover:bg-blue-600"
                  >
                    Create New Vision
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {visions.map((vision: Vision, index: number) => (
                    <ExpandableVisionCard
                      key={vision.id}
                      vision={vision}
                      index={index}
                      badgeText={`Vision #${index + 1}`}
                      badgeColor="bg-blue-100 text-blue-800"
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      }
    }

    return null;
  },
});

// Add new types for vision creation with list
type VisionCreatedWithListArgs = {
  visionDescription: string;
  imageFile?: string;
};

type VisionCreatedWithListResult = {
  type: "vision_created_with_list";
  vision: Vision;
  visions: Vision[];
  success: boolean;
  suppressOutput: true;
  ui: {
    type: "vision_created_with_list";
    title: string;
    description: string;
    vision: Vision;
    visions: Vision[];
  };
};

// New component for vision creation with list
export const VisionCreatedWithListToolUI = makeAssistantToolUI<
  VisionCreatedWithListArgs,
  VisionCreatedWithListResult
>({
  toolName: "create_vision_direct",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Creating Vision...
            </CardTitle>
          </CardHeader>
        </Card>
      );
    }

    if (result?.ui) {
      const { ui } = result;
      
      if (ui.type === "vision_created_with_list") {
        const visions = ui.visions || [];
        const createdVision = ui.vision;
        
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
              <div className="space-y-4">
                {visions.map((vision: Vision, index: number) => (
                  <ExpandableVisionCard
                    key={vision.id}
                    vision={vision}
                    index={index}
                    badgeText={vision.id === createdVision.id ? "New Vision" : `Vision #${index + 1}`}
                    badgeColor={vision.id === createdVision.id ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800"}
                  />
                ))}
              </div>
            </CardContent>
          </Card>
        );
      }
    }

    return null;
  },
});

// Add new types for vision duplicate detection
type VisionDuplicateFoundArgs = {
  visionDescription: string;
  imageFile?: string;
};

type VisionDuplicateFoundResult = {
  type: "vision_duplicate_found";
  duplicate: Vision;
  visions: Vision[];
  similarityScore: number;
  success: boolean;
  suppressOutput: true;
  ui: {
    type: "vision_duplicate_found";
    title: string;
    description: string;
    duplicate: Vision;
    visions: Vision[];
    similarityScore: number;
    attemptedDescription: string;
  };
};

// New component for vision duplicate detection
export const VisionDuplicateFoundToolUI = makeAssistantToolUI<
  VisionDuplicateFoundArgs,
  VisionDuplicateFoundResult
>({
  toolName: "create_vision_direct",
  render: ({ args, result, status }) => {
    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Checking for Duplicates...
            </CardTitle>
          </CardHeader>
        </Card>
      );
    }

    if (result?.ui) {
      const { ui } = result;
      
      if (ui.type === "vision_duplicate_found") {
        const visions = ui.visions || [];
        const duplicateVision = ui.duplicate;
        const similarityScore = ui.similarityScore;
        
        return (
          <Card className="w-full max-w-4xl mx-auto border-yellow-200 bg-yellow-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-yellow-800">
                <AlertCircle className="h-5 w-5" />
                {ui.title}
              </CardTitle>
              <CardDescription className="text-yellow-700">
                {ui.description}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Attempted Description */}
                <div className="bg-gray-100 p-4 rounded-lg border">
                  <h4 className="font-semibold text-gray-800 mb-2">Your Attempted Vision:</h4>
                  <p className="text-gray-700 italic">"{ui.attemptedDescription}"</p>
                </div>

                {/* Duplicate Vision Details */}
                <div className="bg-yellow-100 p-4 rounded-lg border border-yellow-300">
                  <h4 className="font-semibold text-yellow-800 mb-2 flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Similar Vision Found (Similarity: {(similarityScore * 100).toFixed(1)}%)
                  </h4>
                  <div className="space-y-2">
                    <p className="text-yellow-700">{duplicateVision.visionDescription}</p>
                    <div className="flex items-center gap-4 text-sm text-yellow-600">
                      <span>Created: {new Date(duplicateVision.createdAt).toLocaleDateString()}</span>
                      <span>ID: {duplicateVision.id.slice(-8)}</span>
                      {/* Price display hidden */}
                      {/*
                      {duplicateVision.onSale && duplicateVision.price && (
                        <span className="font-medium text-green-600">
                          ${((duplicateVision.price || 0) / 100).toFixed(2)}
                        </span>
                      )}
                      */}
                    </div>
                  </div>
                </div>

                {/* All Visions List */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-gray-800">Your Visions ({visions.length})</h3>
                  <div className="space-y-2 max-h-96 overflow-y-auto">
                    {visions.map((vision: Vision, index: number) => (
                      <ExpandableVisionCard 
                        key={vision.id} 
                        vision={vision} 
                        index={index}
                        badgeText={vision.id === duplicateVision.id ? "Duplicate Found" : `Vision #${index + 1}`}
                        badgeColor={vision.id === duplicateVision.id ? "bg-yellow-100 text-yellow-800" : "bg-blue-100 text-blue-800"}
                      />
                    ))}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex justify-center gap-3 pt-4">
                  <Button 
                    onClick={() => window.location.reload()}
                    variant="outline"
                    className="border-yellow-300 text-yellow-700 hover:bg-yellow-100"
                  >
                    Back to Main
                  </Button>
                  <ThreadPrimitive.Suggestion
                    prompt="create vision form"
                    method="replace"
                    autoSend
                    asChild
                  >
                    <Button 
                      className="bg-blue-600 hover:bg-blue-700 text-white"
                    >
                      Create Different Vision
                    </Button>
                  </ThreadPrimitive.Suggestion>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      }
    }

    return null;
  },
});

// Shared Expandable Vision Component
function ExpandableVisionCard({ 
  vision, 
  index, 
  similarityScore,
  matchedText,
  badgeText, 
  badgeColor = "bg-blue-100 text-blue-800"
}: { 
  vision: Vision; 
  index: number; 
  similarityScore?: number;
  matchedText?: string;
  badgeText: string;
  badgeColor?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  // Add state to track support status locally
  const [supportCount, setSupportCount] = useState(vision.supportCount || 0);
  const [isSupported, setIsSupported] = useState(false);
  const [productDetails, setProductDetails] = useState<{ [productId: string]: any }>({});
  const [loadingProducts, setLoadingProducts] = useState<{ [productId: string]: boolean }>({});
  
  // Add state for onSale toggle and price editing
  const [localOnSale, setLocalOnSale] = useState(vision.onSale || false);
  const [localPrice, setLocalPrice] = useState(((vision.price || 0) / 100).toFixed(2));
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Get current user ID on component mount
  React.useEffect(() => {
    const getCurrentUser = async () => {
      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const session = await response.json();
          const userId = session?.user?.id || null;
          setCurrentUser(userId);
          // Set initial support status based on current user
          setIsSupported(userId ? (vision.supportedBy || []).includes(userId) : false);
        }
      } catch (error) {
        console.error('Error getting current user:', error);
      }
    };
    getCurrentUser();
  }, [vision.supportedBy]);

  const toggleExpanded = () => setIsExpanded(!isExpanded);

  // Function to fetch product details
  const fetchProductDetails = async (productId: string) => {
    if (productDetails[productId] || loadingProducts[productId]) {
      return; // Already fetched or currently loading
    }

    setLoadingProducts(prev => ({ ...prev, [productId]: true }));
    
    try {
      // Temporarily use debug endpoint to test functionality
      const response = await fetch(`/api/products/debug/${productId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.product) {
          setProductDetails(prev => ({
            ...prev,
            [productId]: data.product
          }));
        }
      } else {
        console.error('Failed to fetch product details:', response.status);
      }
    } catch (error) {
      console.error('Error fetching product details:', error);
    } finally {
      setLoadingProducts(prev => ({ ...prev, [productId]: false }));
    }
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

  const fileUrl = getFileUrl(vision.filePath);
  const isImage = vision.filePath !== "/no-file" && isImageFile(vision.filePath);

  // Callback to handle support changes from SupportButton
  const handleSupportChange = (newSupportCount: number, newIsSupported: boolean) => {
    setSupportCount(newSupportCount);
    setIsSupported(newIsSupported);
  };

  // Add save function for onSale and price
  const handleSave = async () => {
    if (!currentUser || currentUser !== vision.userId) {
      setSaveMessage("You can only edit your own visions");
      setTimeout(() => setSaveMessage(null), 3000);
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const response = await fetch('/api/update_vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          visionId: vision.id,
          onSale: localOnSale,
          price: Math.round(parseFloat(localPrice) * 100), // Convert to cents
        }),
      });

      if (response.ok) {
        setSaveMessage("Vision updated successfully!");
        // Update the vision object locally
        vision.onSale = localOnSale;
        vision.price = Math.round(parseFloat(localPrice) * 100);
      } else {
        const errorData = await response.json();
        setSaveMessage(`Error: ${errorData.error || 'Failed to update vision'}`);
      }
    } catch (error) {
      console.error('Error saving vision:', error);
      setSaveMessage('Error: Failed to save changes');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  return (
    <div className="border rounded-lg overflow-hidden hover:shadow-md transition-shadow">
      {!isExpanded ? (
        // Collapsed View - Clickable Header with Product Details
        <div className="p-4">
          <div 
            className="cursor-pointer hover:bg-gray-50 transition-colors rounded-lg p-2 -m-2"
            onClick={() => setIsExpanded(true)}
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                <span className={`${badgeColor} text-xs font-medium px-2.5 py-0.5 rounded`}>
                  {badgeText}
                </span>
                <span className="text-xs text-gray-500">
                  ID: {vision.id.slice(-8)}
                </span>
                {similarityScore && (
                  <span className="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded">
                    {(similarityScore * 100).toFixed(1)}% match
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  {new Date(vision.createdAt).toLocaleDateString()}
                </span>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </div>
            </div>
            
            {/* Vision Description Preview */}
            <div className="mb-3">
              <p className="text-gray-800 leading-relaxed line-clamp-2">
                {vision.visionDescription}
              </p>
            </div>

            {/* Quick Info */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" />
                  Click to expand
                </span>
                {vision.filePath !== "/no-file" && (
                  <span className="flex items-center gap-1">
                    <FileIcon className="h-3 w-3" />
                    Has attachment
                  </span>
                )}
                {/* Only show price if vision is on sale - HIDDEN */}
                {/*
                {vision.onSale && (
                  <span className="flex items-center gap-1 text-green-600 font-medium">
                    ${((vision.price || 0) / 100).toFixed(2)}
                  </span>
                )}
                */}
                <ThreadPrimitive.Suggestion
                  prompt={`show vision ${vision.id}`}
                  method="replace"
                  autoSend={true}
                  asChild
                >
                  <button
                    className="flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                    onClick={(e) => {
                      e.stopPropagation(); // Prevent expanding when clicking this link
                    }}
                  >
                    <Eye className="h-3 w-3" />
                    View Details
                  </button>
                </ThreadPrimitive.Suggestion>
              </div>
              <div onClick={(e) => e.stopPropagation()}>
                <SupportButton
                  visionId={vision.id}
                  initialSupportCount={supportCount}
                  initialIsSupported={isSupported}
                  size="sm"
                  variant="outline"
                  onSupportChange={handleSupportChange}
                />
              </div>
            </div>
          </div>

          {/* Linked Products Section - Simple Count Display in Collapsed State */}
          {(() => {
            // Helper function to safely get linked products object
            const getLinkedProductsObject = (linkedProducts: any): { [productId: string]: number } => {
              // Handle old array format or missing field
              if (!linkedProducts || Array.isArray(linkedProducts)) {
                return {};
              }
              // Handle new object format
              if (typeof linkedProducts === 'object') {
                return linkedProducts;
              }
              return {};
            };

            const linkedProductsObj = getLinkedProductsObject(vision.linkedProducts);
            const linkedProductsCount = Object.keys(linkedProductsObj).length;

            return linkedProductsCount > 0 && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-gray-700">
                      {linkedProductsCount} linked product{linkedProductsCount !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <button
                    onClick={() => setIsExpanded(true)}
                    className="text-xs text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                  >
                    View products
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        // Expanded View - Full Vision Content Only
        <div className="p-4">
          {/* Header with Collapse Button */}
          <div className="flex justify-between items-start mb-4">
            <div className="flex items-center gap-2">
              <span className={`${badgeColor} text-xs font-medium px-2.5 py-0.5 rounded`}>
                {badgeText}
              </span>
              <span className="text-xs text-gray-500">
                ID: {vision.id.slice(-8)}
              </span>
              {similarityScore && (
                <span className="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-0.5 rounded">
                  {(similarityScore * 100).toFixed(1)}% match
                </span>
              )}
              <SupportButton
                visionId={vision.id}
                initialSupportCount={supportCount}
                initialIsSupported={isSupported}
                size="sm"
                variant="outline"
                onSupportChange={handleSupportChange}
              />
            </div>
            <div className="flex items-center gap-2">
              <ThreadPrimitive.Suggestion
                prompt={`show vision ${vision.id}`}
                method="replace"
                autoSend={true}
                asChild
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                  title="View full vision details"
                >
                  <Eye className="h-4 w-4" />
                </Button>
              </ThreadPrimitive.Suggestion>
              <ThreadPrimitive.Suggestion
                prompt={`delete vision ${vision.id}`}
                method="replace"
                autoSend
                asChild
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                  title="Delete vision"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!confirm("Are you sure you want to delete this vision? This action cannot be undone.")) {
                      e.preventDefault();
                    }
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </ThreadPrimitive.Suggestion>
              <button
                onClick={() => setIsExpanded(false)}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ChevronUp className="h-4 w-4" />
                Collapse
              </button>
            </div>
          </div>

          {/* Full Vision Details */}
          <div className="space-y-4">
            {/* Full Description */}
            <div>
              <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                Full Description
              </h4>
              <div className="bg-gray-50 p-3 rounded border">
                <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">
                  {vision.visionDescription}
                </p>
              </div>
            </div>

            {/* Vision Metadata */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* On Sale Toggle and Price Section - HIDDEN */}
              {/* 
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900 flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  Sale Settings
                </h4>
                <div className="bg-gray-50 p-4 rounded-lg border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">On Sale</span>
                    <button
                      onClick={() => setLocalOnSale(!localOnSale)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        localOnSale ? 'bg-blue-600' : 'bg-gray-200'
                      }`}
                      disabled={currentUser !== vision.userId}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          localOnSale ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  
                  {localOnSale && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Price</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={localPrice}
                          onChange={(e) => setLocalPrice(e.target.value)}
                          className="w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={currentUser !== vision.userId}
                        />
                      </div>
                    </div>
                  )}
                  
                  {currentUser === vision.userId && (
                    <div className="space-y-2">
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        {isSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                      {saveMessage && (
                        <p className={`text-sm ${saveMessage.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
                          {saveMessage}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
              */}

              <div className="space-y-2">
                <h4 className="font-medium text-gray-900 flex items-center gap-2">
                  <Hash className="h-4 w-4" />
                  Vision Details
                </h4>
                <div className="bg-gray-50 p-3 rounded border space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Vision ID:</span>
                    <ThreadPrimitive.Suggestion
                      prompt={`show vision ${vision.id}`}
                      method="replace"
                      autoSend={true}
                      asChild
                    >
                      <button className="font-mono text-blue-600 hover:text-blue-800 hover:underline transition-colors">
                        {vision.id}
                      </button>
                    </ThreadPrimitive.Suggestion>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Created:</span>
                    <span className="text-gray-800">
                      {new Date(vision.createdAt).toLocaleDateString()} at{" "}
                      {new Date(vision.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Updated:</span>
                    <span className="text-gray-800">
                      {new Date(vision.updatedAt).toLocaleDateString()} at{" "}
                      {new Date(vision.updatedAt).toLocaleTimeString()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Creator Info Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <h4 className="font-medium text-gray-900 flex items-center gap-2">
                  <User className="h-4 w-4" />
                  Creator Info
                </h4>
                <div className="bg-gray-50 p-3 rounded border space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Name:</span>
                    <span className="text-gray-800">{vision.userName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Email:</span>
                    <span className="text-gray-800">{vision.userEmail}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">User ID:</span>
                    <span className="font-mono text-gray-800">{vision.userId}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* File Display Section */}
            {vision.filePath !== "/no-file" && fileUrl && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                  {isImage ? (
                    <Image className="h-4 w-4" />
                  ) : (
                    <FileText className="h-4 w-4" />
                  )}
                  Attached File
                </h4>
                <div className="bg-gray-50 p-3 rounded border">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-medium">Filename:</span>
                    <span className="text-sm text-gray-600">
                      {vision.filePath.split('/').pop()}
                    </span>
                  </div>
                  
                  {isImage ? (
                    <div className="space-y-2">
                      <img
                        src={fileUrl}
                        alt="Vision attachment"
                        className="max-w-full h-auto rounded-md shadow-sm"
                      />
                    </div>
                  ) : (
                    <div className="text-center py-4 text-gray-500">
                      <FileText className="h-8 w-8 mx-auto mb-2" />
                      <p className="text-sm">File attachment available</p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Linked Products Section */}
            {(() => {
              // Helper function to safely get linked products object
              const getLinkedProductsObject = (linkedProducts: any): { [productId: string]: number } => {
                // Handle old array format or missing field
                if (!linkedProducts || Array.isArray(linkedProducts)) {
                  return {};
                }
                // Handle new object format
                if (typeof linkedProducts === 'object') {
                  return linkedProducts;
                }
                return {};
              };

              // Helper function to safely get clicks object and calculate total
              const getClicksData = (clicks: any): { clicksObj: { [productId: string]: number }, totalClicks: number } => {
                if (!clicks || typeof clicks !== 'object') {
                  return { clicksObj: {}, totalClicks: 0 };
                }
                const clicksObj = clicks;
                const totalClicks = Object.values(clicksObj).reduce((sum: number, count: any) => sum + (typeof count === 'number' ? count : 0), 0);
                return { clicksObj, totalClicks };
              };

              const linkedProductsObj = getLinkedProductsObject(vision.linkedProducts);
              const linkedProductsCount = Object.keys(linkedProductsObj).length;
              const { clicksObj, totalClicks } = getClicksData(vision.clicks);

              return linkedProductsCount > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                      <Package className="h-5 w-5 text-blue-600" />
                      Linked Products ({linkedProductsCount})
                    </h3>
                    <div className="bg-green-50 px-3 py-1 rounded-full border border-green-200">
                      <span className="text-sm font-medium text-green-800">
                        Total URL Clicks: {totalClicks}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-4">
                    <div className="grid gap-4">
                      {Object.entries(linkedProductsObj)
                        .sort(([, scoreA], [, scoreB]) => scoreB - scoreA) // Sort by similarity score descending
                        .slice(0, 5) // Show top 5 products
                        .map(([productId, similarityScore], index) => {
                          const product = productDetails[productId];
                          const isLoading = loadingProducts[productId];
                          const productClicks = clicksObj[productId] || 0;
                          
                          // Trigger fetch if not already loaded
                          if (!product && !isLoading) {
                            fetchProductDetails(productId);
                          }

                          return (
                            <div key={productId} className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-lg transition-all duration-200">
                              <div className="flex items-start justify-between mb-4">
                                <div className="flex items-center gap-4 flex-1">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-3 mb-2">
                                      <Package className="h-5 w-5 text-blue-600" />
                                      <span className="font-semibold text-gray-900 text-lg">
                                        {product ? (product.productName || 'Product') : `Product ${productId.slice(-8)}`}
                                      </span>
                                      <span className="text-sm bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium">
                                        {(similarityScore * 100).toFixed(1)}% match
                                      </span>
                                      {productClicks > 0 && (
                                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                                          {productClicks} click{productClicks !== 1 ? 's' : ''} from this vision
                                        </span>
                                      )}
                                    </div>
                                    
                                    {isLoading ? (
                                      <div className="space-y-3">
                                        <div className="h-5 bg-gray-200 rounded animate-pulse"></div>
                                        <div className="h-4 bg-gray-200 rounded animate-pulse w-4/5"></div>
                                        <div className="h-4 bg-gray-200 rounded animate-pulse w-3/5"></div>
                                        <div className="flex gap-4 mt-3">
                                          <div className="h-3 bg-gray-200 rounded animate-pulse w-20"></div>
                                          <div className="h-3 bg-gray-200 rounded animate-pulse w-16"></div>
                                          <div className="h-3 bg-gray-200 rounded animate-pulse w-24"></div>
                                        </div>
                                      </div>
                                    ) : product ? (
                                      <div className="space-y-4">
                                        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                                          <h5 className="font-semibold text-blue-900 mb-2 text-lg">
                                            {product.productName || 'Product'}
                                          </h5>
                                          <p className="text-gray-700 leading-relaxed text-base line-clamp-3">
                                            {product.productDescription}
                                          </p>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                          {/* Product Image Thumbnail */}
                                          <div className="bg-gray-50 p-3 rounded-lg border">
                                            <h6 className="font-medium text-gray-900 mb-2">Product Image</h6>
                                            {(() => {
                                              const productImageUrl = product.filePath && product.filePath !== "/no-file" && product.filePath.trim() !== ""
                                                ? (product.filePath.startsWith('/data/') 
                                                   ? `/api/files/${product.filePath.replace('/data/', '')}` 
                                                   : product.filePath)
                                                : null;
                                              
                                              const isProductImage = productImageUrl && isImageFile(product.filePath);
                                              
                                              return isProductImage ? (
                                                <div className="w-full aspect-square overflow-hidden rounded-md border">
                                                  <img
                                                    src={productImageUrl}
                                                    alt="Product thumbnail"
                                                    className="w-full h-full object-contain bg-white"
                                                    onError={(e) => {
                                                      e.currentTarget.style.display = 'none';
                                                      if (e.currentTarget.parentElement?.nextElementSibling) {
                                                        (e.currentTarget.parentElement.nextElementSibling as HTMLElement).style.display = 'flex';
                                                      }
                                                    }}
                                                  />
                                                </div>
                                              ) : (
                                                <div className="w-full aspect-square bg-gray-200 rounded-md border flex items-center justify-center">
                                                  <Package className="h-8 w-8 text-gray-400" />
                                                  <span className="sr-only">No image available</span>
                                                </div>
                                              );
                                            })()}
                                            <div className="hidden w-full aspect-square bg-gray-200 rounded-md border items-center justify-center">
                                              <Package className="h-8 w-8 text-gray-400" />
                                              <span className="sr-only">Image failed to load</span>
                                            </div>
                                          </div>

                                          {/* Price Card */}
                                          {product.onSale && product.price && (
                                            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                                              <h6 className="font-medium text-green-900 mb-3">Price</h6>
                                              <span className="text-2xl font-bold text-green-600">
                                                ${(product.price / 100).toFixed(2)}
                                              </span>
                                            </div>
                                          )}

                                          {/* Creator Information */}
                                          <div className="bg-gray-50 p-3 rounded-lg border">
                                            <h6 className="font-medium text-gray-900 mb-2">Creator</h6>
                                            <div className="space-y-1">
                                              <div className="flex justify-between">
                                                <span className="text-gray-600">Name:</span>
                                                <span className="font-medium text-gray-900">{product.userName}</span>
                                              </div>
                                              <div className="flex justify-between">
                                                <span className="text-gray-600">Email:</span>
                                                <span className="text-gray-700 text-sm">{product.userEmail}</span>
                                              </div>
                                              <div className="flex justify-between">
                                                <span className="text-gray-600">User ID:</span>
                                                <span className="font-mono text-gray-700 text-xs">{product.userId.slice(-8)}</span>
                                              </div>
                                            </div>
                                          </div>
                                          
                                          {/* Product Details */}
                                          <div className="bg-gray-50 p-3 rounded-lg border">
                                            <h6 className="font-medium text-gray-900 mb-2">Details</h6>
                                            <div className="space-y-1">
                                              <div className="flex justify-between">
                                                <span className="text-gray-600">Created:</span>
                                                <span className="text-gray-900">{new Date(product.createdAt).toLocaleDateString()}</span>
                                              </div>
                                              <div className="flex justify-between">
                                                <span className="text-gray-600">Updated:</span>
                                                <span className="text-gray-900">{new Date(product.updatedAt).toLocaleDateString()}</span>
                                              </div>
                                              <div className="flex justify-between">
                                                <span className="text-gray-600">Product ID:</span>
                                                <span className="font-mono text-gray-700 text-xs">{productId.slice(-8)}</span>
                                              </div>
                                            </div>
                                          </div>
                                        </div>

                                        {/* Product URL Section - Moved to bottom with better styling */}
                                        {product.url && product.url.trim() && (
                                          <div className="mt-4 p-4 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg shadow-md">
                                            <div className="flex items-center justify-between mb-3">
                                              <h6 className="font-semibold text-white text-lg">Visit Product</h6>
                                              <span className="bg-white/20 text-white px-2 py-1 rounded-full text-xs font-medium">
                                                External Link
                                              </span>
                                            </div>
                                            <a
                                              href={`${product.url}?ref=vision&visionId=${vision.id}&productId=${productId}`}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="block w-full bg-white text-blue-600 font-semibold py-3 px-4 rounded-lg hover:bg-blue-50 transition-colors text-center shadow-sm"
                                              onClick={async (e) => {
                                                // Track the click
                                                try {
                                                  await fetch('/api/track-click', {
                                                    method: 'POST',
                                                    headers: {
                                                      'Content-Type': 'application/json',
                                                    },
                                                    body: JSON.stringify({
                                                      visionId: vision.id,
                                                      productId: productId
                                                    })
                                                  });
                                                } catch (error) {
                                                  console.error('Failed to track click:', error);
                                                }
                                              }}
                                            >
                                              Open Product Page →
                                            </a>
                                          </div>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="text-gray-500 bg-gray-50 p-3 rounded-lg">
                                        <div className="flex items-center gap-2">
                                          <Hash className="h-4 w-4" />
                                          <span>Product ID: {productId.slice(-8)}</span>
                                        </div>
                                        <p className="text-sm mt-1">Loading product details...</p>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                <div className="flex items-center gap-2 text-sm text-gray-500">
                                  <Package className="h-4 w-4" />
                                  <span>{linkedProductsCount} linked products</span>
                                </div>
                                <ThreadPrimitive.Suggestion
                                  prompt={`show product ${productId} from vision ${vision.id}`}
                                  method="replace"
                                  autoSend={true}
                                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
                                >
                                  <Eye className="h-4 w-4" />
                                  View Full Product
                                </ThreadPrimitive.Suggestion>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                    
                    {linkedProductsCount > 5 && (
                      <div className="text-center pt-4 border-t border-gray-100">
                        <div className="bg-blue-50 p-4 rounded-lg">
                          <p className="text-blue-800 font-medium mb-2">
                            Showing top 5 of {linkedProductsCount} linked products
                          </p>
                          <ThreadPrimitive.Suggestion
                            prompt="list my products"
                            method="replace"
                            autoSend={true}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                          >
                            <Package className="h-4 w-4" />
                            View All {linkedProductsCount} Products
                          </ThreadPrimitive.Suggestion>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* Show matched text if available (for search results) */}
            {matchedText && matchedText !== vision.visionDescription && (
              <div>
                <h4 className="font-medium text-gray-900 mb-2">Matched Content</h4>
                <div className="bg-yellow-50 border-l-4 border-yellow-400 p-3 rounded-r">
                  <p className="text-sm text-yellow-800">{matchedText}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Show Vision UI Component - for displaying a single vision
type ShowVisionArgs = {
  visionId: string;
};

type ShowVisionResult = {
  type: "show_vision";
  vision: Vision;
  success: boolean;
  suppressOutput: true;
  ui: {
    type: "show_vision";
    title: string;
    description: string;
    vision: Vision;
  };
};

function ShowVisionToolUIComponent({ args, result, status }: { args: ShowVisionArgs; result?: ShowVisionResult; status: any }) {
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  // Add state to track support status locally
  const [supportCount, setSupportCount] = useState(0);
  const [isSupported, setIsSupported] = useState(false);
  const [productDetails, setProductDetails] = useState<{ [productId: string]: any }>({});
  const [loadingProducts, setLoadingProducts] = useState<{ [productId: string]: boolean }>({});
  
  // Add state for onSale toggle and price editing
  const [localOnSale, setLocalOnSale] = useState(false);
  const [localPrice, setLocalPrice] = useState("0.00");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Get current user ID on component mount
  React.useEffect(() => {
    const getCurrentUser = async () => {
      try {
        const response = await fetch('/api/auth/session');
        if (response.ok) {
          const session = await response.json();
          const userId = session?.user?.id || null;
          setCurrentUser(userId);
          
          // Initialize support status if we have vision data
          if (result?.vision) {
            setSupportCount(result.vision.supportCount || 0);
            setIsSupported(userId ? (result.vision.supportedBy || []).includes(userId) : false);
            // Initialize sale settings
            setLocalOnSale(result.vision.onSale || false);
            setLocalPrice(((result.vision.price || 0) / 100).toFixed(2));
          }
        }
      } catch (error) {
        console.error('Error getting current user:', error);
      }
    };
    getCurrentUser();
  }, [result?.vision]);

  // Function to fetch product details
  const fetchProductDetails = async (productId: string) => {
    if (productDetails[productId] || loadingProducts[productId]) {
      return; // Already fetched or currently loading
    }

    setLoadingProducts(prev => ({ ...prev, [productId]: true }));
    
    try {
      // Temporarily use debug endpoint to test functionality
      const response = await fetch(`/api/products/debug/${productId}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.product) {
          setProductDetails(prev => ({
            ...prev,
            [productId]: data.product
          }));
        }
      } else {
        console.error('Failed to fetch product details:', response.status);
      }
    } catch (error) {
      console.error('Error fetching product details:', error);
    } finally {
      setLoadingProducts(prev => ({ ...prev, [productId]: false }));
    }
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

  // Callback to handle support changes from SupportButton
  const handleSupportChange = (newSupportCount: number, newIsSupported: boolean) => {
    setSupportCount(newSupportCount);
    setIsSupported(newIsSupported);
  };

  // Add save function for onSale and price
  const handleSave = async () => {
    if (!currentUser || !result?.vision || currentUser !== result.vision.userId) {
      setSaveMessage("You can only edit your own visions");
      setTimeout(() => setSaveMessage(null), 3000);
      return;
    }

    setIsSaving(true);
    setSaveMessage(null);

    try {
      const response = await fetch('/api/update_vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          visionId: result.vision.id,
          onSale: localOnSale,
          price: Math.round(parseFloat(localPrice) * 100), // Convert to cents
        }),
      });

      if (response.ok) {
        setSaveMessage("Vision updated successfully!");
        // Update the vision object locally
        if (result.vision) {
          result.vision.onSale = localOnSale;
          result.vision.price = Math.round(parseFloat(localPrice) * 100);
        }
      } else {
        const errorData = await response.json();
        setSaveMessage(`Error: ${errorData.error || 'Failed to update vision'}`);
      }
    } catch (error) {
      console.error('Error saving vision:', error);
      setSaveMessage('Error: Failed to save changes');
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  if (status === 'in_progress' || status?.type === 'running' || !result) {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Loading Vision...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">Fetching vision details...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Only show error if we have a result but it failed
  if (result && (!result.success || !result.vision)) {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-red-600">
            <AlertCircle className="h-5 w-5" />
            Error Loading Vision
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-red-600">Failed to load vision details. Please try again.</p>
        </CardContent>
      </Card>
    );
  }

  const { vision, ui } = result;
  const fileUrl = getFileUrl(vision.filePath);
  const isImage = vision.filePath !== "/no-file" && isImageFile(vision.filePath);

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              {ui.title}
            </CardTitle>
            <CardDescription>
              {ui.description}
            </CardDescription>
          </div>
          <SupportButton
            visionId={vision.id}
            initialSupportCount={supportCount}
            initialIsSupported={isSupported}
            size="md"
            variant="outline"
            onSupportChange={handleSupportChange}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Vision Description */}
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">Vision Description</h3>
            <p className="text-gray-700 leading-relaxed">{vision.visionDescription}</p>
          </div>

          {/* Vision Details */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <h4 className="font-medium text-gray-900 flex items-center gap-2 mb-3">
                  <Calendar className="h-4 w-4" />
                  Timeline
                </h4>
                <div className="bg-gray-50 p-3 rounded border space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Created:</span>
                    <span className="text-gray-800">{new Date(vision.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Updated:</span>
                    <span className="text-gray-800">{new Date(vision.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-medium text-gray-900 flex items-center gap-2 mb-3">
                  <Hash className="h-4 w-4" />
                  Identifiers
                </h4>
                <div className="bg-gray-50 p-3 rounded border space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Vision ID:</span>
                    <span className="font-mono text-gray-800">{vision.id}</span>
                  </div>
                  {vision.vectorId && (
                    <div className="flex justify-between">
                      <span className="text-gray-600">Vector ID:</span>
                      <span className="font-mono text-gray-800">{vision.vectorId}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Sale Settings Section - HIDDEN */}
              {/*
              <div>
                <h4 className="font-medium text-gray-900 flex items-center gap-2 mb-3">
                  <Hash className="h-4 w-4" />
                  Sale Settings
                </h4>
                <div className="bg-gray-50 p-4 rounded-lg border space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-700">On Sale</span>
                    <button
                      onClick={() => setLocalOnSale(!localOnSale)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        localOnSale ? 'bg-blue-600' : 'bg-gray-200'
                      }`}
                      disabled={currentUser !== vision.userId}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          localOnSale ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  
                  {localOnSale && (
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Price</label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={localPrice}
                          onChange={(e) => setLocalPrice(e.target.value)}
                          className="w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                          disabled={currentUser !== vision.userId}
                        />
                      </div>
                    </div>
                  )}
                  
                  {currentUser === vision.userId && (
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isSaving ? 'Saving...' : 'Save Changes'}
                    </button>
                  )}
                  
                  {saveMessage && (
                    <div className={`text-sm p-2 rounded ${
                      saveMessage.includes('successfully') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {saveMessage}
                    </div>
                  )}
                </div>
              </div>
              */}

              {/* Price Display - Only show if vision is on sale - HIDDEN */}
              {/*
              {localOnSale && (
                <div>
                  <h4 className="font-medium text-gray-900 mb-3">Current Price</h4>
                  <div className="bg-green-50 p-3 rounded border border-green-200">
                    <span className="text-2xl font-bold text-green-600">
                      ${parseFloat(localPrice).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
              */}

              <div>
                <h4 className="font-medium text-gray-900 flex items-center gap-2 mb-3">
                  <User className="h-4 w-4" />
                  Creator Info
                </h4>
                <div className="bg-gray-50 p-3 rounded border space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Name:</span>
                    <span className="text-gray-800">{vision.userName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Email:</span>
                    <span className="text-gray-800">{vision.userEmail}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">User ID:</span>
                    <span className="font-mono text-gray-800">{vision.userId}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* File Display Section */}
            <div>
              <h4 className="font-medium text-gray-900 flex items-center gap-2 mb-3">
                <FileIcon className="h-4 w-4" />
                Attached File
              </h4>
              {isImage && fileUrl ? (
                <div className="border rounded-lg overflow-hidden">
                  <img 
                    src={fileUrl} 
                    alt="Vision attachment" 
                    className="w-full h-auto max-h-96 object-contain"
                  />
                </div>
              ) : fileUrl ? (
                <div className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border">
                  <FileText className="w-8 h-8 text-gray-600" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900">
                      {vision.filePath.split('/').pop()}
                    </p>
                    <p className="text-xs text-gray-500">File attachment</p>
                  </div>
                  <a 
                    href={fileUrl} 
                    download 
                    className="text-blue-600 hover:text-blue-800 transition-colors"
                  >
                    <Download className="w-5 h-5" />
                  </a>
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <FileIcon className="w-12 h-12 mx-auto mb-2" />
                  <p>No file attached</p>
                </div>
              )}
            </div>
          </div>

          {/* Linked Products Section */}
          {(() => {
            // Helper function to safely get linked products object
            const getLinkedProductsObject = (linkedProducts: any): { [productId: string]: number } => {
              // Handle old array format or missing field
              if (!linkedProducts || Array.isArray(linkedProducts)) {
                return {};
              }
              // Handle new object format
              if (typeof linkedProducts === 'object') {
                return linkedProducts;
              }
              return {};
            };

            // Helper function to safely get clicks object and calculate total
            const getClicksData = (clicks: any): { clicksObj: { [productId: string]: number }, totalClicks: number } => {
              if (!clicks || typeof clicks !== 'object') {
                return { clicksObj: {}, totalClicks: 0 };
              }
              const clicksObj = clicks;
              const totalClicks = Object.values(clicksObj).reduce((sum: number, count: any) => sum + (typeof count === 'number' ? count : 0), 0);
              return { clicksObj, totalClicks };
            };

            const linkedProductsObj = getLinkedProductsObject(vision.linkedProducts);
            const linkedProductsCount = Object.keys(linkedProductsObj).length;
            const { clicksObj, totalClicks } = getClicksData(vision.clicks);

            return linkedProductsCount > 0 && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                    <Package className="h-5 w-5 text-blue-600" />
                    Linked Products ({linkedProductsCount})
                  </h3>
                  <div className="bg-green-50 px-3 py-1 rounded-full border border-green-200">
                    <span className="text-sm font-medium text-green-800">
                      Total URL Clicks: {totalClicks}
                    </span>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="grid gap-4">
                    {Object.entries(linkedProductsObj)
                      .sort(([, scoreA], [, scoreB]) => scoreB - scoreA) // Sort by similarity score descending
                      .slice(0, 5) // Show top 5 products
                      .map(([productId, similarityScore], index) => {
                        const product = productDetails[productId];
                        const isLoading = loadingProducts[productId];
                        const productClicks = clicksObj[productId] || 0;
                        
                        // Trigger fetch if not already loaded
                        if (!product && !isLoading) {
                          fetchProductDetails(productId);
                        }

                        return (
                          <div key={productId} className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-lg transition-all duration-200">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex items-center gap-4 flex-1">
                                <div className="flex-1">
                                  <div className="flex items-center gap-3 mb-2">
                                    <Package className="h-5 w-5 text-blue-600" />
                                    <span className="font-semibold text-gray-900 text-lg">
                                      {product ? (product.productName || 'Product') : `Product ${productId.slice(-8)}`}
                                    </span>
                                    <span className="text-sm bg-green-100 text-green-700 px-3 py-1 rounded-full font-medium">
                                      {(similarityScore * 100).toFixed(1)}% match
                                    </span>
                                    {productClicks > 0 && (
                                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full font-medium">
                                        {productClicks} click{productClicks !== 1 ? 's' : ''} from this vision
                                      </span>
                                    )}
                                  </div>
                                  
                                  {isLoading ? (
                                    <div className="space-y-3">
                                      <div className="h-5 bg-gray-200 rounded animate-pulse"></div>
                                      <div className="h-4 bg-gray-200 rounded animate-pulse w-4/5"></div>
                                      <div className="h-4 bg-gray-200 rounded animate-pulse w-3/5"></div>
                                      <div className="flex gap-4 mt-3">
                                        <div className="h-3 bg-gray-200 rounded animate-pulse w-20"></div>
                                        <div className="h-3 bg-gray-200 rounded animate-pulse w-16"></div>
                                        <div className="h-3 bg-gray-200 rounded animate-pulse w-24"></div>
                                      </div>
                                    </div>
                                  ) : product ? (
                                    <div className="space-y-4">
                                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-4 rounded-lg border border-blue-200">
                                        <h5 className="font-semibold text-blue-900 mb-2 text-lg">
                                          {product.productName || 'Product'}
                                        </h5>
                                        <p className="text-gray-700 leading-relaxed text-base line-clamp-3">
                                          {product.productDescription}
                                        </p>
                                      </div>

                                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        {/* Product Image Thumbnail */}
                                        <div className="bg-gray-50 p-3 rounded-lg border">
                                          <h6 className="font-medium text-gray-900 mb-2">Product Image</h6>
                                          {(() => {
                                            const productImageUrl = product.filePath && product.filePath !== "/no-file" && product.filePath.trim() !== ""
                                              ? (product.filePath.startsWith('/data/') 
                                                 ? `/api/files/${product.filePath.replace('/data/', '')}` 
                                                 : product.filePath)
                                              : null;
                                            
                                            const isProductImage = productImageUrl && isImageFile(product.filePath);
                                            
                                            return isProductImage ? (
                                              <div className="w-full aspect-square overflow-hidden rounded-md border">
                                                <img
                                                  src={productImageUrl}
                                                  alt="Product thumbnail"
                                                  className="w-full h-full object-contain bg-white"
                                                  onError={(e) => {
                                                    e.currentTarget.style.display = 'none';
                                                    if (e.currentTarget.parentElement?.nextElementSibling) {
                                                      (e.currentTarget.parentElement.nextElementSibling as HTMLElement).style.display = 'flex';
                                                    }
                                                  }}
                                                />
                                              </div>
                                            ) : (
                                              <div className="w-full aspect-square bg-gray-200 rounded-md border flex items-center justify-center">
                                                <Package className="h-8 w-8 text-gray-400" />
                                                <span className="sr-only">No image available</span>
                                              </div>
                                            );
                                          })()}
                                          <div className="hidden w-full aspect-square bg-gray-200 rounded-md border items-center justify-center">
                                            <Package className="h-8 w-8 text-gray-400" />
                                            <span className="sr-only">Image failed to load</span>
                                          </div>
                                        </div>

                                        {/* Price Card */}
                                        {product.onSale && product.price && (
                                          <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                                            <h6 className="font-medium text-green-900 mb-3">Price</h6>
                                            <span className="text-2xl font-bold text-green-600">
                                              ${(product.price / 100).toFixed(2)}
                                            </span>
                                          </div>
                                        )}

                                        {/* Creator Information */}
                                        <div className="bg-gray-50 p-3 rounded-lg border">
                                          <h6 className="font-medium text-gray-900 mb-2">Creator</h6>
                                          <div className="space-y-1">
                                            <div className="flex justify-between">
                                              <span className="text-gray-600">Name:</span>
                                              <span className="font-medium text-gray-900">{product.userName}</span>
                                            </div>
                                            <div className="flex justify-between">
                                              <span className="text-gray-600">Email:</span>
                                              <span className="text-gray-700 text-sm">{product.userEmail}</span>
                                            </div>
                                            <div className="flex justify-between">
                                              <span className="text-gray-600">User ID:</span>
                                              <span className="font-mono text-gray-700 text-xs">{product.userId.slice(-8)}</span>
                                            </div>
                                          </div>
                                        </div>
                                        
                                        {/* Product Details */}
                                        <div className="bg-gray-50 p-3 rounded-lg border">
                                          <h6 className="font-medium text-gray-900 mb-2">Details</h6>
                                          <div className="space-y-1">
                                            <div className="flex justify-between">
                                              <span className="text-gray-600">Created:</span>
                                              <span className="text-gray-900">{new Date(product.createdAt).toLocaleDateString()}</span>
                                            </div>
                                            <div className="flex justify-between">
                                              <span className="text-gray-600">Updated:</span>
                                              <span className="text-gray-900">{new Date(product.updatedAt).toLocaleDateString()}</span>
                                            </div>
                                            <div className="flex justify-between">
                                              <span className="text-gray-600">Product ID:</span>
                                              <span className="font-mono text-gray-700 text-xs">{productId.slice(-8)}</span>
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                      {/* Product URL Section - Moved to bottom with better styling */}
                                      {product.url && product.url.trim() && (
                                        <div className="mt-4 p-4 bg-gradient-to-r from-blue-500 to-blue-600 rounded-lg shadow-md">
                                          <div className="flex items-center justify-between mb-3">
                                            <h6 className="font-semibold text-white text-lg">Visit Product</h6>
                                            <span className="bg-white/20 text-white px-2 py-1 rounded-full text-xs font-medium">
                                              External Link
                                            </span>
                                          </div>
                                          <a
                                            href={`${product.url}?ref=vision&visionId=${vision.id}&productId=${productId}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block w-full bg-white text-blue-600 font-semibold py-3 px-4 rounded-lg hover:bg-blue-50 transition-colors text-center shadow-sm"
                                            onClick={async (e) => {
                                              // Track the click
                                              try {
                                                await fetch('/api/track-click', {
                                                  method: 'POST',
                                                  headers: {
                                                    'Content-Type': 'application/json',
                                                  },
                                                  body: JSON.stringify({
                                                    visionId: vision.id,
                                                    productId: productId
                                                  })
                                                });
                                              } catch (error) {
                                                console.error('Failed to track click:', error);
                                              }
                                            }}
                                          >
                                            Open Product Page →
                                          </a>
                                        </div>
                                      )}
                                    </div>
                                  ) : (
                                    <div className="text-gray-500 bg-gray-50 p-3 rounded-lg">
                                      <div className="flex items-center gap-2">
                                        <Hash className="h-4 w-4" />
                                        <span>Product ID: {productId.slice(-8)}</span>
                                      </div>
                                      <p className="text-sm mt-1">Loading product details...</p>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                              <div className="flex items-center gap-2 text-sm text-gray-500">
                                <Package className="h-4 w-4" />
                                <span>{linkedProductsCount} linked products</span>
                              </div>
                              <ThreadPrimitive.Suggestion
                                prompt={`show product ${productId} from vision ${vision.id}`}
                                method="replace"
                                autoSend={true}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium text-sm"
                              >
                                <Eye className="h-4 w-4" />
                                View Full Product
                              </ThreadPrimitive.Suggestion>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                  
                  {linkedProductsCount > 5 && (
                    <div className="text-center pt-4 border-t border-gray-100">
                      <div className="bg-blue-50 p-4 rounded-lg">
                        <p className="text-blue-800 font-medium mb-2">
                          Showing top 5 of {linkedProductsCount} linked products
                        </p>
                        <ThreadPrimitive.Suggestion
                          prompt="list my products"
                          method="replace"
                          autoSend={true}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                        >
                          <Package className="h-4 w-4" />
                          View All {linkedProductsCount} Products
                        </ThreadPrimitive.Suggestion>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      </CardContent>
    </Card>
  );
}

export const ShowVisionToolUI = makeAssistantToolUI<
  ShowVisionArgs,
  ShowVisionResult
>({
  toolName: "show_vision",
  render: ShowVisionToolUIComponent,
});