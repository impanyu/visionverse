"use client";

import React, { useState, useEffect } from 'react';
import { Service } from '@/types/service';
import { CreateServiceResponse } from '@/types/service';
import { makeAssistantToolUI, useAssistantRuntime, ThreadPrimitive } from "@assistant-ui/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Upload, X, Briefcase, AlertCircle, FileText, Hash, User, Eye, Image, CheckCircle, Globe, ExternalLink } from "lucide-react";

// Service Form UI Component - for showing the form when user types "create service"
type ServiceFormArgs = {
  message: string;
};

type ServiceFormResult = {
  type: "service_creation_ui";
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

export const ServiceFormToolUI = makeAssistantToolUI<
  ServiceFormArgs,
  ServiceFormResult
>({
  toolName: "create_service_form",
  render: ({ args, result, status }: { args: ServiceFormArgs; result?: ServiceFormResult; status: any }) => {
    const [formData, setFormData] = useState({
      serviceDescription: "",
      address: "" as string,
      imageFile: null as File | null,
      url: "" as string,
      price: "" as string,
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitResult, setSubmitResult] = useState<any>(null);
    const [aiHandled, setAiHandled] = useState(false);

    const runtime = useAssistantRuntime();

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const { name, value } = e.target;
      setFormData(prev => ({
        ...prev,
        [name]: value
      }));
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0] || null;
      setFormData(prev => ({
        ...prev,
        imageFile: file
      }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setIsSubmitting(true);
      setSubmitResult(null);
      setAiHandled(false);

      try {
        console.log('📝 FORM SUBMISSION: Service creation form submitted');
        console.log('🔍 Form data:', {
          serviceDescription: formData.serviceDescription,
          hasFile: !!formData.imageFile,
          fileName: formData.imageFile?.name,
          url: formData.url,
          price: formData.price
        });

        // Always create service when using this form (form was triggered by create_service_form tool)
        const hasUrl = formData.url.trim().length > 0;
        const isServiceCreation = true; // This form is specifically for service creation
        
        console.log('🔀 ROUTING DECISION: CREATE SERVICE (service creation form)', hasUrl ? 'with URL' : 'without URL');
        
        // Create FormData for file upload
        const formDataToSend = new FormData();
        
        // Always create service in this form
        formDataToSend.append("serviceDescription", formData.serviceDescription);
        if (formData.address.trim()) {
          formDataToSend.append("address", formData.address.trim());
        }
        if (hasUrl) {
          formDataToSend.append("url", formData.url.trim());
        }
        if (formData.price.trim()) {
          formDataToSend.append("price", formData.price.trim());
        }
        
        // Add image file if provided
        if (formData.imageFile) {
          formDataToSend.append("imageFile", formData.imageFile);
        }

        // Call appropriate API endpoint (always service creation for this form)
        const apiEndpoint = "/api/create_service";
        
        console.log(`🌐 API CALL: Submitting to ${apiEndpoint}`);
        const response = await fetch(apiEndpoint, {
          method: "POST", 
          body: formDataToSend,
        });

        console.log(`📡 API RESPONSE: ${response.status} ${response.statusText}`);
        
        if (!response.ok) {
          const errorText = await response.text();
          console.error('❌ API Error:', errorText);
          throw new Error(`Failed to create service: ${errorText}`);
        }

        const data = await response.json();
        console.log('✅ API Success:', data);
        
        // Fetch updated service list since we always create services in this form
        try {
          // Service was created - fetch service list
          const serviceListResponse = await fetch("/api/create_service", {
            method: "GET",
            credentials: "include",
          });
          
          if (serviceListResponse.ok) {
            const serviceListData = await serviceListResponse.json();
            
            // Set the result to include the service list
            setSubmitResult({
              ...data,
              services: serviceListData.services || [],
              type: 'service'
            });
          } else {
            // If service list fetch fails, just show the success message
            setSubmitResult({...data, type: 'service'});
          }
        } catch (listError) {
          console.error("Error fetching service list:", listError);
          // If list fetch fails, just show the success message
          setSubmitResult({...data, type: 'service'});
        }

        // Reset form
        setFormData({
          serviceDescription: "",
          imageFile: null,
          url: "",
          price: "",
        });

        // Clear file input
        const fileInput = document.getElementById('imageFile') as HTMLInputElement;
        if (fileInput) {
          fileInput.value = '';
        }

        // Service created successfully - show success message
        console.log("✅ SERVICE CREATED: Form submission successful");
        setAiHandled(true);

      } catch (error) {
        console.error('❌ FORM ERROR:', error);
        setSubmitResult({
          success: false,
          message: error instanceof Error ? error.message : "Unknown error occurred"
        });
      } finally {
        setIsSubmitting(false);
      }
    };

    if (status.type === "running") {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading service creation form...</span>
          </div>
        </div>
      );
    }

    if (!result) {
      return null;
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

    // Show success message and service list together (like products)
    if (submitResult) {
      const isService = true; // This is always a service form
      const item = submitResult.service;
      const fileUrl = getFileUrl(item?.filePath || '');
      const isImage = item?.filePath !== "/no-file" && isImageFile(item?.filePath || '');
      const services = (submitResult as any).services || [];

      return (
        <div className="p-6 bg-white rounded-lg shadow-lg max-w-4xl mx-auto">
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-3 h-3 bg-gradient-to-r from-emerald-400 to-green-500 rounded-full shadow-sm"></div>
              <h2 className="text-xl font-bold text-gray-800">
                Service Created Successfully!
              </h2>
            </div>
            
            {/* Created Service Display */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <h3 className="font-semibold text-green-800 mb-2">
                New Service:
              </h3>
              <p className="text-gray-700 mb-2">
                {item?.serviceDescription}
              </p>
              
              {item?.url && item.url.trim() && (
                <p className="text-sm text-gray-600 mb-2">
                  URL: <a href={item.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{item.url}</a>
                </p>
              )}

              {item?.price && (
                <p className="text-sm text-gray-600 mb-2">
                  Price: ${(item.price / 100).toFixed(2)}
                </p>
              )}
              
              {isImage && fileUrl && (
                <div className="mt-2">
                  <img 
                    src={fileUrl} 
                    alt="Service" 
                    className="max-w-xs h-auto rounded-lg shadow-sm"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Services List */}
          <div>
            <h3 className="text-lg font-semibold text-gray-800 mb-4">
              All My Services ({services.length})
            </h3>
            
            {services.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p>No services found.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {services.map((service: Service) => (
                  <ExpandableServiceCard 
                    key={service.id} 
                    service={service}
                    isNewlyCreated={service.id === submitResult.service.id}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="mt-6 flex gap-3">
            <ThreadPrimitive.Suggestion
              prompt="Create a new service"
              method="replace"
              autoSend={true}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Create Another Service
            </ThreadPrimitive.Suggestion>
            
            <ThreadPrimitive.Suggestion
              prompt="list my services"
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

    // Initial form render
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5" />
            {result.ui_components.title}
          </CardTitle>
          <CardDescription>
            Describe your service and optionally add a service URL for additional information.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="serviceDescription" className="text-sm font-medium">
                Service Description
              </label>
              <textarea
                id="serviceDescription"
                name="serviceDescription"
                value={formData.serviceDescription}
                onChange={handleInputChange}
                className="w-full p-3 border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Describe your service in detail..."
                required
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="address" className="text-sm font-medium text-gray-700">
                Service Address
              </label>
              <input
                type="text"
                id="address"
                name="address"
                value={formData.address}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="123 Main Street, City, State, Country"
                required
              />
              <p className="text-xs text-gray-500">
                📍 <strong>Location:</strong> Enter the address where this service is provided
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="url" className="text-sm font-medium text-gray-700">
                Service URL (Optional)
              </label>
              <input
                type="url"
                id="url"
                name="url"
                value={formData.url}
                onChange={handleInputChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/service-page"
              />
              <p className="text-xs text-gray-500">
                💡 <strong>Tip:</strong> Add a URL to link to an existing service page, or leave empty for a custom service
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="price" className="text-sm font-medium text-gray-700">
                Price (Optional)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">$</span>
                <input
                  type="number"
                  id="price"
                  name="price"
                  value={formData.price}
                  onChange={handleInputChange}
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="0.00"
                  min="0"
                  step="0.01"
                />
              </div>
              <p className="text-xs text-gray-500">
                💰 <strong>Tip:</strong> Enter the price in dollars (e.g., 19.99)
              </p>
            </div>

            <div className="space-y-2">
              <label htmlFor="imageFile2" className="text-sm font-medium">
                Service Image (Optional)
              </label>
              <div className="flex items-center space-x-2">
                <input
                  id="imageFile2"
                  type="file"
                  onChange={handleFileChange}
                  accept="image/*"
                  className="hidden"
                />
                <label
                  htmlFor="imageFile2"
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

            <Button
              type="submit"
              disabled={isSubmitting || !formData.serviceDescription.trim()}
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white py-2 px-4 rounded-md hover:from-indigo-600 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-md hover:shadow-lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Service...
                </>
              ) : (
                "Create Service"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  },
});

// Service Created With List UI Component
type ServiceCreatedWithListArgs = {
  title: string;
  description: string;
  service: Service;
  services: Service[];
};

type ServiceCreatedWithListResult = {
  type: "service_created_with_list";
  title: string;
  description: string;
  service: Service;
  services: Service[];
};

export const ServiceCreatedWithListToolUI = makeAssistantToolUI<
  ServiceCreatedWithListArgs,
  ServiceCreatedWithListResult
>({
  toolName: "service_created_with_list",
  render: ({ args, result, status }: { args: ServiceCreatedWithListArgs; result?: ServiceCreatedWithListResult; status: any }) => {
    if (status.type === "running") {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading service...</span>
          </div>
        </div>
      );
    }

    if (!result) {
      return null;
    }

    const { title, description, service, services } = result;

    return (
      <div className="space-y-6">
        {/* Success message */}
        <Card className="border-green-200 bg-green-50">
          <CardHeader>
            <CardTitle className="text-green-800 flex items-center gap-2">
              <CheckCircle className="w-5 h-5" />
              {title}
            </CardTitle>
            <CardDescription className="text-green-700">
              {description}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <h4 className="font-semibold text-green-800 mb-2">New Service:</h4>
              <p className="text-green-700">{service.serviceDescription}</p>
              {service.price && (
                <p className="text-green-600 text-sm mt-1">
                  Price: ${(service.price / 100).toFixed(2)}
                </p>
              )}
              {service.url && (
                <p className="text-green-600 text-sm mt-1">
                  <a href={service.url} target="_blank" rel="noopener noreferrer" className="underline">
                    View Service Page
                  </a>
                </p>
              )}
            </div>
            
            {service.filePath && service.filePath !== '/no-file' && (
              <div>
                <h4 className="font-semibold text-green-800 mb-2">Service Image:</h4>
                <img 
                  src={`/api/files${service.filePath.replace('/data/', '/')}`}
                  alt="Service"
                  className="max-w-sm rounded-lg shadow-sm"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Services List */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Briefcase className="w-5 h-5" />
              Your Services ({services.length})
            </CardTitle>
            <CardDescription>
              All your created services
            </CardDescription>
          </CardHeader>
          <CardContent>
            {services.length === 0 ? (
              <p className="text-gray-500 text-center py-8">No services found.</p>
            ) : (
              <div className="grid gap-4">
                {services.map((svc) => (
                  <div key={svc.id} className="border rounded-lg p-4 hover:bg-gray-50">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">
                          {svc.serviceDescription.substring(0, 100)}
                          {svc.serviceDescription.length > 100 ? '...' : ''}
                        </h3>
                        <div className="flex items-center gap-4 mt-2 text-sm text-gray-500">
                          <span>Created: {new Date(svc.createdAt).toLocaleDateString()}</span>
                          {svc.price && (
                            <span className="text-green-600 font-medium">
                              ${(svc.price / 100).toFixed(2)}
                            </span>
                          )}
                        </div>
                        {svc.url && (
                          <a 
                            href={svc.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 text-sm mt-1 inline-flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            View Service Page
                          </a>
                        )}
                      </div>
                      {svc.filePath && svc.filePath !== '/no-file' && (
                        <div className="ml-4">
                          <img 
                            src={`/api/files${svc.filePath.replace('/data/', '/')}`}
                            alt="Service"
                            className="w-16 h-16 object-cover rounded"
                          />
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  },
});

// Services List UI Component
type ServicesListArgs = {
  title: string;
  description: string;
  services: Service[];
};

type ServicesListResult = {
  type: "services_list";
  title: string;
  description: string;
  services: Service[];
  success: boolean;
  suppressOutput: true;
  ui: {
    type: "services_list";
    title: string;
    description: string;
    services: Service[];
    pagination?: {
      total: number;
      skip: number;
      limit: number;
      hasMore: boolean;
    };
  };
};

// Expandable Service Card Component
interface ExpandableServiceCardProps {
  service: Service;
  isNewlyCreated?: boolean;
}

function ExpandableServiceCard({ service, isNewlyCreated = false }: ExpandableServiceCardProps) {
  const [isExpanded, setIsExpanded] = useState(isNewlyCreated);
  
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

  const fileUrl = getFileUrl(service.filePath);
  const isImage = service.filePath !== "/no-file" && isImageFile(service.filePath);

  return (
    <div className={`border rounded-lg p-4 transition-all duration-200 ${
      isNewlyCreated ? 'border-green-300 bg-green-50' : 'border-gray-200 hover:border-gray-300'
    }`}>
      {/* Collapsed View */}
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-800 line-clamp-1">
              {service.serviceDescription.length > 100 
                ? `${service.serviceDescription.substring(0, 100)}...` 
                : service.serviceDescription}
            </h3>
            {isNewlyCreated && (
              <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded">
                New
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-4 text-sm text-gray-600">
            <span>Created: {new Date(service.createdAt).toLocaleDateString()}</span>
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
            prompt={`show service ${service.id}`}
            method="replace"
            autoSend={true}
            className="px-3 py-1 text-sm bg-gradient-to-r from-cyan-100 to-blue-100 text-cyan-700 hover:from-cyan-200 hover:to-blue-200 rounded transition-all duration-200 shadow-sm hover:shadow-md"
          >
            View Details
          </ThreadPrimitive.Suggestion>
          
          <ThreadPrimitive.Suggestion
            prompt={`delete service ${service.id}`}
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
              <h4 className="font-semibold text-gray-800 mb-2">Service Details</h4>
              <p className="text-gray-700 mb-3">{service.serviceDescription}</p>
              
              <div className="space-y-1 text-sm text-gray-600">
                <p><strong>Service ID:</strong> {service.id}</p>
                {service.url && service.url.trim() && (
                  <p><strong>URL:</strong> 
                    <a 
                      href={service.url} 
                      target="_blank" 
                      rel="noopener noreferrer" 
                      className="ml-2 inline-flex items-center gap-1 px-3 py-1 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg hover:from-emerald-600 hover:to-teal-700 transition-all duration-200 font-medium text-sm shadow-md hover:shadow-lg"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Visit Service
                    </a>
                  </p>
                )}
                {service.price && (
                  <p><strong>Price:</strong> ${(service.price / 100).toFixed(2)}</p>
                )}
                <p><strong>Created:</strong> {new Date(service.createdAt).toLocaleString()}</p>
                <p><strong>Updated:</strong> {new Date(service.updatedAt).toLocaleString()}</p>
              </div>
            </div>

            <div>
              {isImage && fileUrl ? (
                <div>
                  <h4 className="font-semibold text-gray-800 mb-2">Service Image</h4>
                  <img 
                    src={fileUrl} 
                    alt="Service" 
                    className="w-full max-w-sm h-auto rounded-lg shadow-sm"
                  />
                </div>
              ) : (
                <div className="text-center py-8 text-gray-400">
                  <div className="text-4xl mb-2">💼</div>
                  <p>No image available</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ServicesListToolUIComponent({ args, result, status }: { args: ServicesListArgs; result?: ServicesListResult; status: any }) {
  if (status.type === "running") {
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            Loading Your Services...
          </CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (result?.ui && result.ui.type === "services_list") {
    const { ui } = result;
    const services = ui.services || [];
    const title = ui.title || "My Services";
    const description = ui.description || "Your services";
    
    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="h-5 w-5" />
            {title}
          </CardTitle>
          <CardDescription>
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-gray-400 text-6xl mb-4">💼</div>
              <h3 className="text-lg font-semibold text-gray-600 mb-2">No Services Yet</h3>
              <p className="text-gray-500 mb-6">Create your first service to get started!</p>
            </div>
          ) : (
            <div className="space-y-4">
              {services.map((service: Service) => (
                <ExpandableServiceCard 
                  key={service.id} 
                  service={service}
                />
              ))}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-6 flex gap-3">
            <ThreadPrimitive.Suggestion
              prompt="Create a new service"
              method="replace"
              autoSend={true}
              className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              Create New Service
            </ThreadPrimitive.Suggestion>
            
            <ThreadPrimitive.Suggestion
              prompt="list my services"
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

export const ServicesListToolUI = makeAssistantToolUI<
  ServicesListArgs,
  ServicesListResult
>({
  toolName: "list_my_services",
  render: ServicesListToolUIComponent,
});

// Service Deleted With List UI Component  
type ServiceDeletedWithListArgs = {
  title: string;
  description: string;
  services: Service[];
};

type ServiceDeletedWithListResult = {
  type: "service_deleted_with_list";
  deletedId: string;
  success: boolean;
  services: Service[];
  suppressOutput: true;
  ui: {
    type: "service_deleted_with_list" | "error_card";
    title: string;
    description: string;
    deletedId?: string;
    services?: Service[];
  };
};

export const ServiceDeletedWithListToolUI = makeAssistantToolUI<
  ServiceDeletedWithListArgs,
  ServiceDeletedWithListResult
>({
  toolName: "delete_service",
  render: ({ args, result, status }: { args: ServiceDeletedWithListArgs; result?: ServiceDeletedWithListResult; status: any }) => {
    if (status.type === "running") {
      return (
        <Card className="w-full max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin" />
              Deleting Service...
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
      
      if (ui.type === "service_deleted_with_list") {
        const services = ui.services || [];
        
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
              {services.length === 0 ? (
                <div className="text-center py-12">
                  <div className="text-gray-400 text-6xl mb-4">💼</div>
                  <h3 className="text-lg font-semibold text-gray-600 mb-2">No Services Remaining</h3>
                  <p className="text-gray-500 mb-6">All services have been deleted. Create a new one to get started!</p>
                  
                  <ThreadPrimitive.Suggestion
                    prompt="Create a new service"
                    method="replace"
                    autoSend={true}
                    className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    Create New Service
                  </ThreadPrimitive.Suggestion>
                </div>
              ) : (
                <div className="space-y-4">
                  {services.map((service: Service) => (
                    <ExpandableServiceCard 
                      key={service.id} 
                      service={service}
                    />
                  ))}
                </div>
              )}

              {/* Action Buttons */}
              <div className="mt-6 flex gap-3">
                <ThreadPrimitive.Suggestion
                  prompt="Create a new service"
                  method="replace"
                  autoSend={true}
                  className="px-4 py-2 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:from-indigo-600 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
                >
                  Create New Service
                </ThreadPrimitive.Suggestion>
                
                <ThreadPrimitive.Suggestion
                  prompt="list my services"
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

// Show Service UI Component
type ShowServiceArgs = {
  title: string;
  description: string;
  service: Service;
};

type ShowServiceResult = {
  type: "show_service";
  title: string;
  description: string;
  service: Service;
};

export const ShowServiceToolUI = makeAssistantToolUI<
  ShowServiceArgs,
  ShowServiceResult
>({
  toolName: "show_service",
  render: ({ args, result, status }: { args: ShowServiceArgs; result?: ShowServiceResult; status: any }) => {
    if (status.type === "running") {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading service details...</span>
          </div>
        </div>
      );
    }

    if (!result) {
      return null;
    }

    const { title, description, service } = result;

    return (
      <Card className="w-full max-w-4xl mx-auto">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Briefcase className="w-5 h-5" />
            {title}
          </CardTitle>
          <CardDescription>
            {description}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Service Details */}
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Service Description</h3>
              <p className="text-gray-700 leading-relaxed">{service.serviceDescription}</p>
            </div>

            {/* Service Image */}
            {service.filePath && service.filePath !== '/no-file' && (
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Service Image</h3>
                <img 
                  src={`/api/files${service.filePath.replace('/data/', '/')}`}
                  alt="Service"
                  className="max-w-md rounded-lg shadow-lg"
                />
              </div>
            )}

            {/* Service Details Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
              <div>
                <strong className="text-gray-700">Service ID:</strong>
                <p className="text-gray-600 font-mono text-sm">{service.id}</p>
              </div>
              <div>
                <strong className="text-gray-700">Created By:</strong>
                <p className="text-gray-600">{service.userName}</p>
              </div>
              <div>
                <strong className="text-gray-700">Created:</strong>
                <p className="text-gray-600">{new Date(service.createdAt).toLocaleString()}</p>
              </div>
              <div>
                <strong className="text-gray-700">Last Updated:</strong>
                <p className="text-gray-600">{new Date(service.updatedAt).toLocaleString()}</p>
              </div>
              {service.price && (
                <div>
                  <strong className="text-gray-700">Price:</strong>
                  <p className="text-green-600 font-semibold">${(service.price / 100).toFixed(2)}</p>
                </div>
              )}
              {service.url && (
                <div>
                  <strong className="text-gray-700">Service URL:</strong>
                  <a 
                    href={service.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View Service Page
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3 pt-4 border-t">
            <ThreadPrimitive.Suggestion
              prompt="list my services"
              method="replace"
              autoSend={true}
              asChild
            >
              <Button variant="outline">
                <Briefcase className="w-4 h-4 mr-2" />
                View All Services
              </Button>
            </ThreadPrimitive.Suggestion>
            
            <ThreadPrimitive.Suggestion
              prompt="create a service"
              method="replace"
              autoSend={false}
              asChild
            >
              <Button variant="outline">
                <Briefcase className="w-4 h-4 mr-2" />
                Create New Service
              </Button>
            </ThreadPrimitive.Suggestion>
          </div>
        </CardContent>
      </Card>
    );
  },
});