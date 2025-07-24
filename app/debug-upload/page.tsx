"use client";

import { DebugFileUpload } from "@/components/debug-file-upload";

export default function DebugUploadPage() {
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-2xl font-bold mb-8">File Upload Debug Page</h1>
      <DebugFileUpload />
    </div>
  );
} 