import React, { useState } from 'react';

export function DebugFileUpload() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<string>('');

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      console.log('File selected:', {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified
      });
    } else {
      setSelectedFile(null);
    }
  };

  const testUpload = async () => {
    if (!selectedFile) {
      setUploadResult('No file selected');
      return;
    }

    try {
      console.log('🔍 FRONTEND DEBUG: Selected file details:', {
        name: selectedFile.name,
        size: selectedFile.size,
        type: selectedFile.type,
        lastModified: selectedFile.lastModified,
        instanceof: selectedFile instanceof File
      });

      const formData = new FormData();
      formData.append('productDescription', 'Test file upload debug');
      formData.append('url', 'https://example.com');
      formData.append('imageFile', selectedFile);

      console.log('🔍 FRONTEND DEBUG: FormData entries before upload:');
      for (const [key, value] of formData.entries()) {
        if (value instanceof File) {
          console.log(`  ${key}: File(name="${value.name}", size=${value.size}, type="${value.type}")`);
        } else {
          console.log(`  ${key}: "${value}"`);
        }
      }

      console.log('🚀 FRONTEND DEBUG: Starting upload request...');

      const response = await fetch('/api/create_product', {
        method: 'POST',
        credentials: 'include', // Ensure cookies/auth are included
        body: formData,
      });

      console.log('📨 FRONTEND DEBUG: Response status:', response.status);
      console.log('📨 FRONTEND DEBUG: Response headers:', Object.fromEntries(response.headers.entries()));

      if (response.ok) {
        const result = await response.json();
        console.log('✅ FRONTEND DEBUG: Success response:', result);
        setUploadResult(`Success! Product created with file path: ${result.product?.filePath || 'unknown'}`);
      } else {
        const error = await response.text();
        console.log('❌ FRONTEND DEBUG: Error response:', error);
        setUploadResult(`Error: ${error}`);
      }
    } catch (error) {
      setUploadResult(`Exception: ${error}`);
    }
  };

  return (
    <div className="p-6 bg-gray-100 border rounded-lg max-w-md">
      <h3 className="text-lg font-bold mb-4">Debug File Upload</h3>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">
            Select Image File:
          </label>
          <input
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </div>

        {selectedFile && (
          <div className="p-3 bg-white rounded border">
            <p className="text-sm"><strong>File:</strong> {selectedFile.name}</p>
            <p className="text-sm"><strong>Size:</strong> {Math.round(selectedFile.size / 1024)} KB</p>
            <p className="text-sm"><strong>Type:</strong> {selectedFile.type}</p>
          </div>
        )}

        <button
          onClick={testUpload}
          disabled={!selectedFile}
          className="w-full py-2 px-4 bg-blue-600 text-white rounded disabled:bg-gray-400 disabled:cursor-not-allowed hover:bg-blue-700"
        >
          Test Upload
        </button>

        {uploadResult && (
          <div className="p-3 bg-white border rounded">
            <p className="text-sm">{uploadResult}</p>
          </div>
        )}
      </div>
    </div>
  );
} 