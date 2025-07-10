# Visionverse
An App for trading product idea, description of service, complaint, and etc

This is the [assistant-ui](https://github.com/Yonom/assistant-ui) starter project.

## Getting Started

First, add your OpenAI API key and MongoDB connection string to `.env.local` file:

```
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
MONGODB_URI=mongodb://localhost:27017/visionverse
```

For MongoDB Atlas (cloud), use:
```
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/visionverse
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## New Features

### Create Vision API Endpoint
The application now includes a `create_vision` API endpoint that allows authenticated users to create and store vision records in MongoDB.

**Key Features:**
- Secure JWT authentication
- MongoDB storage with proper data validation
- TypeScript support with full type safety
- Pagination support for retrieving visions
- User context automatically included in records

**Usage:**
```typescript
import { createVision } from "@/lib/api/visions";

const newVision = await createVision({
  visionDescription: "A mobile app for tracking fitness goals",
  filePath: "/uploads/app-mockup.png"
});
```

For detailed API documentation, see [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).
