import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { GlitchMcpError } from "./errors.js";

export const DEFAULT_SOCIAL_ASSET_FOLDERS = [
  "captures",
  "screenshots",
  "trailers",
  "builds/latest/social",
  "marketing",
  ".glitch/social-assets"
] as const;

const DEFAULT_IGNORE_PATTERNS = [
  ".git",
  "node_modules",
  "vendor",
  "Library",
  "Temp",
  "Build",
  "DerivedDataCache",
  "Saved",
  "*.psd",
  "*.blend",
  "*.kra",
  "*.env"
] as const;

const SOCIAL_ASSET_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm"
};

const VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm"]);

export interface SocialAssetConfig {
  readonly version: 1;
  readonly asset_roots: string[];
  readonly allowed_types: string[];
  readonly max_file_size_mb: number;
  readonly ignore: string[];
  readonly upload_mode: "manual_review";
  readonly created_at?: string;
  readonly updated_at?: string;
}

export interface SocialAssetWatchConfig {
  readonly version: 1;
  readonly enabled: boolean;
  readonly project_root: string;
  readonly interval_hours: number;
  readonly scan_options: SocialAssetWatchScanOptions;
  readonly last_scan_at?: string;
  readonly next_scan_at?: string;
  readonly updated_at: string;
}

export interface SocialAssetWatchScanOptions {
  readonly folders?: readonly string[];
  readonly max_files: number;
  readonly max_depth: number;
  readonly min_score: number;
  readonly since_hours?: number;
  readonly write_manifest: boolean;
}

export interface SocialAssetWatchResult {
  readonly project_root: string;
  readonly enabled: boolean;
  readonly interval_hours: number;
  readonly watch_config_path: string;
  readonly next_scan_at?: string;
  readonly scan?: SocialAssetScanResult;
}

export interface SocialAssetCandidate {
  readonly id: string;
  readonly sha256: string;
  readonly file_path: string;
  readonly relative_path: string;
  readonly asset_root: string;
  readonly file_name: string;
  readonly extension: string;
  readonly mime_type: string;
  readonly media_kind: "image" | "video";
  readonly size_bytes: number;
  readonly modified_at: string;
  readonly score: number;
  readonly reasons: string[];
  readonly suggested_platforms: string[];
}

export interface SocialAssetScanResult {
  readonly project_root: string;
  readonly scanned_roots: string[];
  readonly candidates: SocialAssetCandidate[];
  readonly manifest_path?: string;
  readonly ignored_roots: string[];
}

export interface SocialAssetSetupResult {
  readonly project_root: string;
  readonly folders: string[];
  readonly config_path?: string;
  readonly watch_config_path?: string;
  readonly created_or_verified: string[];
}

const activeWatches = new Map<string, ReturnType<typeof setInterval>>();

export function socialAssetConfigPath(projectRoot: string): string {
  return join(projectRoot, ".glitch", "social-assets", "config.json");
}

export function socialAssetManifestPath(projectRoot: string): string {
  return join(projectRoot, ".glitch", "social-assets", "candidates.json");
}

export function socialAssetWatchConfigPath(projectRoot: string): string {
  return join(projectRoot, ".glitch", "social-assets", "watch.json");
}

export function isSocialAssetExtension(extension: string): boolean {
  return Boolean(SOCIAL_ASSET_MIME_BY_EXTENSION[extension.toLowerCase()]);
}

export function mimeTypeForSocialAsset(fileName: string): string | undefined {
  return SOCIAL_ASSET_MIME_BY_EXTENSION[extname(fileName).replace(/^\./, "").toLowerCase()];
}

export async function assertLocalPathAllowed(path: string, allowedRoots: readonly string[], label = "Path"): Promise<void> {
  if (allowedRoots.length === 0) {
    return;
  }

  let real: string;
  try {
    real = await realpath(path);
  } catch {
    throw new GlitchMcpError("not_found", `${label} "${path}" does not exist or cannot be read.`);
  }

  const allowed = await Promise.all(
    allowedRoots.map(async (root) => {
      try {
        const absoluteRoot = isAbsolute(root) ? root : resolve(root);
        const rootRealPath = await realpath(absoluteRoot);
        const pathFromRoot = relative(rootRealPath, real);
        return pathFromRoot === "" || (!pathFromRoot.startsWith("..") && !pathFromRoot.includes(`..${sep}`) && !isAbsolute(pathFromRoot));
      } catch {
        return false;
      }
    })
  );

  if (!allowed.some(Boolean)) {
    throw new GlitchMcpError(
      "permission_denied",
      `${label} "${path}" is outside GLITCH_MCP_UPLOAD_ALLOWED_ROOTS. Move it into an allowed workspace or update the allow-list.`
    );
  }
}

export async function setupSocialAssetFolders(
  projectRoot: string,
  folders: readonly string[] = DEFAULT_SOCIAL_ASSET_FOLDERS,
  writeConfig = true
): Promise<SocialAssetSetupResult> {
  const root = await resolveProjectRoot(projectRoot);
  const normalizedFolders = normalizeAssetFolders(folders);
  const createdOrVerified: string[] = [];

  for (const folder of normalizedFolders) {
    const absolute = join(root, folder);
    await mkdir(absolute, { recursive: true });
    createdOrVerified.push(absolute);
  }

  let configPath: string | undefined;
  let watchConfigPath: string | undefined;
  if (writeConfig) {
    configPath = socialAssetConfigPath(root);
    watchConfigPath = socialAssetWatchConfigPath(root);
    await mkdir(join(root, ".glitch", "social-assets"), { recursive: true });
    const now = new Date().toISOString();
    const config: SocialAssetConfig = {
      version: 1,
      asset_roots: normalizedFolders,
      allowed_types: Object.keys(SOCIAL_ASSET_MIME_BY_EXTENSION),
      max_file_size_mb: 50,
      ignore: [...DEFAULT_IGNORE_PATTERNS],
      upload_mode: "manual_review",
      created_at: now,
      updated_at: now
    };
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await writeFile(
      watchConfigPath,
      `${JSON.stringify(defaultWatchConfig(root, {
        max_files: 50,
        max_depth: 4,
        min_score: 20,
        write_manifest: true
      }, false), null, 2)}\n`,
      "utf8"
    );
  }

  return {
    project_root: root,
    folders: normalizedFolders,
    ...(configPath ? { config_path: configPath } : {}),
    ...(watchConfigPath ? { watch_config_path: watchConfigPath } : {}),
    created_or_verified: createdOrVerified
  };
}

export async function scanSocialAssetFolders(
  projectRoot: string,
  options: {
    readonly folders?: readonly string[];
    readonly maxFiles: number;
    readonly maxDepth: number;
    readonly minScore: number;
    readonly sinceHours?: number;
    readonly writeManifest: boolean;
  }
): Promise<SocialAssetScanResult> {
  const root = await resolveProjectRoot(projectRoot);
  const config = await readSocialAssetConfig(root);
  const folders = normalizeAssetFolders(options.folders ?? config?.asset_roots ?? DEFAULT_SOCIAL_ASSET_FOLDERS);
  const maxBytes = Math.max(1, config?.max_file_size_mb ?? 50) * 1024 * 1024;
  const allowedExtensions = new Set((config?.allowed_types ?? Object.keys(SOCIAL_ASSET_MIME_BY_EXTENSION)).map((value) => value.toLowerCase()));
  const ignoredRoots: string[] = [];
  const candidates: SocialAssetCandidate[] = [];
  const sinceMs = options.sinceHours ? Date.now() - options.sinceHours * 60 * 60 * 1000 : undefined;

  for (const folder of folders) {
    const absolute = join(root, folder);
    let rootStat;
    try {
      rootStat = await stat(absolute);
    } catch {
      ignoredRoots.push(absolute);
      continue;
    }
    if (!rootStat.isDirectory()) {
      ignoredRoots.push(absolute);
      continue;
    }
    await walkAssetRoot(root, absolute, folder, options.maxDepth, async (filePath) => {
      const extension = extname(filePath).replace(/^\./, "").toLowerCase();
      if (!allowedExtensions.has(extension) || !isSocialAssetExtension(extension)) {
        return;
      }

      const metadata = await stat(filePath);
      if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maxBytes) {
        return;
      }
      if (sinceMs && metadata.mtimeMs < sinceMs) {
        return;
      }

      const sha256 = await hashLocalAssetFile(filePath);
      const candidate = buildCandidate(root, folder, filePath, metadata.mtimeMs, metadata.size, sha256);
      if (candidate.score >= options.minScore) {
        candidates.push(candidate);
      }
    });
  }

  const sorted = dedupeCandidatesByHash(
    candidates.sort((a, b) => b.score - a.score || Date.parse(b.modified_at) - Date.parse(a.modified_at))
  ).slice(0, options.maxFiles);

  let manifestPath: string | undefined;
  if (options.writeManifest) {
    manifestPath = socialAssetManifestPath(root);
    await mkdir(join(root, ".glitch", "social-assets"), { recursive: true });
    await writeFile(
      manifestPath,
      `${JSON.stringify({ generated_at: new Date().toISOString(), project_root: root, candidates: sorted }, null, 2)}\n`,
      "utf8"
    );
  }

  return {
    project_root: root,
    scanned_roots: folders.map((folder) => join(root, folder)),
    candidates: sorted,
    ...(manifestPath ? { manifest_path: manifestPath } : {}),
    ignored_roots: ignoredRoots
  };
}

export async function readSocialAssetManifest(projectRoot: string): Promise<SocialAssetCandidate[]> {
  const root = await resolveProjectRoot(projectRoot);
  const manifestPath = socialAssetManifestPath(root);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new GlitchMcpError("not_found", `No social asset scan manifest found at "${manifestPath}". Run glitch_scan_local_social_assets first or pass file_paths.`);
  }

  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { candidates?: unknown }).candidates)) {
    throw new GlitchMcpError("validation_error", `Social asset manifest "${manifestPath}" is malformed.`);
  }

  return (parsed as { candidates: unknown[] }).candidates.filter(isCandidate);
}

export async function startSocialAssetWatch(
  projectRoot: string,
  options: {
    readonly intervalHours?: number;
    readonly runImmediately?: boolean;
    readonly scanOptions?: Partial<SocialAssetWatchScanOptions>;
  } = {}
): Promise<SocialAssetWatchResult> {
  const root = await resolveProjectRoot(projectRoot);
  const intervalHours = clampIntervalHours(options.intervalHours ?? 24);
  const scanOptions = normalizeWatchScanOptions(options.scanOptions ?? {});

  stopActiveWatch(root);

  let scan: SocialAssetScanResult | undefined;
  const runScan = async (): Promise<SocialAssetScanResult> => {
    const result = await scanSocialAssetFolders(root, watchScanOptionsToScanOptions(scanOptions));
    await writeWatchConfig(root, defaultWatchConfig(root, scanOptions, true, intervalHours, new Date()));

    return result;
  };

  if (options.runImmediately ?? true) {
    scan = await runScan();
  } else {
    await writeWatchConfig(root, defaultWatchConfig(root, scanOptions, true, intervalHours));
  }

  const timer = setInterval(() => {
    void runScan().catch(() => {
      // The next manual scan or watcher tick can recover; avoid crashing the MCP process.
    });
  }, intervalHours * 60 * 60 * 1000);
  (timer as { unref?: () => void }).unref?.();
  activeWatches.set(root, timer);

  const config = await readSocialAssetWatchConfig(root);

  return {
    project_root: root,
    enabled: true,
    interval_hours: intervalHours,
    watch_config_path: socialAssetWatchConfigPath(root),
    ...(config?.next_scan_at ? { next_scan_at: config.next_scan_at } : {}),
    ...(scan ? { scan } : {})
  };
}

export async function stopSocialAssetWatch(projectRoot: string): Promise<SocialAssetWatchResult> {
  const root = await resolveProjectRoot(projectRoot);
  stopActiveWatch(root);

  const existing = await readSocialAssetWatchConfig(root);
  const scanOptions = existing?.scan_options ?? normalizeWatchScanOptions({});
  await writeWatchConfig(root, defaultWatchConfig(root, scanOptions, false, existing?.interval_hours ?? 24));

  return {
    project_root: root,
    enabled: false,
    interval_hours: existing?.interval_hours ?? 24,
    watch_config_path: socialAssetWatchConfigPath(root)
  };
}

export async function readSocialAssetWatchConfig(projectRoot: string): Promise<SocialAssetWatchConfig | undefined> {
  try {
    const parsed = JSON.parse(await readFile(socialAssetWatchConfigPath(projectRoot), "utf8"));
    if (isWatchConfig(parsed)) {
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

export async function hashLocalAssetFile(filePath: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("error", rejectHash);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

function isCandidate(value: unknown): value is SocialAssetCandidate {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string" && typeof (value as { file_path?: unknown }).file_path === "string";
}

function dedupeCandidatesByHash(candidates: readonly SocialAssetCandidate[]): SocialAssetCandidate[] {
  const unique = new Map<string, SocialAssetCandidate>();
  for (const candidate of candidates) {
    if (!unique.has(candidate.sha256)) {
      unique.set(candidate.sha256, candidate);
    }
  }

  return [...unique.values()];
}

function clampIntervalHours(value: number): number {
  if (!Number.isFinite(value)) {
    return 24;
  }

  return Math.max(1, Math.min(168, value));
}

function normalizeWatchScanOptions(options: Partial<SocialAssetWatchScanOptions>): SocialAssetWatchScanOptions {
  return {
    ...(options.folders ? { folders: normalizeAssetFolders(options.folders) } : {}),
    max_files: Math.max(1, Math.min(500, Math.trunc(options.max_files ?? 50))),
    max_depth: Math.max(0, Math.min(8, Math.trunc(options.max_depth ?? 4))),
    min_score: Math.max(0, Math.min(100, Math.trunc(options.min_score ?? 20))),
    ...(options.since_hours ? { since_hours: Math.max(1, Math.min(8760, options.since_hours)) } : {}),
    write_manifest: options.write_manifest ?? true
  };
}

function watchScanOptionsToScanOptions(options: SocialAssetWatchScanOptions): {
  readonly folders?: readonly string[];
  readonly maxFiles: number;
  readonly maxDepth: number;
  readonly minScore: number;
  readonly sinceHours?: number;
  readonly writeManifest: boolean;
} {
  return {
    ...(options.folders ? { folders: options.folders } : {}),
    maxFiles: options.max_files,
    maxDepth: options.max_depth,
    minScore: options.min_score,
    ...(options.since_hours ? { sinceHours: options.since_hours } : {}),
    writeManifest: options.write_manifest
  };
}

function defaultWatchConfig(
  projectRoot: string,
  scanOptions: Partial<SocialAssetWatchScanOptions>,
  enabled: boolean,
  intervalHours = 24,
  lastScanAt?: Date
): SocialAssetWatchConfig {
  const now = new Date();
  const normalized = normalizeWatchScanOptions(scanOptions);
  const nextScanAt = new Date(now.getTime() + clampIntervalHours(intervalHours) * 60 * 60 * 1000);

  return {
    version: 1,
    enabled,
    project_root: projectRoot,
    interval_hours: clampIntervalHours(intervalHours),
    scan_options: normalized,
    ...(lastScanAt ? { last_scan_at: lastScanAt.toISOString() } : {}),
    ...(enabled ? { next_scan_at: nextScanAt.toISOString() } : {}),
    updated_at: now.toISOString()
  };
}

async function writeWatchConfig(projectRoot: string, config: SocialAssetWatchConfig): Promise<void> {
  await mkdir(join(projectRoot, ".glitch", "social-assets"), { recursive: true });
  await writeFile(socialAssetWatchConfigPath(projectRoot), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

function stopActiveWatch(projectRoot: string): void {
  const existing = activeWatches.get(projectRoot);
  if (existing) {
    clearInterval(existing);
    activeWatches.delete(projectRoot);
  }
}

function isWatchConfig(value: unknown): value is SocialAssetWatchConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { version?: unknown }).version === 1 &&
    typeof (value as { enabled?: unknown }).enabled === "boolean" &&
    typeof (value as { project_root?: unknown }).project_root === "string" &&
    typeof (value as { interval_hours?: unknown }).interval_hours === "number" &&
    typeof (value as { scan_options?: unknown }).scan_options === "object" &&
    (value as { scan_options?: unknown }).scan_options !== null
  );
}

async function readSocialAssetConfig(projectRoot: string): Promise<SocialAssetConfig | undefined> {
  try {
    const parsed = JSON.parse(await readFile(socialAssetConfigPath(projectRoot), "utf8"));
    if (typeof parsed === "object" && parsed !== null && Array.isArray(parsed.asset_roots)) {
      return parsed as SocialAssetConfig;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function resolveProjectRoot(projectRoot: string): Promise<string> {
  const resolved = isAbsolute(projectRoot) ? projectRoot : resolve(projectRoot);
  let metadata;
  try {
    metadata = await stat(resolved);
  } catch {
    throw new GlitchMcpError("not_found", `Project root "${projectRoot}" does not exist.`);
  }
  if (!metadata.isDirectory()) {
    throw new GlitchMcpError("validation_error", `Project root "${projectRoot}" is not a directory.`);
  }
  return realpath(resolved);
}

function normalizeAssetFolders(folders: readonly string[]): string[] {
  const normalized = folders
    .map((folder) => folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .filter((folder, index, all) => all.indexOf(folder) === index);

  for (const folder of normalized) {
    if (isAbsolute(folder) || folder.split("/").includes("..")) {
      throw new GlitchMcpError("validation_error", `Asset folder "${folder}" must be relative to the project root and cannot contain "..".`);
    }
  }

  return normalized;
}

async function walkAssetRoot(
  projectRoot: string,
  directory: string,
  assetRoot: string,
  depthRemaining: number,
  onFile: (filePath: string) => Promise<void>
): Promise<void> {
  if (depthRemaining < 0 || shouldIgnorePath(projectRoot, directory)) {
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(directory, entry.name);
    if (entry.isSymbolicLink() || shouldIgnorePath(projectRoot, child)) {
      continue;
    }
    if (entry.isDirectory()) {
      await walkAssetRoot(projectRoot, child, assetRoot, depthRemaining - 1, onFile);
    } else if (entry.isFile()) {
      await onFile(child);
    }
  }
}

function shouldIgnorePath(projectRoot: string, path: string): boolean {
  const rel = relative(projectRoot, path).replace(/\\/g, "/");
  const parts = rel.split("/");
  return parts.some((part) => [".git", "node_modules", "vendor", "Library", "Temp", "DerivedDataCache"].includes(part));
}

function buildCandidate(projectRoot: string, assetRoot: string, filePath: string, mtimeMs: number, sizeBytes: number, sha256: string): SocialAssetCandidate {
  const fileName = basename(filePath);
  const extension = extname(fileName).replace(/^\./, "").toLowerCase();
  const mediaKind = VIDEO_EXTENSIONS.has(extension) ? "video" : "image";
  const relativePath = relative(projectRoot, filePath).replace(/\\/g, "/");
  const reasons: string[] = [];
  let score = mediaKind === "video" ? 25 : 20;

  const lowerRoot = assetRoot.toLowerCase();
  if (lowerRoot.includes("trailer")) {
    score += 22;
    reasons.push("trailer folder");
  } else if (lowerRoot.includes("capture")) {
    score += 20;
    reasons.push("capture folder");
  } else if (lowerRoot.includes("screenshot")) {
    score += 18;
    reasons.push("screenshot folder");
  } else if (lowerRoot.includes("social")) {
    score += 18;
    reasons.push("social export folder");
  } else if (lowerRoot.includes("marketing")) {
    score += 12;
    reasons.push("marketing folder");
  }

  const ageHours = (Date.now() - mtimeMs) / (60 * 60 * 1000);
  if (ageHours <= 24) {
    score += 20;
    reasons.push("created or modified in the last day");
  } else if (ageHours <= 24 * 7) {
    score += 12;
    reasons.push("created or modified this week");
  } else if (ageHours <= 24 * 30) {
    score += 6;
    reasons.push("created or modified this month");
  }

  const lowerName = fileName.toLowerCase();
  for (const [pattern, label] of [
    [/trailer|teaser|launch/, "trailer or launch filename"],
    [/gameplay|combat|boss|biome|level|quest|feature/, "gameplay feature filename"],
    [/before.?after|comparison|rework|improvement/, "before/after filename"],
    [/vertical|short|reel|tiktok|portrait/, "short-form vertical filename"],
    [/capsule|key.?art|poster|hero/, "marketing art filename"]
  ] as const) {
    if (pattern.test(lowerName)) {
      score += 10;
      reasons.push(label);
    }
  }

  if (/thumb|thumbnail|temp|tmp|cache|debug|backup/.test(lowerName)) {
    score -= 25;
    reasons.push("filename looks temporary or low-value");
  }
  if (sizeBytes < 10 * 1024) {
    score -= 15;
    reasons.push("very small file");
  }

  if (reasons.length === 0) {
    reasons.push(mediaKind === "video" ? "video asset" : "image asset");
  }

  return {
    id: createHash("sha1").update(`${sha256}|${relativePath}`).digest("hex").slice(0, 16),
    sha256,
    file_path: filePath,
    relative_path: relativePath,
    asset_root: assetRoot,
    file_name: fileName,
    extension,
    mime_type: SOCIAL_ASSET_MIME_BY_EXTENSION[extension] || "application/octet-stream",
    media_kind: mediaKind,
    size_bytes: sizeBytes,
    modified_at: new Date(mtimeMs).toISOString(),
    score: Math.max(0, Math.min(100, score)),
    reasons,
    suggested_platforms: suggestedPlatforms(mediaKind, lowerName)
  };
}

function suggestedPlatforms(mediaKind: "image" | "video", lowerName: string): string[] {
  if (mediaKind === "video") {
    if (/vertical|short|reel|tiktok|portrait/.test(lowerName)) {
      return ["tiktok", "instagram", "youtube", "twitter", "discord"];
    }
    return ["youtube", "twitter", "reddit", "discord", "tiktok", "instagram"];
  }

  if (/capsule|key.?art|poster|hero/.test(lowerName)) {
    return ["twitter", "bluesky", "reddit", "discord", "instagram"];
  }

  return ["twitter", "reddit", "discord", "instagram", "bluesky"];
}
