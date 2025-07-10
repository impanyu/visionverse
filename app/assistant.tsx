"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { useSession, signOut } from "next-auth/react";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Separator } from "@/components/ui/separator";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { EnhancedThread } from "@/components/enhanced-thread";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LogOut, User } from "lucide-react";
import { useState, useEffect } from "react";
import { useThread } from "@assistant-ui/react";
import { VisionCreationToolUI, VisionCreationDirectToolUI, ListMyVisionsToolUI, SearchMyVisionsToolUI, SearchAllVisionsToolUI, DeleteVisionWithListToolUI, VisionCreatedWithListToolUI, VisionDuplicateFoundToolUI, ShowVisionToolUI } from "@/components/vision-creation-tool-ui";
import { 
  ProductFormToolUI, 
  ProductCreationToolUI, 
  ProductCreatedWithListToolUI, 
  ProductsListToolUI, 
  ProductDeletedWithListToolUI,
  ShowProductToolUI 
} from "@/components/product-tool-ui";

function ThreadWrapper({ onUserMessageChange }: { onUserMessageChange: (message: string) => void }) {
  const { messages = [] } = useThread() || {};

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
  });

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
            <CardTitle className="brand-title">Welcome to VisionVerse</CardTitle>
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
      <ProductFormToolUI />
      <VisionCreationDirectToolUI />
      <ListMyVisionsToolUI />
      <SearchMyVisionsToolUI />
      <SearchAllVisionsToolUI />
      <DeleteVisionWithListToolUI />
      <VisionCreatedWithListToolUI />
      <VisionDuplicateFoundToolUI />
      <ShowVisionToolUI />
      <ProductCreationToolUI />
      <ProductCreatedWithListToolUI />
      <ProductsListToolUI />
      <ProductDeletedWithListToolUI />
      <ShowProductToolUI />
      <SidebarProvider defaultOpen={false}>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                    <BreadcrumbLink href="/">
                      <span className="brand-title">VisionVerse</span>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                    <BreadcrumbPage>{displayTitle}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            </div>
            <div className="ml-auto flex items-center gap-2 px-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="relative h-8 w-8 rounded-full">
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
        </SidebarInset>
      </SidebarProvider>
    </AssistantRuntimeProvider>
  );
}
