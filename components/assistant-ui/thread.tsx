import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useThread,
  useMessage,
  useAssistantRuntime,
} from "@assistant-ui/react";
import type { FC } from "react";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  MapPin,
  PencilIcon,
  RefreshCwIcon,
  SendHorizontalIcon,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ToolFallback } from "./tool-fallback";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Global search loading overlay component - CSS RESPONSIVE INLINE STYLES
const GlobalSearchLoadingOverlay: FC = () => {
  return (
    <ThreadPrimitive.If running>
      {(() => {
        console.log('🔄 GlobalSearchLoadingOverlay: Assistant is RUNNING - showing global loading');
        return (
          <>
            <style jsx>{`
              .waiting-panel-container {
                position: fixed;
                top: 50%;
                left: 50%;
                transform: translate(-50%, -50%);
                z-index: 100;
                max-width: 95vw;
                max-height: 85vh;
                overflow: auto;
              }
              .waiting-panel {
                background: white;
                border: 1px solid #e5e7eb;
                border-radius: 8px;
                padding: 16px;
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 12px;
                box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
              }
              .spinner {
                width: 24px;
                height: 24px;
                border: 2px solid transparent;
                border-top: 2px solid #2563eb;
                border-radius: 50%;
                animation: spin 1s linear infinite;
              }
              .main-text {
                font-size: 14px;
                font-weight: 500;
                color: #374151;
                text-align: center;
                line-height: 1.3;
                margin: 0;
              }
              .search-item {
                font-size: 12px;
                color: #6b7280;
                text-align: center;
                margin: 0;
                line-height: 1.4;
              }
              .search-items {
                display: flex;
                flex-direction: column;
                gap: 4px;
              }
              @keyframes spin {
                to { transform: rotate(360deg); }
              }
              
              /* Tablet styles */
              @media (min-width: 640px) {
                .waiting-panel {
                  padding: 20px;
                  gap: 16px;
                }
                .spinner {
                  width: 28px;
                  height: 28px;
                }
                .main-text {
                  font-size: 16px;
                }
                .search-item {
                  font-size: 14px;
                }
                .search-items {
                  gap: 6px;
                }
              }
              
              /* Desktop styles */
              @media (min-width: 768px) {
                .waiting-panel {
                  padding: 48px;
                  gap: 32px;
                  min-width: 500px;
                }
                .spinner {
                  width: 48px;
                  height: 48px;
                  border-width: 5px;
                }
                .main-text {
                  font-size: 28px;
                  font-weight: 700;
                  max-width: 450px;
                }
                .search-item {
                  font-size: 17px;
                  font-weight: 500;
                }
                .search-items {
                  gap: 14px;
                }
              }
            `}</style>
            <div className="waiting-panel-container">
              <div className="waiting-panel">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
                  <div className="spinner"></div>
                  <p className="main-text">Searching for the most suitable products and services</p>
                </div>
                <div className="search-items">
                  <p className="search-item">🏠 Searching local products and services</p>
                  <p className="search-item">🔍 Searching Amazon marketplace</p>
                  <p className="search-item">🛒 Searching Google Shopping</p>
                  <p className="search-item">🏪 Searching eBay marketplace</p>
                  <p className="search-item">🏬 Searching Walmart</p>
                  <p className="search-item">🎨 Searching Etsy</p>
                  <p className="search-item">👗 Searching Shein</p>
                  <p className="search-item">🛍️ Searching Temu</p>
                  <p className="search-item">🗺️ Searching Google Maps services</p>
                  <p className="search-item">💬 Reading customer comments</p>
                  <p className="search-item">🤖 Evaluating product quality</p>
                </div>
              </div>
            </div>
          </>
        );
      })()}
    </ThreadPrimitive.If>
  );
};

export const Thread: FC = () => {
  const { messages = [] } = useThread() || {};

  return (
    <ThreadPrimitive.Root
      className="bg-background box-border flex h-full flex-col overflow-hidden"
      style={{
        ["--thread-max-width" as string]: "90rem",
      }}
    >
      {/* Global loading overlay */}
      <GlobalSearchLoadingOverlay />
      
      <ThreadPrimitive.Viewport className="flex h-full flex-col items-center overflow-y-auto scroll-smooth bg-inherit px-4 pt-8 pb-24 only-last-assistant-message">
        <ThreadWelcome />
        <ThreadPrimitive.Messages
          components={{
            UserMessage: UserMessage,
            EditComposer: EditComposer,
            AssistantMessage: AssistantMessage,
          }}
        />
        <div className="fixed bottom-0 left-1/2 transform -translate-x-1/2 mt-3 flex flex-col items-center justify-end bg-inherit pb-4 px-4 z-50 w-full max-w-4xl">
          <PersistentSuggestions />
          <Composer />
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="absolute -top-8 rounded-full disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <ThreadPrimitive.Empty>
      <div className="flex w-full max-w-[var(--thread-max-width)] flex-grow flex-col">
        <div className="flex w-full flex-grow flex-col items-center justify-center">
          <p className="mt-4 font-bold max-w-2xl text-center text-3xl">Welcome to ChoiceMade.ai!</p>
                      <p className="mt-2 text-center text-gray-600 max-w-2xl text-lg">Skip the list,<br />no pondering, no comparison, no hassle,<br />we just make the choice for you.</p>
        </div>
        <ThreadWelcomeSuggestions />
      </div>
    </ThreadPrimitive.Empty>
  );
};

const ThreadWelcomeSuggestions: FC = () => {
  return null;
};

const PersistentSuggestions: FC = () => {
  return null;
};

const Composer: FC = () => {
  console.log('🎯 Composer: Component rendered at', new Date().toISOString());
  const [searchOption, setSearchOption] = useState<'both' | 'product' | 'service'>('both');
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const runtime = useAssistantRuntime();
  
  const searchOptionLabels = {
    'both': 'Search for both',
    'product': 'Product only', 
    'service': 'Service only'
  };

  // Function to get user's GPS location - MOBILE CHROME COMPATIBLE v4
  const getCurrentLocation = async () => {
    console.log('📍 Starting location request (Mobile Chrome v4)');
    
    // Check if geolocation is supported
    if (!navigator.geolocation) {
      console.error('🚨 Geolocation is not supported by this browser');
      setGpsEnabled(false);
      return;
    }

    // Check if we're on HTTPS (required for mobile Chrome location)
    if (typeof window !== 'undefined' && window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      console.warn('🚨 HTTPS required for geolocation on mobile Chrome');
      setGpsEnabled(false);
      alert('Location access requires HTTPS connection on mobile devices');
      return;
    }

    // Check permissions first (for mobile Chrome)
    if ('permissions' in navigator) {
      try {
        const permission = await navigator.permissions.query({name: 'geolocation'});
        console.log('📍 Geolocation permission status:', permission.state);
        
        if (permission.state === 'denied') {
          console.log('🚨 Geolocation permission denied');
          setGpsEnabled(false);
          alert('Location access is blocked. Please enable location permissions in your browser settings.');
          return;
        }
      } catch (e) {
        console.log('📍 Permission API not available, proceeding with location request');
      }
    }

    // Mobile Chrome optimized geolocation request
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const location = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(location);
        console.log('📍 GPS Location obtained (Mobile Chrome v4):', location);
        console.log('📍 Accuracy:', position.coords.accuracy, 'meters');
        
        // Store location globally for backend access
        (window as any).__CHOICEMADE_USER_LOCATION = location;
        setGpsEnabled(true);
      },
      (error) => {
        console.log('🚨 LOCATION ERROR CAUGHT (Mobile Chrome v4):', {
          code: error.code,
          message: error.message,
          timestamp: new Date().toISOString()
        });
        
        setGpsEnabled(false);
        
        // Mobile-specific error handling
        let userMessage = 'Unable to get location';
        switch (error.code) {
          case 1: // PERMISSION_DENIED
            userMessage = 'Location access denied. Please enable location permissions in your browser settings.';
            break;
          case 2: // POSITION_UNAVAILABLE
            userMessage = 'Location information unavailable. Please check your GPS is enabled.';
            break;
          case 3: // TIMEOUT
            userMessage = 'Location request timed out. Please try again.';
            break;
          default:
            userMessage = 'Unknown location error. Please try again.';
        }
        
        console.log('📍 USER-FRIENDLY MESSAGE (Mobile Chrome v4):', userMessage);
        alert(userMessage); // Show alert for mobile users
      },
      {
        enableHighAccuracy: false, // Changed for mobile battery saving
        timeout: 15000, // Increased timeout for mobile
        maximumAge: 600000 // 10 minutes cache for mobile
      }
    );
  };

  // Handle GPS toggle - MOBILE OPTIMIZED
  const handleGpsToggle = async () => {
    console.log('📍 GPS Toggle clicked, current state:', gpsEnabled);
    
    if (!gpsEnabled) {
      console.log('📍 Enabling GPS...');
      setGpsEnabled(true); // Set immediately for UI feedback
      await getCurrentLocation();
    } else {
      console.log('📍 Disabling GPS...');
      setGpsEnabled(false);
      setUserLocation(null);
      (window as any).__CHOICEMADE_USER_LOCATION = null;
    }
  };
  
  return (
    <ComposerPrimitive.Root 
      className="focus-within:border-ring/20 flex w-full flex-wrap items-end rounded-lg border bg-inherit px-2.5 shadow-sm transition-colors ease-in"
      onSubmit={async (e) => {
        console.log('🚀 Composer: Form submitted!', e);
        console.log('🚀 Composer: Search option:', searchOption);
        
        // Store search option globally for backend to access
        (window as any).__CHOICEMADE_SEARCH_OPTION = searchOption;
        console.log('🔧 Composer: Stored search option globally:', searchOption);
      }}
    >
      <div className="relative flex items-center w-full">
        <ComposerPrimitive.Input
          rows={1}
          autoFocus
          placeholder="Write a message..."
          className="placeholder:text-muted-foreground max-h-40 w-full resize-none border-none bg-transparent pl-3 pr-20 py-4 text-sm outline-none focus:ring-0 disabled:cursor-not-allowed"
          onChange={(e) => {
            console.log('⌨️ Composer: Input changed:', e.target.value.substring(0, 50));
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              console.log('🎯 Composer: Enter key pressed - should submit form');
            }
          }}
        />
        
        {/* Right-aligned controls inside input */}
        <div className="absolute right-1 flex items-center gap-1">
          {/* GPS Location Toggle */}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleGpsToggle}
            className={`px-1.5 py-1 h-7 text-xs transition-colors ${
              gpsEnabled 
                ? 'text-green-600 hover:text-green-700 bg-green-50 hover:bg-green-100' 
                : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
            }`}
            title={gpsEnabled ? 'GPS enabled - Click to disable' : 'Click to enable GPS location'}
          >
            <MapPin className="w-3 h-3" />
          </Button>
          
          {/* Search Option Selector */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="px-1.5 py-1 h-7 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50">
                <Settings className="w-3 h-3 mr-1" />
                {searchOptionLabels[searchOption]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem 
                onClick={() => setSearchOption('both')}
                className={searchOption === 'both' ? 'bg-accent' : ''}
              >
                Search for both
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setSearchOption('product')}
                className={searchOption === 'product' ? 'bg-accent' : ''}
              >
                Product only
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => setSearchOption('service')}
                className={searchOption === 'service' ? 'bg-accent' : ''}
              >
                Service only
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          {/* Send/Cancel Button */}
          <ComposerAction />
        </div>
      </div>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  return (
    <>
      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send"
            variant="default"
            className="size-7 p-1.5 transition-opacity ease-in"
            onClick={() => {
              console.log('🚀 ComposerAction: Send button clicked!');
              console.log('🚀 ComposerAction: This should trigger message sending');
            }}
          >
            <SendHorizontalIcon />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        {(() => {
          console.log('🔄 ComposerAction: Assistant is RUNNING - search in progress');
          return (
            <ComposerPrimitive.Cancel asChild>
              <TooltipIconButton
                tooltip="Cancel"
                variant="default"
                className="size-7 p-1.5 transition-opacity ease-in"
                onClick={() => {
                  console.log('🛑 ComposerAction: Cancel button clicked');
                }}
              >
                <CircleStopIcon />
              </TooltipIconButton>
            </ComposerPrimitive.Cancel>
          );
        })()}
      </ThreadPrimitive.If>
    </>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root className="user-message grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-2 [&:where(>*)]:col-start-2 w-full max-w-[var(--thread-max-width)] py-4">
      <UserActionBar />

      <div className="bg-muted text-foreground max-w-[calc(var(--thread-max-width)*0.8)] break-words rounded-3xl px-5 py-2.5 col-start-2 row-start-2">
        <MessagePrimitive.Content />
      </div>

      <BranchPicker className="col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="flex flex-col items-end col-start-1 row-start-2 mr-3 mt-2.5"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <ComposerPrimitive.Root className="bg-muted my-4 flex w-full max-w-[var(--thread-max-width)] flex-col gap-2 rounded-xl">
      <ComposerPrimitive.Input className="text-foreground flex h-8 w-full resize-none bg-transparent p-4 pb-0 outline-none" />

      <div className="mx-3 mb-3 flex items-center justify-center gap-2 self-end">
        <ComposerPrimitive.Cancel asChild>
          <Button variant="ghost">Cancel</Button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <Button>Send</Button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};

const AssistantMessage: FC = function() {
  const message = useMessage();
  if (!message) {
    return null;
  }
  
  return (
    <MessagePrimitive.Root className="assistant-message w-full max-w-4xl mx-auto py-4">
      <div className="text-foreground max-w-full break-words leading-7 my-1.5">
        <MessagePrimitive.Content components={{ Text: MarkdownText }} />
      </div>
      <AssistantActionBar />
      <BranchPicker className="-ml-2 mr-2" />
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="text-muted-foreground flex gap-1 ml-auto mt-2 data-[floating]:bg-background data-[floating]:absolute data-[floating]:rounded-md data-[floating]:border data-[floating]:p-1 data-[floating]:shadow-sm"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <MessagePrimitive.If copied>
            <CheckIcon />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <CopyIcon />
          </MessagePrimitive.If>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh">
          <RefreshCwIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "text-muted-foreground inline-flex items-center text-xs",
        className
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

const CircleStopIcon = () => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 16 16"
      fill="currentColor"
      width="16"
      height="16"
    >
      <rect width="10" height="10" x="3" y="3" rx="2" />
    </svg>
  );
};

// Add CSS to hide all but the last assistant message (fix selector and prevent multiple injections)
if (typeof window !== 'undefined' && !document.getElementById('only-last-assistant-message-style')) {
  const style = document.createElement('style');
  style.id = 'only-last-assistant-message-style';
  style.innerHTML = `
    .assistant-message.hidden-by-js,
    .user-message.hidden-by-js {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
  
  // JavaScript to hide all user messages and all but last assistant message
  const hideMessages = () => {
    const viewport = document.querySelector('.only-last-assistant-message');
    if (viewport) {
      // Hide all user messages
      const userMessages = viewport.querySelectorAll('.user-message');
      userMessages.forEach((msg) => {
        msg.classList.add('hidden-by-js');
      });
      
      // Hide all but last assistant message
      const assistantMessages = viewport.querySelectorAll('.assistant-message');
      console.log(`🎭 THREAD: Found ${assistantMessages.length} assistant messages, hiding all but last`);
      
      assistantMessages.forEach((msg, index) => {
        if (index < assistantMessages.length - 1) {
          msg.classList.add('hidden-by-js');
          console.log(`🎭 THREAD: Hiding assistant message ${index + 1}`);
        } else {
          msg.classList.remove('hidden-by-js');
          console.log(`🎭 THREAD: Showing assistant message ${index + 1} (last)`);
        }
      });
    }
  };
  
  // Run initially and on DOM changes
  hideMessages();
  const observer = new MutationObserver(hideMessages);
  observer.observe(document.body, { childList: true, subtree: true });
}

// DebugMessage component to show every message
const DebugMessage: FC<{ type: string }> = ({ type }) => {
  const message = useMessage();
  return (
    <div 
      className={type === 'assistant' ? 'assistant-message' : ''}
      style={{ border: '2px dashed blue', margin: 8, padding: 8, background: '#e0f0ff', color: '#003366' }}
    >
      [DebugMessage] type: {type}, role: {message?.role}, id: {message?.id}
    </div>
  );
};
