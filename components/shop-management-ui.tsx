"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
// import { Label } from "@/components/ui/label";
// import { Badge } from "@/components/ui/badge"; 
// import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Store, Plus, ExternalLink, Calendar } from "lucide-react";
import { Shop, SHOP_PLATFORMS, ShopPlatform } from "@/types/shop";
import { makeAssistantToolUI, ThreadPrimitive } from "@assistant-ui/react";

interface ShopManagementUIProps {
  shops: Shop[];
}

export function ShopManagementUI({ shops }: ShopManagementUIProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    platform: "",
    name: "",
    url: ""
  });

  // Function to sanitize URL by removing query parameters and trailing slash
  const sanitizeUrl = (url: string): string => {
    if (!url) return url;
    
    try {
      // Parse the URL to handle it properly
      const urlObj = new URL(url);
      // Remove query parameters and hash
      urlObj.search = '';
      urlObj.hash = '';
      // Get the clean URL and remove trailing slash
      let cleanUrl = urlObj.toString();
      if (cleanUrl.endsWith('/') && cleanUrl.length > urlObj.origin.length + 1) {
        cleanUrl = cleanUrl.slice(0, -1);
      }
      return cleanUrl;
    } catch {
      // If URL parsing fails, fall back to simple string manipulation
      let cleanUrl = url.split('?')[0]; // Remove everything after ?
      cleanUrl = cleanUrl.split('#')[0]; // Remove everything after #
      // Remove trailing slash, but keep it if it's just the domain (e.g., https://example.com/)
      if (cleanUrl.endsWith('/') && cleanUrl.split('/').length > 3) {
        cleanUrl = cleanUrl.slice(0, -1);
      }
      return cleanUrl;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.platform || !formData.name || !formData.url) {
      return;
    }

    // Sanitize URL before submission
    const sanitizedFormData = {
      ...formData,
      url: sanitizeUrl(formData.url)
    };

    setIsSubmitting(true);
    try {
      const response = await fetch("/api/shops", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(sanitizedFormData),
      });

      if (response.ok) {
        // Reset form and hide it
        setFormData({ platform: "", name: "", url: "" });
        setShowAddForm(false);
        // Re-trigger the manage shops tool to refresh the list
        const reloadButton = document.getElementById('reload-shops-suggestion');
        if (reloadButton) {
          reloadButton.click();
        }
      } else {
        console.error("Failed to create shop");
      }
    } catch (error) {
      console.error("Error creating shop:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (date: Date | string) => {
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'short', 
      day: 'numeric' 
    });
  };

  const getPlatformIcon = (platform: string) => {
    // You could return different icons based on platform
    return <Store className="h-4 w-4" />;
  };

  if (showAddForm) {
    return (
      <div className="p-6 bg-white rounded-lg shadow-lg max-w-2xl mx-auto">
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Store className="h-5 w-5 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-800">Add New Shop</h2>
          </div>
          <p className="text-gray-600">Connect a new online shop to your VisionVerse account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="platform" className="text-sm font-medium text-gray-700">Platform</label>
            <select
              value={formData.platform}
              onChange={(e) => setFormData(prev => ({ ...prev, platform: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            >
              <option value="">Select a platform</option>
              {SHOP_PLATFORMS.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label htmlFor="name" className="text-sm font-medium text-gray-700">Shop Name</label>
            <Input
              id="name"
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Enter your shop name"
              required
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="url" className="text-sm font-medium text-gray-700">Shop URL</label>
            <Input
              id="url"
              type="url"
              value={formData.url}
              onChange={(e) => setFormData(prev => ({ ...prev, url: e.target.value }))}
              onBlur={(e) => {
                const sanitizedUrl = sanitizeUrl(e.target.value);
                setFormData(prev => ({ ...prev, url: sanitizedUrl }));
              }}
              placeholder="https://your-shop-url.com"
              required
            />
            <p className="text-xs text-gray-500 mt-1">
              💡 Query parameters (?...) and trailing slashes will be automatically removed
            </p>
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="submit"
              disabled={isSubmitting || !formData.platform || !formData.name || !formData.url}
              className="flex-1"
            >
              {isSubmitting ? "Creating..." : "Create Shop"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setShowAddForm(false)}
              className="flex-1"
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg max-w-4xl mx-auto">
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Store className="h-5 w-5 text-blue-600" />
            <h2 className="text-xl font-bold text-gray-800">Your Shops</h2>
          </div>
          <Button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add New Shop
          </Button>
        </div>
        <p className="text-gray-600">
          Manage your online shops and storefronts
        </p>
      </div>

      {shops.length === 0 ? (
        <Card className="text-center py-12">
          <CardContent>
            <Store className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <CardTitle className="text-gray-600 mb-2">No shops configured</CardTitle>
            <CardDescription className="mb-6">
              Add your first online shop to get started with VisionVerse commerce features
            </CardDescription>
            <Button onClick={() => setShowAddForm(true)} className="flex items-center gap-2 mx-auto">
              <Plus className="h-4 w-4" />
              Add Your First Shop
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {shops.map((shop) => (
            <Card key={shop.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-6">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="p-2 bg-blue-50 rounded-lg">
                      {getPlatformIcon(shop.platform)}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="font-semibold text-lg">{shop.name}</h3>
                        <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-full">{shop.platform}</span>
                      </div>
                      <p className="text-gray-600 mb-3">{shop.url}</p>
                      <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Calendar className="h-3 w-3" />
                        Added {formatDate(shop.createdAt)}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(shop.url, '_blank')}
                      className="flex items-center gap-2"
                    >
                      <ExternalLink className="h-3 w-3" />
                      Visit
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// Tool UI wrapper for the assistant
type ManageShopsArgs = {};

type ManageShopsResult = {
  type: "manage_shops";
  shops: Shop[];
  ui: {
    type: "manage_shops";
    title: string;
    description: string;
    shops: Shop[];
  };
};

export const ManageShopsToolUI = makeAssistantToolUI<
  ManageShopsArgs,
  ManageShopsResult
>({
  toolName: "manage_my_shops",
  render: ({ args, result, status }: { args: ManageShopsArgs; result?: ManageShopsResult; status: any }) => {
    if (status.type === "running") {
      return (
        <div className="flex items-center justify-center p-8">
          <div className="flex items-center gap-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span className="text-gray-600">Loading your shops...</span>
          </div>
        </div>
      );
    }

    if (!result) {
      return null;
    }

    return (
      <>
        <ShopManagementUI shops={result.shops} />
        {/* Hidden suggestion button to reload shops after creating a new one */}
        <ThreadPrimitive.Suggestion
          id="reload-shops-suggestion"
          prompt="manage my shops"
          method="replace"
          autoSend={true}
          style={{ display: 'none' }}
        />
      </>
    );
  },
}); 