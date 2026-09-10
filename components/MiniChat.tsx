"use client";

import type { CSSProperties, FormEvent, KeyboardEvent, RefObject } from "react";
import { useState } from "react";
import { ArrowUpIcon, HashIcon, HomeIcon, PanelLeftIcon, PanelRightIcon } from "lucide-react";
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
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
} from "@/components/ui/sidebar";
import type { CrtChatLine } from "@/src/shaders/crt/crtRenderer";

function note(body: string) {
  const i = body.indexOf("\n");
  if (i > 0 && body.slice(0, i).includes("$ ")) return body.slice(i + 1);
  return body;
}

function homeNoise(body: string) {
  const t = note(body).trim();
  return t === "left room" || t.startsWith("chatdump");
}

function HomeGuide({
  nick,
  rooms,
  onJoin,
}: {
  nick: string;
  rooms: { id: string }[];
  onJoin: (id: string) => void;
}) {
  const start = rooms.find((r) => r.id === "guest")?.id ?? rooms[0]?.id;
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-6 py-12">
      <div>
        <h1 className="text-2xl font-medium tracking-tight">Welcome{nick ? `, ${nick}` : ""}</h1>
        <p className="mt-2 text-sm text-muted-foreground">This is home. Chat lives in a room.</p>
      </div>
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
        <li>Click a room on the left</li>
        <li>Type a message, press Enter</li>
        <li>
          Commands start with <code className="text-foreground">/</code>
          {" — "}
          <code className="text-foreground">/help</code>{" "}
          <code className="text-foreground">/auth</code>{" "}
          <code className="text-foreground">/nick</code>
        </li>
      </ol>
      {start ? (
        <Button className="w-fit rounded-full" onClick={() => onJoin(start)}>
          <HashIcon />
          Open #{start}
        </Button>
      ) : null}
    </div>
  );
}

export function MiniChat({
  feed,
  nick,
  live,
  roomLabel,
  rooms,
  people,
  typing,
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
  typing: string;
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
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const title = roomLabel === "HOME" ? "Home" : roomLabel;
  const placeholder =
    promptKind === "password"
      ? "Password"
      : promptKind === "select"
        ? "1 or 2"
        : lobby
          ? "Pick a room, or /help"
          : "Message";
  const railStyle = { "--sidebar-width": "14rem" } as CSSProperties;

  return (
    <div className="flex h-full min-h-0 w-full">
      <SidebarProvider
        className="h-full min-h-0! w-auto"
        style={railStyle}
        open={leftOpen}
        onOpenChange={setLeftOpen}
      >
        <Sidebar side="left" collapsible="icon">
          <SidebarHeader className="border-b border-sidebar-border px-3 py-3 group-data-[collapsible=icon]:px-2">
            <div className="truncate text-sm font-medium group-data-[collapsible=icon]:hidden">
              chatdump
            </div>
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
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex min-w-0 items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="hidden md:inline-flex"
                aria-label={leftOpen ? "Collapse rooms" : "Expand rooms"}
                onClick={() => setLeftOpen((open) => !open)}
              >
                <PanelLeftIcon />
              </Button>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{title}</div>
                <div className="truncate text-xs text-muted-foreground">{nick || "anon"}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className={`size-1.5 rounded-full ${live ? "bg-emerald-400" : "bg-muted-foreground/50"}`} />
                {live ? "Online" : "Offline"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="hidden md:inline-flex"
                aria-label={rightOpen ? "Collapse members" : "Expand members"}
                onClick={() => setRightOpen((open) => !open)}
              >
                <PanelRightIcon />
              </Button>
            </div>
          </div>
          <div className="h-0 min-h-0 flex-1">
            {lobby ? (
              <div className="h-full overflow-y-auto">
                <HomeGuide nick={nick} rooms={rooms} onJoin={onJoin} />
                {feed.some((msg) => !homeNoise(msg.body)) ? (
                  <div className="space-y-3 border-t border-border px-6 py-4">
                    {feed
                      .filter((msg) => !homeNoise(msg.body))
                      .map((msg) => (
                        <Marker key={msg.id}>
                          <MarkerContent className="whitespace-pre-wrap">{note(msg.body)}</MarkerContent>
                        </Marker>
                      ))}
                  </div>
                ) : null}
              </div>
            ) : (
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
            )}
          </div>
          <form
            className="flex items-end gap-2 border-t border-border px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
            onSubmit={onSubmit}
          >
            <div className="min-w-0 flex-1">
              {typing ? <div className="px-3 pb-1 text-xs text-muted-foreground">{typing}</div> : null}
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
      <SidebarProvider
        className="h-full min-h-0! w-auto"
        style={railStyle}
        open={rightOpen}
        onOpenChange={setRightOpen}
        keyboardShortcut={false}
      >
        <Sidebar side="right" collapsible="icon">
          <SidebarHeader className="border-b border-sidebar-border px-3 py-3 group-data-[collapsible=icon]:hidden">
            <div className="truncate text-sm font-medium">
              Online — {lobby ? 0 : people.length}
            </div>
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
          <SidebarRail />
        </Sidebar>
      </SidebarProvider>
    </div>
  );
}
