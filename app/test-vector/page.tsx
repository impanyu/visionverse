"use client";

import { useState } from "react";

export default function TestVectorPage() {
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");

  // Test storing an embedding
  const testStore = async () => {
    setLoading(true);
    setStatus("Testing embedding storage...");
    
    try {
      const response = await fetch('/api/test-vector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'store',
          visionId: 'test-' + Date.now(),
          description: 'This is a test vision about artificial intelligence and machine learning',
          userId: 'test-user-123'
        })
      });
      
      const data = await response.json();
      setResults(data);
      setStatus("✅ Store test completed");
    } catch (error) {
      setResults({ error: error instanceof Error ? error.message : 'Unknown error' });
      setStatus("❌ Store test failed");
    }
    
    setLoading(false);
  };

  // Test searching
  const testSearch = async () => {
    setLoading(true);
    setStatus("Testing search...");
    
    try {
      const response = await fetch('/api/test-vector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'search',
          query: 'artificial intelligence',
          userId: 'test-user-123'
        })
      });
      
      const data = await response.json();
      setResults(data);
      setStatus("✅ Search test completed");
    } catch (error) {
      setResults({ error: error instanceof Error ? error.message : 'Unknown error' });
      setStatus("❌ Search test failed");
    }
    
    setLoading(false);
  };

  // Debug all embeddings
  const debugEmbeddings = async () => {
    setLoading(true);
    setStatus("Debugging embeddings...");
    
    try {
      const response = await fetch('/api/test-vector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'debug'
        })
      });
      
      const data = await response.json();
      setResults(data);
      setStatus("✅ Debug completed");
    } catch (error) {
      setResults({ error: error instanceof Error ? error.message : 'Unknown error' });
      setStatus("❌ Debug failed");
    }
    
    setLoading(false);
  };

  // Get stats
  const getStats = async () => {
    setLoading(true);
    setStatus("Getting stats...");
    
    try {
      const response = await fetch('/api/test-vector', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'stats'
        })
      });
      
      const data = await response.json();
      setResults(data);
      setStatus("✅ Stats retrieved");
    } catch (error) {
      setResults({ error: error instanceof Error ? error.message : 'Unknown error' });
      setStatus("❌ Stats failed");
    }
    
    setLoading(false);
  };

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <h1 className="text-3xl font-bold mb-6">Vector Database Test</h1>
      
      <div className="grid grid-cols-2 gap-4 mb-6">
        <button
          onClick={getStats}
          disabled={loading}
          className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
        >
          Get Stats
        </button>
        
        <button
          onClick={debugEmbeddings}
          disabled={loading}
          className="bg-purple-500 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded"
        >
          Debug All Embeddings
        </button>
        
        <button
          onClick={testStore}
          disabled={loading}
          className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded"
        >
          Test Store Embedding
        </button>
        
        <button
          onClick={testSearch}
          disabled={loading}
          className="bg-orange-500 hover:bg-orange-700 text-white font-bold py-2 px-4 rounded"
        >
          Test Search
        </button>
      </div>

      <div className="mb-4">
        <p className="text-lg font-semibold">Status: <span className={loading ? "text-yellow-600" : "text-gray-600"}>{status}</span></p>
      </div>

      {results && (
        <div className="bg-gray-100 p-4 rounded-lg">
          <h2 className="text-xl font-bold mb-2">Results:</h2>
          <pre className="whitespace-pre-wrap text-sm overflow-auto max-h-96">
            {JSON.stringify(results, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
} 