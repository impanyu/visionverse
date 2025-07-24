#!/bin/bash

echo "🚀 Starting VisionVerse Services..."

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Function to check if a port is in use
port_in_use() {
    lsof -i :$1 >/dev/null 2>&1
}

echo "📋 Checking prerequisites..."

# Check if MongoDB is installed
if ! command_exists mongod; then
    echo "❌ MongoDB not found. Please install MongoDB first."
    exit 1
fi

# Check if Node.js is installed
if ! command_exists node; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi

# Check if Python 3 is installed
if ! command_exists python3; then
    echo "❌ Python 3 not found. Please install Python 3 first."
    exit 1
fi

echo "✅ All prerequisites found"

# Start MongoDB
echo "🗄️ Starting MongoDB..."
if port_in_use 27017; then
    echo "✅ MongoDB already running on port 27017"
else
    # Create MongoDB directories if they don't exist
    sudo mkdir -p /usr/local/var/mongodb
    sudo mkdir -p /usr/local/var/log/mongodb
    sudo chown $(whoami) /usr/local/var/mongodb
    sudo chown $(whoami) /usr/local/var/log/mongodb
    
    mongod --dbpath /usr/local/var/mongodb --logpath /usr/local/var/log/mongodb/mongo.log --fork
    echo "✅ MongoDB started"
fi

# Start Chroma Vector Database
echo "🔍 Starting Chroma Vector Database..."
if port_in_use 8000; then
    echo "✅ Chroma already running on port 8000"
else
    # Find chroma executable
    CHROMA_PATH="/Users/$(whoami)/Library/Python/3.9/bin/chroma"
    if [ -f "$CHROMA_PATH" ]; then
        nohup $CHROMA_PATH run --host localhost --port 8000 > chroma.log 2>&1 &
        echo "✅ Chroma started"
    else
        echo "❌ Chroma not found at $CHROMA_PATH"
        echo "💡 Install with: pip3 install chromadb"
        exit 1
    fi
fi

# Start Next.js
echo "🌐 Starting Next.js..."
if port_in_use 3000; then
    echo "✅ Next.js already running on port 3000"
else
    npm run dev &
    echo "✅ Next.js starting..."
fi

echo ""
echo "🎉 All services started!"
echo ""
echo "📋 Service Status:"
echo "   🌐 Next.js:     http://localhost:3000"
echo "   🔍 Chroma:      http://localhost:8000" 
echo "   🗄️ MongoDB:     localhost:27017"
echo ""
echo "🧪 Debug Page:   http://localhost:3000/debug-upload"
echo ""
echo "🔧 To stop services:"
echo "   pkill -f 'next dev'"
echo "   pkill -f 'chroma run'"
echo "   pkill mongod" 