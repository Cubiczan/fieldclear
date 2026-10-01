"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Mic,
  Volume2,
  VolumeX,
} from "lucide-react";

import { AlexaOrb, type OrbState } from "@/components/console/alexa-orb";
import { ApprovalCard } from "@/components/console/approval-card";
import { AuditPanel } from "@/components/console/audit-panel";
import { DraftCard } from "@/components/console/draft-card";
import { ToolTrail, toolCaption } from "@/components/console/tool-trail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { jobs, shop, tradeLabel, trucks } from "@/lib/data/seed";
import { demoPrompts } from "@/lib/mcp/prompts";
import type {
  ApprovalCard as Approval,
  AuditSnapshot,
  DraftCard as Draft,
  PlannerStatus,
  StreamEvent,
  ToolStep,
} from "@/lib/types";
import { cn } from "cn";

type Panel = "talk" | "tools" | "audit";
type Phase = "idle" | "running" | "speaking";
type ChatItem = {
  id: string;
  role: "user" | "assistant";
  text: string;
  steps?: ToolStep[];
  approval?: Approval;
  draft?: Draft;
};

type SpeechRec = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: SpeechRecEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecEvent = {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};

export function FieldConsole({
  initialAudit,
  planner,
}: {
  initialAudit: AuditSnapshot;
  planner: PlannerStatus;
}) {
  const [audit, setAudit] = useState(initialAudit);
  const [plannerState, setPlannerState] = useState(planner);
  const [messages, setMessages] = useState<ChatItem[]>([]);
  const [liveSteps, setLiveSteps] = useState<ToolStep[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(true);
  const [micNote, setMicNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>("talk");
  const [resetting, setResetting] = useState(false);
  const [speechReady, setSpeechReady] = useState(false);
  const [canListen, setCanListen] = useState(false);
  const stepsRef = useRef<ToolStep[]>([]);
  const auditRef = useRef(initialAudit);
  const turnRef = useRef(0);
  const transcriptRef = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);

  auditRef.current = audit;

  const pinned = messages.find((item) => item.id === pinnedId);
  const trailSteps =
    phase === "running" ? liveSteps : (pinned?.steps ?? latestSteps(messages));
  const activeTool = phase === "running" ? (liveSteps.at(-1)?.tool ?? null) : null;
  const orbState: OrbState = listening
    ? "listening"
    : phase === "running"
      ? "running"
      : phase === "speaking"
        ? "speaking"
        : "idle";

  useEffect(() => {
    setSpeechReady("speechSynthesis" in window);
    setCanListen(getRecognition() !== null);
    return () => {
      recognitionRef.current?.stop();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, liveSteps, phase]);

  function resetDemo() {
    setResetting(true);
    setError(null);
    setAudit(initialAudit);
    auditRef.current = initialAudit;
    setMessages([]);
    setLiveSteps([]);
    setPinnedId(null);
    stepsRef.current = [];
    turnRef.current += 1;
    window.speechSynthesis?.cancel();
    setPhase("idle");
    setResetting(false);
  }

  async function submit(text: string) {
    const utterance = text.trim();
    if (!utterance || phase === "running") return;
    setDraft("");
    setError(null);
    setMicNote(null);
    window.speechSynthesis?.cancel();
    stepsRef.current = [];
    setLiveSteps([]);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "user", text: utterance },
    ]);
    const turn = ++turnRef.current;
    setPhase("running");
    setPanel("talk");

    let spoke = false;
    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ utterance, ledger: auditRef.current.entries }),
      });
      if (!response.ok || !response.body) {
        const failure = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(failure?.error || "The console couldn't reach the agent.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastReveal = 0;
      const pace = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StreamEvent;
          const wait = Math.max(0, pace - (Date.now() - lastReveal));
          if (wait) await sleep(wait);
          lastReveal = Date.now();
          if (event.type === "meta") {
            setPlannerState({ kind: event.planner, note: event.note });
          } else if (event.type === "step") {
            stepsRef.current = [...stepsRef.current, event.step];
            setLiveSteps(stepsRef.current);
          } else if (event.type === "done") {
            const id = crypto.randomUUID();
            const steps = stepsRef.current;
            setMessages((current) => [
              ...current,
              {
                id,
                role: "assistant",
                text: event.turn.say,
                steps,
                approval: event.turn.approval,
                draft: event.turn.draft,
              },
            ]);
            setPinnedId(id);
            setLiveSteps([]);
            if (speakReplies) {
              spoke = speak(event.turn.say, () => {
                if (turnRef.current === turn) setPhase("idle");
              });
              if (turnRef.current === turn) setPhase(spoke ? "speaking" : "idle");
            }
          } else if (event.type === "ledger") {
            auditRef.current = event.audit;
            setAudit(event.audit);
          } else if (event.type === "error") {
            throw new Error(event.message);
          }
        }
      }

    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "I couldn't finish that turn.";
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "I lost the turn before I could answer. Check the audit log before you retry — a step may already have been written.",
        },
      ]);
    } finally {
      if (!spoke && turnRef.current === turn) setPhase("idle");
    }
  }

  function toggleMic() {
    const Ctor = getRecognition();
    if (!Ctor) {
      setMicNote("This browser has no speech recognition. Type the line instead.");
      return;
    }
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new Ctor();
    let failed = false;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      let text = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        text += event.results[index][0].transcript;
      }
      transcriptRef.current = text;
      setDraft(text);
    };
    recognition.onerror = () => {
      failed = true;
      setMicNote("The mic didn't catch that. Type the line instead.");
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
      const spoken = transcriptRef.current.trim();
      transcriptRef.current = "";
      if (!failed && spoken) void submit(spoken);
    };
    recognitionRef.current = recognition;
    setListening(true);
    setMicNote(null);
    try {
      recognition.start();
    } catch {
      setListening(false);
      setMicNote("The mic is already in use.");
    }
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <AlexaOrb state={orbState} size="sm" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-2xl leading-none italic tracking-tight">
                FieldClear
              </h1>
              <Badge variant="secondary">Alexa+</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {shop.name} · {shop.city} · {shop.dispatcher} on dispatch
            </p>
          </div>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="h-6 cursor-default px-2">
              {plannerState.kind === "bedrock" ? "Bedrock Converse" : "Local planner"}
            </Badge>
          </TooltipTrigger>
          <TooltipContent>{plannerState.note}</TooltipContent>
        </Tooltip>
      </header>

      <div className="shrink-0 border-b border-border">
        <div className="flex items-center gap-2 overflow-x-auto px-4 py-2 sm:px-6">
          <span className="shrink-0 text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
            Board
          </span>
          {trucks.map((truck) => {
            const job = jobs.find((item) => item.truckId === truck.id);
            return (
              <button
                key={truck.id}
                type="button"
                onClick={() => void submit(`What's pending for truck ${truck.number}?`)}
                disabled={phase === "running"}
                className="flex shrink-0 items-center gap-2 rounded-full bg-card/80 px-3 py-1.5 text-left ring-1 ring-foreground/10 transition hover:ring-primary/40 disabled:opacity-50"
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    truck.status === "on_job" ? "bg-approve" : "bg-muted-foreground",
                  )}
                />
                <span className="font-mono text-xs text-primary">T{truck.number}</span>
                <span className="text-xs">
                  <span className="block leading-tight">{truck.techName.split(" ")[0]}</span>
                  <span className="block text-[11px] text-muted-foreground">
                    {tradeLabel(truck.trade)}
                    {job ? ` · ${job.title}` : " · idle"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Tabs
        value={panel}
        onValueChange={(value) => setPanel(value as Panel)}
        className="shrink-0 lg:hidden"
      >
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="talk">Talk</TabsTrigger>
          <TabsTrigger value="tools">Tools</TabsTrigger>
          <TabsTrigger value="audit">Audit</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <section
          className={cn(
            "flex min-h-0 flex-col",
            panel !== "talk" && "max-lg:hidden",
          )}
          aria-label="Conversation"
        >
          <ScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6 sm:px-6">
              {messages.length === 0 && phase !== "running" ? (
                <EmptyState onPick={(utterance) => void submit(utterance)} />
              ) : null}
              {messages.map((item) => (
                <MessageBubble
                  key={item.id}
                  item={item}
                  selected={item.id === pinnedId}
                  onSelect={() => {
                    if (item.role === "assistant") setPinnedId(item.id);
                  }}
                />
              ))}
              {phase === "running" ? (
                <div className="flex items-center gap-3 text-sm text-primary">
                  <AlexaOrb state="running" size="sm" />
                  <p>{activeTool ? toolCaption(activeTool) : "Starting the tool loop"}…</p>
                </div>
              ) : null}
              {error ? (
                <p className="text-sm text-deny" role="alert">
                  {error}
                </p>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </ScrollArea>
          <form
            className="shrink-0 border-t border-border px-4 py-3 sm:px-6"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(draft);
            }}
          >
            <div className="mx-auto flex max-w-3xl flex-col gap-2">
              {messages.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {demoPrompts.map((prompt) => (
                    <Button
                      key={prompt.name}
                      type="button"
                      size="sm"
                      variant={prompt.name === "deny-over-cap" ? "ghost" : "outline"}
                      className="h-auto px-2.5 py-1 text-left whitespace-normal"
                      disabled={phase === "running"}
                      onClick={() => void submit(prompt.utterance)}
                    >
                      {prompt.utterance}
                    </Button>
                  ))}
                </div>
              ) : null}
              <div className="flex items-end gap-2 rounded-3xl bg-card/80 p-2 ring-1 ring-foreground/10">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="icon-lg"
                      variant={listening ? "default" : "ghost"}
                      aria-pressed={listening}
                      aria-label={listening ? "Stop listening" : "Speak a request"}
                      onClick={toggleMic}
                      disabled={phase === "running"}
                    >
                      <Mic />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {canListen
                      ? "Speak, then I'll send it when you pause"
                      : "Speech recognition isn't in this browser"}
                  </TooltipContent>
                </Tooltip>
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void submit(draft);
                    }
                  }}
                  rows={1}
                  placeholder="Ask Alexa+ to clear spend, check a job, or draft a text"
                  aria-label="Message FieldClear"
                  className="max-h-32 min-h-10 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
                  disabled={phase === "running"}
                />
                {speechReady ? (
                  <Button
                    type="button"
                    size="icon-lg"
                    variant="ghost"
                    aria-pressed={speakReplies}
                    aria-label={speakReplies ? "Mute spoken replies" : "Speak replies"}
                    onClick={() => {
                      setSpeakReplies((value) => !value);
                      window.speechSynthesis?.cancel();
                    }}
                  >
                    {speakReplies ? <Volume2 /> : <VolumeX />}
                  </Button>
                ) : null}
                <Button
                  type="submit"
                  size="icon-lg"
                  aria-label="Send"
                  disabled={!draft.trim() || phase === "running"}
                >
                  <ArrowUp />
                </Button>
              </div>
              <p className="px-2 text-[11px] leading-relaxed text-muted-foreground">
                {micNote ??
                  "Simulated Alexa+. Tools run on this machine. Texts stay drafts, and spend is only an audit line."}
              </p>
            </div>
          </form>
        </section>

        <aside
          className={cn(
            "flex min-h-0 flex-col border-border lg:border-l",
            panel === "talk" && "max-lg:hidden",
          )}
        >
          <div className={cn("flex min-h-0 flex-1 flex-col", panel === "audit" && "max-lg:hidden")}>
            <ToolTrail steps={trailSteps} activeTool={activeTool} running={phase === "running"} />
          </div>
          <Separator className={cn(panel !== "talk" && "max-lg:hidden")} />
          <div className={cn("flex min-h-0 flex-1 flex-col", panel === "tools" && "max-lg:hidden")}>
            <AuditPanel audit={audit} resetting={resetting} onReset={resetDemo} />
          </div>
        </aside>
      </div>
      <p className="sr-only" aria-live="polite">
        {messages.filter((item) => item.role === "assistant").at(-1)?.text ?? ""}
      </p>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (utterance: string) => void }) {
  return (
    <div className="flex flex-col items-center px-2 pt-8 pb-4 text-center sm:pt-16">
      <AlexaOrb state="idle" size="lg" />
      <p className="font-display mt-6 text-4xl italic tracking-tight">What should I clear?</p>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Parts, fuel, and the customer text. I check policy and write the audit log before I say yes.
      </p>
      <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
        {demoPrompts.map((prompt) => (
          <Button
            key={prompt.name}
            type="button"
            variant={prompt.name === "deny-over-cap" ? "ghost" : "outline"}
            className="h-auto max-w-full px-3 py-2 text-left whitespace-normal"
            onClick={() => onPick(prompt.utterance)}
          >
            {prompt.utterance}
          </Button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  item,
  selected,
  onSelect,
}: {
  item: ChatItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const mine = item.role === "user";
  return (
    <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
      <div className={cn("max-w-[40rem]", mine ? "max-w-[34rem]" : "w-full")}>
        {mine ? (
          <p className="rounded-3xl bg-secondary px-4 py-2.5 text-sm leading-relaxed">
            {item.text}
          </p>
        ) : (
          <div
            onClick={onSelect}
            className={cn(
              "w-full cursor-pointer rounded-3xl px-1 text-left",
              selected && "bg-primary/5",
            )}
          >
            <span className="flex items-start gap-3">
              <AlexaOrb state="idle" size="sm" className="mt-0.5 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-relaxed">{item.text}</span>
                {item.approval ? <ApprovalCard approval={item.approval} /> : null}
                {item.draft ? <DraftCard draft={item.draft} /> : null}
              </span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function latestSteps(messages: ChatItem[]): ToolStep[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const steps = messages[index].steps;
    if (steps && steps.length > 0) return steps;
  }
  return [];
}

function getRecognition(): (new () => SpeechRec) | null {
  if (typeof window === "undefined") return null;
  const candidate = window as Window & {
    SpeechRecognition?: new () => SpeechRec;
    webkitSpeechRecognition?: new () => SpeechRec;
  };
  return candidate.SpeechRecognition ?? candidate.webkitSpeechRecognition ?? null;
}

function speak(text: string, onEnd: () => void): boolean {
  if (typeof window === "undefined" || !window.speechSynthesis) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1.02;
  const voices = window.speechSynthesis.getVoices();
  utterance.voice =
    voices.find(
      (voice) =>
        voice.lang.startsWith("en") &&
        /samantha|aria|jenny|google us english|natural/i.test(voice.name),
    ) ??
    voices.find((voice) => voice.lang.startsWith("en-US")) ??
    voices.find((voice) => voice.lang.startsWith("en")) ??
    null;
  utterance.onend = onEnd;
  utterance.onerror = onEnd;
  window.speechSynthesis.speak(utterance);
  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
