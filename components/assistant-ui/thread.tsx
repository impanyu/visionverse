import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useThread,
  useMessage,
} from "@assistant-ui/react";
import type { FC } from "react";
import {
  ArrowDownIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  SendHorizontalIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { ToolFallback } from "./tool-fallback";

export const Thread: FC = () => {
  const { messages = [] } = useThread() || {};

  return (
    <ThreadPrimitive.Root
      className="bg-background box-border flex h-full flex-col overflow-hidden"
      style={{
        ["--thread-max-width" as string]: "90rem",
      }}
    >
      <ThreadPrimitive.Viewport className="flex h-full flex-col items-center overflow-y-auto scroll-smooth bg-inherit px-4 pt-8 pb-24 only-last-assistant-message">
        <ThreadWelcome />
        <ThreadPrimitive.Messages
          components={{
            UserMessage: UserMessage,
            EditComposer: EditComposer,
            AssistantMessage: AssistantMessage,
          }}
        />
        <div className="fixed bottom-0 left-0 right-0 mt-3 flex w-full flex-col items-center justify-end bg-inherit pb-4 px-4 z-50">
          <div className="w-full max-w-4xl mx-auto">
            <PersistentSuggestions />
            <Composer />
          </div>
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
          <p className="mt-4 font-bold max-w-2xl text-center text-4xl">Welcome to ChoiceMade.ai!</p>
                      <p className="mt-2 text-center text-gray-600 max-w-2xl text-2xl">Skip the list,<br />no pondering, no comparison, no hassle,<br />we just make the choice for you.</p>
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
  
  return (
    <ComposerPrimitive.Root 
      className="focus-within:border-ring/20 flex w-full flex-wrap items-end rounded-lg border bg-inherit px-2.5 shadow-sm transition-colors ease-in"
      onSubmit={(e) => {
        console.log('🚀 Composer: Form submitted!', e);
        console.log('🚀 Composer: This should trigger a new search');
      }}
    >
      <ComposerPrimitive.Input
        rows={1}
        autoFocus
        placeholder="Write a message..."
        className="placeholder:text-muted-foreground max-h-40 flex-grow resize-none border-none bg-transparent px-2 py-4 text-sm outline-none focus:ring-0 disabled:cursor-not-allowed"
        onChange={(e) => {
          console.log('⌨️ Composer: Input changed:', e.target.value.substring(0, 50));
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            console.log('🎯 Composer: Enter key pressed - should submit form');
          }
        }}
      />
      <ComposerAction />
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
            className="my-2.5 size-8 p-2 transition-opacity ease-in"
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
                className="my-2.5 size-8 p-2 transition-opacity ease-in"
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
