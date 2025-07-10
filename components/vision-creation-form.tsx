"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Upload, X, ImageIcon, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface VisionCreationFormProps {
  onSubmit: (data: { visionDescription: string; imageFile?: File; price?: number }) => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function VisionCreationForm({ onSubmit, onCancel, isLoading = false }: VisionCreationFormProps) {
  const [visionDescription, setVisionDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [price, setPrice] = useState("");
  const [dragActive, setDragActive] = useState(false);

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith("image/")) {
        setImageFile(file);
      }
    }
  }, []);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.type.startsWith("image/")) {
        setImageFile(file);
      }
    }
  }, []);

  const removeImage = useCallback(() => {
    setImageFile(null);
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (visionDescription.trim()) {
      const priceInCents = price ? Math.round(parseFloat(price) * 100) : undefined;
      onSubmit({
        visionDescription: visionDescription.trim(),
        imageFile: imageFile || undefined,
        price: priceInCents,
      });
    }
  }, [visionDescription, imageFile, price, onSubmit]);

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5" />
          Create Your Vision
        </CardTitle>
        <CardDescription>
          Describe your vision and optionally upload an image to help bring it to life. You can also specify a price if you want to sell or trade your vision.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Vision Description */}
          <div className="space-y-2">
            <label htmlFor="vision-description" className="text-sm font-medium">
              Vision Description *
            </label>
            <Textarea
              id="vision-description"
              placeholder="Describe your vision in detail. What do you want to create or achieve? Be as specific as possible..."
              value={visionDescription}
              onChange={(e) => setVisionDescription(e.target.value)}
              className="min-h-[120px] resize-none"
              disabled={isLoading}
            />
          </div>

          {/* Price Input */}
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
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                className="w-full pl-8 pr-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isLoading}
              />
            </div>
            <p className="text-xs text-gray-500">Set a price if you want to sell or trade this vision</p>
          </div>

          {/* Image Upload */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Supporting Image (Optional)
            </label>
            
            {!imageFile ? (
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                  dragActive
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50",
                  isLoading && "opacity-50 cursor-not-allowed"
                )}
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
              >
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleFileInput}
                  className="hidden"
                  id="image-upload"
                  disabled={isLoading}
                />
                <label
                  htmlFor="image-upload"
                  className={cn(
                    "cursor-pointer flex flex-col items-center gap-2",
                    isLoading && "cursor-not-allowed"
                  )}
                >
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium">Click to upload</span> or drag and drop
                  </div>
                  <div className="text-xs text-muted-foreground">
                    PNG, JPG, GIF up to 10MB
                  </div>
                </label>
              </div>
            ) : (
              <div className="relative border rounded-lg p-4 bg-muted/5">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0">
                    <ImageIcon className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{imageFile.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(imageFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={removeImage}
                    disabled={isLoading}
                    className="flex-shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onCancel}
              disabled={isLoading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!visionDescription.trim() || isLoading}
              className="flex-1"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Creating Vision...
                </>
              ) : (
                "Create Vision"
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
} 