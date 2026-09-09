import { CRT_SCREENS, CRT_STYLES, type CrtStyle, type CrtVariant } from "./crtScreens";
import { CRT_FRAGMENT_SHADER, CRT_VERTEX_SHADER } from "./crtShaders";

export const CRT_VARIANTS = ["terminal", "cinematic", "blue-screen", "nintendo"] as const;
export type CrtChatLine = { id: string; sender: string; body: string };
export type CrtOptions = {
  variant: CrtVariant;
  speed: number;
  typeSpeed: number;
  motion: number;
  brightness: number;
  opacity: number;
  hue: number;
  saturation: number;
  messages: CrtChatLine[];
  live: boolean;
  joined: boolean;
  nick: string;
  draft: string;
  hint: string;
  cwd: string;
  promptKind: "shell" | "select" | "password";
};
export const CRT_DEFAULTS: CrtOptions = {
  variant: "terminal",
  speed: 1,
  typeSpeed: 1,
  motion: 1,
  brightness: 1,
  opacity: 1,
  hue: 0,
  saturation: 1,
  messages: [],
  live: false,
  joined: false,
  nick: "",
  draft: "",
  hint: "",
  cwd: "~",
  promptKind: "shell",
};
export const crtStyle = (variant: CrtVariant): CrtStyle => CRT_STYLES[variant] ?? CRT_STYLES.terminal;
type Segment = { t: string; c: "p" | "d" | "a" | "h" };
const segment = (text: string, color: Segment["c"] = "p"): Segment => ({ t: text, c: color });
const CRT_FONT = `"ThreeUI Fragment Mono", ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace`;
function colsFor(cssWidth: number) {
  if (cssWidth < 480) return 28;
  if (cssWidth < 720) return 40;
  return 56;
}
function rowsFor(cssWidth: number) {
  if (cssWidth < 480) return 13;
  if (cssWidth < 720) return 16;
  return 19;
}
function wrapBody(text: string, wrap: number) {
  const out: string[] = [];
  for (const para of text.replace(/\s+/g, " ").trim().split("\n")) {
    let rest = para;
    if (!rest) { out.push(""); continue; }
    while (rest.length > wrap) {
      out.push(rest.slice(0, wrap));
      rest = rest.slice(wrap);
    }
    out.push(rest);
  }
  return out.length ? out : [""];
}
function wrapLines(text: string, wrap: number) {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let rest = para;
    if (!rest) {
      out.push("");
      continue;
    }
    while (rest.length > wrap) {
      out.push(rest.slice(0, wrap));
      rest = rest.slice(wrap);
    }
    out.push(rest);
  }
  return out.length ? out : [""];
}
function messageRows(messages: CrtChatLine[], wrap: number): Segment[][] {
  const rows: Segment[][] = [];
  for (const msg of messages) {
    if (!msg.sender) {
      for (const extra of wrapLines(msg.body, wrap)) rows.push([segment(extra, "d")]);
      continue;
    }
    const name = msg.sender.slice(0, 16);
    const body = msg.body.slice(0, 400);
    if (wrap < 40) {
      rows.push([segment(name, "a")]);
      for (const extra of wrapBody(body, wrap)) rows.push([segment(extra, "p")]);
    } else {
      const room = Math.max(8, wrap - name.length - 2);
      rows.push([segment(name, "a"), segment("  ", "d"), segment(body.slice(0, room), "p")]);
      for (const extra of wrapBody(body.slice(room), wrap)) rows.push([segment(extra, "p")]);
    }
    rows.push([]);
  }
  return rows;
}
function promptRows(prefix: string, value: string, prefixColor: Segment["c"], wrap: number): Segment[][] {
  if (prefix.length + value.length <= wrap) return [[segment(prefix, prefixColor), segment(value, "p")]];
  const room = Math.max(1, wrap - prefix.length);
  const rows: Segment[][] = [[segment(prefix, prefixColor), segment(value.slice(0, room), "p")]];
  for (const extra of wrapBody(value.slice(room), wrap)) rows.push([segment(extra, "p")]);
  return rows;
}
function buildScreen(options: CrtOptions, wrap: number, minRows: number): Segment[][] {
  const right = options.live ? "live" : "offline";
  const title = (options.cwd || "~").replace(/^~\//, "").toUpperCase() || "HOME";
  const label = title.length > 12 ? title.slice(0, 12) : title;
  const gap = Math.max(2, wrap - label.length - right.length);
  const header: Segment[][] = [
    [segment(label === "~" || label === "HOME" ? "HOME" : label, "d"), segment(" ".repeat(gap), "d"), segment(right, options.live ? "p" : "a")],
    [segment("chat.jdump", "h")],
    [],
  ];
  let body = messageRows(options.messages ?? [], wrap);
  if (!body.length && !options.live) body = [[segment("no carrier", "d")]];
  const footer: Segment[][] = [];
  if (options.hint) footer.push([segment(options.hint.slice(0, wrap), "a")]);
  const nick = (options.nick || "anon").slice(0, 16);
  const path = options.cwd || "~";
  const kind = options.promptKind || "shell";
  const prefix = kind === "select" ? "Select: " : kind === "password" ? "Password: " : `${nick}@chat:${path}$ `;
  const draft = kind === "password" ? "*".repeat((options.draft ?? "").length) : options.draft;
  footer.push(...promptRows(prefix, draft, kind === "shell" ? "a" : "d", wrap));
  const room = Math.max(minRows - header.length - footer.length, 4);
  const last = (options.messages ?? []).at(-1);
  const sysDump = last && !last.sender ? messageRows([last], wrap) : null;
  const shown = sysDump && sysDump.length > room ? sysDump : body.slice(-room);
  const pad = shown === sysDump ? 0 : Math.max(0, room - shown.length);
  return [...header, ...shown, ...Array(pad).fill([]), ...footer];
}
const COLORS = { p: { fill: "#8df0b4", glow: "rgba(28,236,132,0.95)" }, d: { fill: "#4f9a76", glow: "rgba(28,236,132,0.45)" }, a: { fill: "#ffba5e", glow: "rgba(255,150,52,0.95)" }, h: { fill: "#eafff3", glow: "rgba(120,255,190,0.95)" } };
const lineLength = (line: Segment[]) => line.reduce((total, item) => total + item.t.length, 0);
/* backing-store ceiling: the composite is one triangle, so the cost that matters is
   the 2D screen redraw and its upload, not the fragment pass */
const MAX_BUFFER_WIDTH = 1920, MIN_BUFFER_WIDTH = 640, MAX_BUFFER_PIXELS = 2_400_000;
function compile(gl: WebGLRenderingContext, type: number, source: string) { const shader = gl.createShader(type); if (!shader) throw new Error("Unable to create CRT shader"); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "CRT shader compilation failed"); return shader; }

export function createCrtRenderer(host: HTMLElement, canvas: HTMLCanvasElement, getOptions: () => CrtOptions) {
  const gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, premultipliedAlpha: false }); if (!gl) throw new Error("CRT requires WebGL"); const textCanvas = document.createElement("canvas"), textContext = textCanvas.getContext("2d"); if (!textContext) throw new Error("CRT text canvas unavailable");
  const vertex = compile(gl, gl.VERTEX_SHADER, CRT_VERTEX_SHADER), fragment = compile(gl, gl.FRAGMENT_SHADER, CRT_FRAGMENT_SHADER), program = gl.createProgram(); if (!program) throw new Error("Unable to create CRT program"); gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "CRT link failed"); gl.useProgram(program);
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW); const position = gl.getAttribLocation(program, "aPos"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const uTexture = uniform("uTex"), uResolution = uniform("uRes"), uTime = uniform("uTime"), uMotion = uniform("uMotion"), uCurve = uniform("uCurve"), uScan = uniform("uScan"), uScanDepth = uniform("uScanDepth"), uTriad = uniform("uTriad"), uGrille = uniform("uGrille"), uChroma = uniform("uChroma"), uBar = uniform("uBar"), uFlicker = uniform("uFlicker"), uGrain = uniform("uGrain"), uNoise = uniform("uNoise"), uVignette = uniform("uVignette"), uMono = uniform("uMono"), uGain = uniform("uGain"), uHalo = uniform("uHalo"), uSheen = uniform("uSheen"), uRoom = uniform("uRoom");
  const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.uniform1i(uTexture, 0);
  let width = 1, height = 1, cssWidth = 1, cssHeight = 1, fontSize = 14, lineHeight = 20, startY = 0, charWidth = 8, caretX = 0, caretY = 0, typed = 0, done = true, textDirty = true, lastTextAt = 0, lastReveal = -1, lastBlink = -1, variant: CrtVariant = "terminal", style = crtStyle(variant), cols = 56, minRows = 19, log = buildScreen(CRT_DEFAULTS, 56, 19), total = 0, maxChars = 1, feedSig = ""; const startedAt = performance.now();
  const paper = new Image();
  paper.src = "/vaultboy.webp";
  paper.onload = () => { lastReveal = -1; lastBlink = -1; textDirty = true; };
  const measure = () => { total = log.reduce((n, line) => n + lineLength(line), 0); maxChars = Math.max(cols, ...log.map(lineLength)); };
  const syncFeed = (options: CrtOptions) => {
    const sig = `${(options.messages ?? []).map((m) => m.id).join("\n")}\0${options.live}\0${options.joined}\0${options.nick}\0${options.draft}\0${options.hint}\0${options.cwd}\0${options.promptKind}\0${cols}`;
    if (sig === feedSig) return;
    log = buildScreen(options, cols, minRows);
    measure();
    feedSig = sig;
    typed = total;
    done = true;
    layout();
    lastReveal = -1;
    lastBlink = -1;
    lastTextAt = 0;
    textDirty = true;
  };
  const applyStyle = () => {
    const t = Math.max(0, Math.min(1, (cssWidth - 400) / 500));
    gl.useProgram(program);
    gl.uniform2f(uCurve, style.curve[0] * (0.4 + 0.6 * t), style.curve[1] * (0.4 + 0.6 * t));
    gl.uniform1f(uScanDepth, style.scanDepth * (0.4 + 0.6 * t));
    gl.uniform1f(uGrille, style.grille * (0.2 + 0.8 * t));
    gl.uniform1f(uChroma, style.chroma * (0.2 + 0.8 * t));
    gl.uniform1f(uBar, style.bar);
    gl.uniform1f(uFlicker, style.flicker * (0.5 + 0.5 * t));
    gl.uniform1f(uGrain, style.grain);
    gl.uniform1f(uNoise, style.noise);
    gl.uniform1f(uVignette, style.vignette * (0.7 + 0.3 * t));
    gl.uniform1f(uMono, style.mono);
    gl.uniform1f(uGain, style.gain);
    gl.uniform1f(uHalo, style.halo * (0.3 + 0.7 * t));
    gl.uniform3f(uSheen, style.sheen[0], style.sheen[1], style.sheen[2]);
    gl.uniform3f(uRoom, style.room[0], style.room[1], style.room[2]);
    const filter = style.filtering === "nearest" ? gl.NEAREST : gl.LINEAR;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  };
  const layout = () => {
    startY = height * (cssWidth < 480 ? 0.10 : 0.135);
    lineHeight = height * (cssWidth < 480 ? 0.80 : 0.74) / Math.max(log.length, minRows);
    const minPx = (cssWidth < 480 ? 15 : cssWidth < 720 ? 13 : 8) * (width / cssWidth);
    fontSize = Math.max(minPx, Math.min(lineHeight * 0.82, width * 0.90 / (Math.max(maxChars, 1) * 0.62)));
    textContext.font = `600 ${fontSize.toFixed(2)}px ${CRT_FONT}`;
    charWidth = textContext.measureText("M").width || fontSize * 0.6;
  };
  const setStyle = (key: Segment["c"], glow: boolean) => { const color = COLORS[key]; textContext.fillStyle = color.fill; textContext.shadowColor = glow ? color.glow : "transparent"; textContext.shadowBlur = glow ? fontSize * (cssWidth < 480 ? 0.16 : 0.38) : 0; };
  /* two passes per glyph: a soft phosphor halo, then the same glyph re-filled with
     the shadow off so the stroke core stays crisp at any backing resolution */
  const drawScreen = (reveal: number) => {
    textContext.setTransform(1, 0, 0, 1, 0, 0);
    textContext.fillStyle = "#03100a";
    textContext.fillRect(0, 0, width, height);
    if (paper.complete && paper.naturalWidth) {
      const scale = Math.min((width * 0.4) / paper.naturalWidth, (height * 0.4) / paper.naturalHeight);
      const dw = paper.naturalWidth * scale, dh = paper.naturalHeight * scale;
      textContext.globalAlpha = 0.4;
      textContext.drawImage(paper, (width - dw) / 2, (height - dh) / 2, dw, dh);
      textContext.globalAlpha = 1;
    }
    textContext.textAlign = "left"; textContext.textBaseline = "top"; textContext.font = `600 ${fontSize.toFixed(2)}px ${CRT_FONT}`; let remaining = reveal, y = startY; caretX = Math.floor((width - maxChars * charWidth) / 2); caretY = startY;
    for (const line of log) { const length = lineLength(line), visible = reveal === Infinity ? Infinity : Math.min(remaining, length); let x = Math.floor((width - maxChars * charWidth) / 2), drawn = 0; for (const item of line) { let text = item.t; if (visible !== Infinity) { const left = visible - drawn; if (left <= 0) break; if (left < text.length) text = text.slice(0, left); } if (text.length) { setStyle(item.c, true); textContext.fillText(text, x, y); setStyle(item.c, false); textContext.fillText(text, x, y); x += charWidth * text.length; } drawn += item.t.length; if (visible !== Infinity && drawn >= visible) break; } caretX = x; caretY = y; if (visible !== Infinity) remaining -= visible; y += lineHeight; if (visible !== Infinity && remaining <= 0) break; }
  };
  const drawCursor = () => { textContext.shadowColor = COLORS.p.glow; textContext.shadowBlur = fontSize * 0.42; textContext.fillStyle = "#bdf8d2"; textContext.fillRect(caretX, caretY + fontSize * 0.06, Math.max(charWidth * 0.92, 4), fontSize * 0.96); textContext.shadowBlur = 0; textContext.fillRect(caretX, caretY + fontSize * 0.06, Math.max(charWidth * 0.92, 4), fontSize * 0.96); };
  const uploadTexture = () => { gl.bindTexture(gl.TEXTURE_2D, texture); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textCanvas); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); textDirty = false; };
  const resize = () => { const bounds = host.getBoundingClientRect(); cssWidth = Math.max(1, bounds.width); cssHeight = Math.max(1, bounds.height); const nextCols = colsFor(cssWidth), nextMinRows = rowsFor(cssWidth); if (nextCols !== cols || nextMinRows !== minRows) { cols = nextCols; minRows = nextMinRows; feedSig = ""; } const density = Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio || 1, 2); let nextWidth = Math.max(MIN_BUFFER_WIDTH, Math.round(Math.min(cssWidth * density, MAX_BUFFER_WIDTH))), nextHeight = Math.max(1, Math.round(nextWidth * cssHeight / cssWidth)); if (nextWidth * nextHeight > MAX_BUFFER_PIXELS) { const fit = Math.sqrt(MAX_BUFFER_PIXELS / (nextWidth * nextHeight)); nextWidth = Math.round(nextWidth * fit); nextHeight = Math.round(nextHeight * fit); }
    const surface = style.surface, screenWidth = surface.mode === "fixed" ? surface.width : surface.mode === "cap" ? Math.min(nextWidth, surface.width) : nextWidth, screenHeight = surface.mode === "fixed" ? surface.height : Math.max(1, Math.round(screenWidth * nextHeight / nextWidth));
    if (canvas.width !== nextWidth || canvas.height !== nextHeight) { canvas.width = nextWidth; canvas.height = nextHeight; }
    if (textCanvas.width !== screenWidth || textCanvas.height !== screenHeight) { textCanvas.width = screenWidth; textCanvas.height = screenHeight; width = screenWidth; height = screenHeight; }
    layout(); lastReveal = -1; lastBlink = -1; lastTextAt = 0; textDirty = true;
    applyStyle();
    gl.useProgram(program); gl.viewport(0, 0, nextWidth, nextHeight); gl.uniform2f(uResolution, nextWidth, nextHeight); gl.uniform1f(uScan, Math.max(120, Math.min(cssHeight * style.scanDensity, 900))); gl.uniform1f(uTriad, Math.max(2, style.triadCss * (cssWidth < 480 ? 1.6 : 1) * nextWidth / cssWidth)); };
  const maybeRedrawText = (now: number) => { const reveal = done ? Infinity : Math.floor(typed), blink = Math.floor((now - startedAt) / 420) % 2 === 0 ? 1 : 0, due = !done ? now - lastTextAt > 42 : blink !== lastBlink; if (reveal === lastReveal && blink === lastBlink && !due) return; if (!done && now - lastTextAt <= 42 && reveal === lastReveal && blink === lastBlink) return; drawScreen(reveal); if (blink) drawCursor(); lastTextAt = now; lastReveal = reveal; lastBlink = blink; textDirty = true; };
  applyStyle();
  if (typeof document !== "undefined") document.fonts.ready.then(() => { lastReveal = -1; lastBlink = -1; textDirty = true; });
  return {
    resize,
    render(now: number) {
      const options = getOptions(), requested = CRT_STYLES[options.variant] ? options.variant : "terminal";
      if (requested !== variant) { variant = requested; style = crtStyle(variant); applyStyle(); typed = 0; done = false; lastReveal = -1; lastBlink = -1; lastTextAt = 0; resize(); }
      if (variant === "terminal") syncFeed(options);
      const seconds = (now - startedAt) * 0.001 * options.speed;
      if (variant === "terminal") { if (!done) { typed += 4.4 * options.typeSpeed; if (typed >= total) { typed = total; done = true; } } maybeRedrawText(now); }
      else if (now - lastTextAt >= style.redrawMs || textDirty) { CRT_SCREENS[variant](textContext, width, height, seconds); lastTextAt = now; textDirty = true; }
      if (textDirty) uploadTexture();
      gl.useProgram(program); gl.uniform1f(uTime, seconds); gl.uniform1f(uMotion, options.motion); gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() { gl.deleteBuffer(buffer); gl.deleteTexture(texture); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment); },
  };
}
