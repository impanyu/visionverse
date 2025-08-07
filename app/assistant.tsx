"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { Separator } from "@/components/ui/separator";
import { EnhancedThread } from "@/components/enhanced-thread";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LogOut, User, Plus, Package, Briefcase } from "lucide-react";
import { useState, useEffect } from "react";
import { useThread, useComposer, ThreadPrimitive } from "@assistant-ui/react";
import { VisionCreationToolUI, VisionCreationDirectToolUI, ListMyVisionsToolUI, SearchMyVisionsToolUI, SearchAllVisionsToolUI, DeleteVisionWithListToolUI, VisionCreatedWithListToolUI, VisionDuplicateFoundToolUI, ShowVisionToolUI } from "@/components/vision-creation-tool-ui";
import { 
  ProductFormToolUI, 
  ProductCreatedWithListToolUI, 
  ProductsListToolUI, 
  ProductDeletedWithListToolUI,
  ShowProductToolUI 
} from "@/components/product-tool-ui";
import { 
  ServiceFormToolUI, 
  ServiceCreatedWithListToolUI, 
  ServicesListToolUI, 
  ServiceDeletedWithListToolUI,
  ShowServiceToolUI 
} from "@/components/service-tool-ui";

import { ProductSearchToolUI } from "@/components/product-search-ui";

function ThreadWrapper({ onUserMessageChange }: { onUserMessageChange: (message: string) => void }) {
  const { messages = [] } = useThread() || {};

  // Add debugging for message changes
  useEffect(() => {
    console.log('🎯 ThreadWrapper: Messages changed, count:', messages.length);
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      console.log('🎯 ThreadWrapper: Last message:', {
        role: lastMessage.role,
        content: typeof lastMessage.content === 'string' ? lastMessage.content : 'complex content',
        timestamp: new Date().toISOString()
      });
    }
  }, [messages]);

  useEffect(() => {
    const lastUserMessage = messages
      .slice()
      .reverse()
      .find((msg: any) => msg.role === "user");
    
    if (lastUserMessage) {
      // Handle different content formats
      let content = "";
      if (typeof lastUserMessage.content === "string") {
        content = lastUserMessage.content;
      } else if (Array.isArray(lastUserMessage.content)) {
        // Handle array of content parts (e.g., text + images)
        const textPart = lastUserMessage.content.find((part: any) => part.type === "text");
        content = textPart?.text || "";
      }
      
      if (content) {
        onUserMessageChange(content);
      } else {
        onUserMessageChange("");
      }
    } else {
      onUserMessageChange("");
    }
  }, [messages, onUserMessageChange]);

  return <EnhancedThread />;
}

export default function AssistantPage() {
  const { data: session, status } = useSession();
  const [currentUserMessage, setCurrentUserMessage] = useState("");
  
  const runtime = useChatRuntime({
    api: "/api/chat",
    // Add custom headers to include search option and user location
    headers: () => {
      const searchOption = (window as any).__CHOICEMADE_SEARCH_OPTION || 'both';
      const userLocation = (window as any).__CHOICEMADE_USER_LOCATION;
      
      console.log('🔧 Runtime: Adding search option header:', searchOption);
      console.log('🔧 Runtime: Adding user location header:', userLocation);
      
      const headers: any = {
        'X-Search-Option': searchOption
      };
      
      if (userLocation) {
        headers['X-User-Location'] = JSON.stringify(userLocation);
      }
      
      return headers;
    }
  });



  const handleAddProduct = () => {
    const hiddenButton = document.getElementById('hidden-add-product-suggestion');
    if (hiddenButton) {
      hiddenButton.click();
    }
  };

  const handleManageProducts = () => {
    const hiddenButton = document.getElementById('hidden-manage-products-suggestion');
    if (hiddenButton) {
      hiddenButton.click();
    }
  };

  const handleAddService = () => {
    const hiddenButton = document.getElementById('hidden-add-service-suggestion');
    if (hiddenButton) {
      hiddenButton.click();
    }
  };

  const handleManageServices = () => {
    const hiddenButton = document.getElementById('hidden-manage-services-suggestion');
    if (hiddenButton) {
      hiddenButton.click();
    }
  };

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Card className="w-[400px]">
          <CardHeader className="text-center">
                                  <CardTitle className="brand-title">Welcome to ChoiceMade.ai!</CardTitle>
            <CardDescription>
              Please sign in to continue
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <Button onClick={() => window.location.href = "/auth/signin"}>
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayTitle = currentUserMessage 
    ? (currentUserMessage.length > 50 ? `${currentUserMessage.substring(0, 50)}...` : currentUserMessage)
    : "Chat";

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <VisionCreationToolUI />
      <VisionCreationDirectToolUI />
      <ListMyVisionsToolUI />
      <SearchMyVisionsToolUI />
      <SearchAllVisionsToolUI />
      <DeleteVisionWithListToolUI />
      <VisionCreatedWithListToolUI />
      <VisionDuplicateFoundToolUI />
      <ShowVisionToolUI />
      <ProductFormToolUI />
      <ProductCreatedWithListToolUI />
      <ProductsListToolUI />
      <ProductDeletedWithListToolUI />
      <ShowProductToolUI />
      <ServiceFormToolUI />
      <ServiceCreatedWithListToolUI />
      <ServicesListToolUI />
      <ServiceDeletedWithListToolUI />
      <ShowServiceToolUI />

      <ProductSearchToolUI />
      <div className="flex flex-col h-screen">
        <header className="flex h-12 shrink-0 items-center gap-2 bg-gradient-to-r from-slate-800 via-gray-800 to-slate-900 border-b border-slate-700 shadow-lg px-4">
          <div className="flex items-center gap-2">
            <Link href="/" className="font-bold bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent hover:opacity-80 transition-opacity cursor-pointer" onClick={() => window.location.href = '/'}>
              ChoiceMade.ai
            </Link>
            <Separator orientation="vertical" className="mr-2 h-4 bg-slate-600" />
            <span className="text-slate-200">{displayTitle}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full hover:bg-slate-700">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={session.user?.image || undefined} alt={session.user?.name || "User"} />
                    <AvatarFallback>
                      <User className="h-4 w-4" />
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{session.user?.name}</p>
                    <p className="text-xs leading-none text-muted-foreground">{session.user?.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={(e) => {
                  console.log('🎯 DropdownMenuItem clicked for add product');
                  e.preventDefault();
                  e.stopPropagation();
                  handleAddProduct();
                }}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span>add a product</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => {
                  console.log('🎯 DropdownMenuItem clicked for manage products');
                  e.preventDefault();
                  e.stopPropagation();
                  handleManageProducts();
                }}>
                  <Package className="mr-2 h-4 w-4" />
                  <span>manage my products</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => {
                  console.log('🎯 DropdownMenuItem clicked for add service');
                  e.preventDefault();
                  e.stopPropagation();
                  handleAddService();
                }}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span>add a service</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={(e) => {
                  console.log('🎯 DropdownMenuItem clicked for manage services');
                  e.preventDefault();
                  e.stopPropagation();
                  handleManageServices();
                }}>
                  <Briefcase className="mr-2 h-4 w-4" />
                  <span>manage my services</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <ThreadWrapper onUserMessageChange={setCurrentUserMessage} />
        </div>
      </div>

      
      {/* Hidden suggestion button for add product */}
      <ThreadPrimitive.Suggestion
        id="hidden-add-product-suggestion"
        prompt="add a product"
        method="replace"
        autoSend={true}
        style={{ display: 'none' }}
      />
      
      {/* Hidden suggestion button for manage products */}
      <ThreadPrimitive.Suggestion
        id="hidden-manage-products-suggestion"
        prompt="manage my products"
        method="replace"
        autoSend={true}
        style={{ display: 'none' }}
      />
      
      {/* Hidden suggestion button for add service */}
      <ThreadPrimitive.Suggestion
        id="hidden-add-service-suggestion"
        prompt="add a service"
        method="replace"
        autoSend={true}
        style={{ display: 'none' }}
      />
      
      {/* Hidden suggestion button for manage services */}
      <ThreadPrimitive.Suggestion
        id="hidden-manage-services-suggestion"
        prompt="manage my services"
        method="replace"
        autoSend={true}
        style={{ display: 'none' }}
      />
    </AssistantRuntimeProvider>
  );
}
