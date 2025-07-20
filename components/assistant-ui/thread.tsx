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
            <ThreadScrollToBottom />
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
          <p className="mt-4 font-medium max-w-2xl text-center text-2xl">Welcome to VisionVerse!</p>
          <p className="mt-2 max-w-2xl text-center">The first platform in the world where you can trade your vision, idea, complaint or dream about a product or service.</p>
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
  return (
    <div className="mb-3 flex w-full items-stretch justify-center gap-2">
      <div className="grid grid-cols-5 gap-2 w-full max-w-4xl">
        <ThreadPrimitive.Suggestion
          className="hover:bg-blue-100 hover:border-blue-300 flex flex-col items-center justify-center rounded-lg border border-blue-200 p-2 transition-colors ease-in bg-blue-50/80 backdrop-blur-sm"
          prompt="Create a new vision"
          method="replace"
          autoSend
        >
          <span className="line-clamp-2 text-ellipsis text-xs font-medium text-blue-700">
            Create a new vision
          </span>
        </ThreadPrimitive.Suggestion>
        <ThreadPrimitive.Suggestion
          className="hover:bg-green-100 hover:border-green-300 flex flex-col items-center justify-center rounded-lg border border-green-200 p-2 transition-colors ease-in bg-green-50/80 backdrop-blur-sm"
          prompt="List all my visions"
          method="replace"
          autoSend
        >
          <span className="line-clamp-2 text-ellipsis text-xs font-medium text-green-700">
            List all my visions
          </span>
        </ThreadPrimitive.Suggestion>
        <ThreadPrimitive.Suggestion
          className="hover:bg-teal-100 hover:border-teal-300 flex flex-col items-center justify-center rounded-lg border border-teal-200 p-2 transition-colors ease-in bg-teal-50/80 backdrop-blur-sm"
          prompt="search for vision about:"
          method="replace"
          autoSend={false}
          onClick={() => {
            // Focus the input after the text is inserted
            setTimeout(() => {
              const input = document.querySelector('textarea[placeholder="Write a message..."]') as HTMLTextAreaElement;
              if (input) {
                input.focus();
                // Position cursor at the end of the text
                const length = input.value.length;
                input.setSelectionRange(length, length);
              }
            }, 100);
          }}
        >
          <span className="line-clamp-2 text-ellipsis text-xs font-medium text-teal-700">
            Search for visions
          </span>
        </ThreadPrimitive.Suggestion>
        <ThreadPrimitive.Suggestion
          className="hover:bg-purple-100 hover:border-purple-300 flex flex-col items-center justify-center rounded-lg border border-purple-200 p-2 transition-colors ease-in bg-purple-50/80 backdrop-blur-sm"
          prompt="Create a new product"
          method="replace"
          autoSend
        >
          <span className="line-clamp-2 text-ellipsis text-xs font-medium text-purple-700">
            Create a new product
          </span>
        </ThreadPrimitive.Suggestion>
        <ThreadPrimitive.Suggestion
          className="hover:bg-orange-100 hover:border-orange-300 flex flex-col items-center justify-center rounded-lg border border-orange-200 p-2 transition-colors ease-in bg-orange-50/80 backdrop-blur-sm"
          prompt="List all my products"
          method="replace"
          autoSend
        >
          <span className="line-clamp-2 text-ellipsis text-xs font-medium text-orange-700">
            List all my products
          </span>
        </ThreadPrimitive.Suggestion>
      </div>
    </div>
  );
};

const Composer: FC = () => {
  return (
    <ComposerPrimitive.Root className="focus-within:border-ring/20 flex w-full flex-wrap items-end rounded-lg border bg-inherit px-2.5 shadow-sm transition-colors ease-in">
      <ComposerPrimitive.Input
        rows={1}
        autoFocus
        placeholder="Write a message..."
        className="placeholder:text-muted-foreground max-h-40 flex-grow resize-none border-none bg-transparent px-2 py-4 text-sm outline-none focus:ring-0 disabled:cursor-not-allowed"
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
          >
            <SendHorizontalIcon />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>
      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <TooltipIconButton
            tooltip="Cancel"
            variant="default"
            className="my-2.5 size-8 p-2 transition-opacity ease-in"
          >
            <CircleStopIcon />
          </TooltipIconButton>
        </ComposerPrimitive.Cancel>
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
      assistantMessages.forEach((msg, index) => {
        if (index < assistantMessages.length - 1) {
          msg.classList.add('hidden-by-js');
        } else {
          msg.classList.remove('hidden-by-js');
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
