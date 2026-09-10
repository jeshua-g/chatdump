"use client";

import type { CSSProperties, FormEvent, KeyboardEvent, RefObject } from "react";
import { ArrowUpIcon, HashIcon, HomeIcon } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Marker, MarkerContent } from "@/components/ui/marker";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import type { CrtChatLine } from "@/src/shaders/crt/crtRenderer";

function note(body: string) {
  const i = body.indexOf("\n");
  if (i > 0 && body.slice(0, i).includes("$ ")) return body.slice(i + 1);
  return body;
}

export function MiniChat({
  feed,
  nick,
  live,
  roomLabel,
  rooms,
  people,
  hint,
  value,
  promptKind,
  lobby,
  inputRef,
  onChange,
  onKeyDown,
  onSubmit,
  onJoin,
  onLeave,
}: {
  feed: CrtChatLine[];
  nick: string;
  live: boolean;
  roomLabel: string;
  rooms: { id: string }[];
  people: string[];
  hint: string;
  value: string;
  promptKind: "shell" | "select" | "password";
  lobby: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange: (value: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: (e: FormEvent) => void;
  onJoin: (id: string) => void;
  onLeave: () => void;
}) {
  const title = roomLabel === "HOME" ? "Home" : roomLabel;
  const placeholder =
    promptKind === "password"
      ? "Password"
      : promptKind === "select"
        ? "1 or 2"
        : lobby
          ? "Message  ·  /help"
          : "Message";

  return (
    <SidebarProvider
      className="h-full min-h-0! w-full"
      style={{ "--sidebar-width": "14rem" } as CSSProperties}
    >
      <Sidebar side="left" collapsible="none" className="max-md:hidden">
        <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
          <div className="truncate text-sm font-medium">chatdump</div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Rooms</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton isActive={lobby} onClick={onLeave}>
                    <HomeIcon />
                    <span>home</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                {rooms.map((room) => (
                  <SidebarMenuItem key={room.id}>
                    <SidebarMenuButton
                      isActive={roomLabel === room.id}
                      onClick={() => onJoin(room.id)}
                    >
                      <HashIcon />
                      <span>{room.id}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-h-0 min-w-0 overflow-hidden">
        <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{title}</div>
              <div className="truncate text-xs text-muted-foreground">{nick || "anon"}</div>
            </div>
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-muted-foreground/50"}`} />
              {live ? "Online" : "Offline"}
            </span>
          </div>
          <div className="h-0 min-h-0 flex-1">
            <MessageScrollerProvider autoScroll defaultScrollPosition="end">
              <MessageScroller>
                <MessageScrollerViewport className="flex flex-col" aria-live="polite">
                  <MessageScrollerContent className="mt-auto justify-end gap-3 px-3 py-3">
                    {feed.map((msg) => (
                      <MessageScrollerItem key={msg.id} messageId={msg.id}>
                        {!msg.sender ? (
                          <Marker>
                            <MarkerContent className="whitespace-pre-wrap">{note(msg.body)}</MarkerContent>
                          </Marker>
                        ) : (
                          <Message align={msg.sender === nick ? "end" : "start"}>
                            <MessageContent>
                              {msg.sender !== nick ? <MessageHeader>{msg.sender}</MessageHeader> : null}
                              <Bubble
                                align={msg.sender === nick ? "end" : "start"}
                                variant={msg.sender === nick ? "default" : "outline"}
                              >
                                <BubbleContent className="whitespace-pre-wrap">{msg.body}</BubbleContent>
                              </Bubble>
                            </MessageContent>
                          </Message>
                        )}
                      </MessageScrollerItem>
                    ))}
                  </MessageScrollerContent>
                </MessageScrollerViewport>
                <MessageScrollerButton />
              </MessageScroller>
            </MessageScrollerProvider>
          </div>
          <form
            className="flex items-end gap-2 border-t border-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            onSubmit={onSubmit}
          >
            <div className="min-w-0 flex-1">
              {hint ? <div className="px-3 pb-1.5 text-xs text-muted-foreground">{hint}</div> : null}
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKeyDown}
                maxLength={2000}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                type={promptKind === "password" ? "password" : "text"}
                aria-label={placeholder}
                placeholder={placeholder}
                autoFocus
                className="h-11 w-full rounded-full border-0 bg-muted px-4 text-base text-foreground outline-none placeholder:text-muted-foreground"
              />
            </div>
            <Button
              type="submit"
              size="icon-lg"
              className="rounded-full active:scale-95"
              disabled={!value.trim()}
              aria-label="Send"
            >
              <ArrowUpIcon />
            </Button>
          </form>
        </div>
      </SidebarInset>
      <Sidebar side="right" collapsible="none" className="max-md:hidden">
        <SidebarHeader className="border-b border-sidebar-border px-3 py-3">
          <div className="text-sm font-medium">Online — {lobby ? 0 : people.length}</div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {(lobby ? [] : people).map((name) => (
                  <SidebarMenuItem key={name}>
                    <SidebarMenuButton>
                      <span className="size-1.5 rounded-full bg-emerald-400" />
                      <span>{name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  );
}
