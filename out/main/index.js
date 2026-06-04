"use strict";
const electron = require("electron");
const path = require("node:path");
const promises = require("node:fs/promises");
const node_child_process = require("node:child_process");
const node_crypto = require("node:crypto");
const OpenAI = require("openai");
const gptTokenizer = require("gpt-tokenizer");
const index_js = require("@modelcontextprotocol/sdk/client/index.js");
const sse_js = require("@modelcontextprotocol/sdk/client/sse.js");
const stdio_js = require("@modelcontextprotocol/sdk/client/stdio.js");
const streamableHttp_js = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
const skipNames = /* @__PURE__ */ new Set(["node_modules", ".git", "out", "dist"]);
function ensureRoot$5(root) {
  if (!root.trim()) throw new Error("Project root is not configured.");
  return path.resolve(root);
}
function backupRoot(root, settings) {
  return path.resolve(settings.backup.backupDir.trim() || path.join(root, ".wangyang", "backups"));
}
function backupId() {
  return (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}
async function copyProjectTree(sourceRoot, current, targetRoot, backupsRoot, stats) {
  const entries = await promises.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (skipNames.has(entry.name)) continue;
    const source = path.join(current, entry.name);
    if (source === backupsRoot || source.startsWith(`${backupsRoot}${path.sep}`)) continue;
    const relative = path.relative(sourceRoot, source);
    const target = path.join(targetRoot, relative);
    if (entry.isDirectory()) {
      await promises.mkdir(target, { recursive: true });
      await copyProjectTree(sourceRoot, source, targetRoot, backupsRoot, stats);
      continue;
    }
    if (!entry.isFile()) continue;
    const meta = await promises.stat(source);
    await promises.mkdir(path.dirname(target), { recursive: true });
    await promises.copyFile(source, target);
    stats.files += 1;
    stats.bytes += meta.size;
  }
}
async function createProjectBackup(root, settings) {
  const resolvedRoot = ensureRoot$5(root);
  const backupsRoot = backupRoot(resolvedRoot, settings);
  const id = backupId();
  const targetRoot = path.join(backupsRoot, id);
  const stats = { files: 0, bytes: 0 };
  await promises.mkdir(targetRoot, { recursive: true });
  await copyProjectTree(resolvedRoot, resolvedRoot, targetRoot, backupsRoot, stats);
  const info = {
    id,
    path: targetRoot,
    createdAt: Date.now(),
    files: stats.files,
    bytes: stats.bytes
  };
  await promises.writeFile(path.join(targetRoot, "backup.json"), JSON.stringify(info, null, 2), "utf8");
  await pruneProjectBackups(resolvedRoot, settings);
  return info;
}
async function listProjectBackups(root, settings) {
  const backupsRoot = backupRoot(ensureRoot$5(root), settings);
  let entries;
  try {
    entries = await promises.readdir(backupsRoot);
  } catch {
    return [];
  }
  const backups = [];
  for (const entry of entries) {
    try {
      const raw = await promises.readFile(path.join(backupsRoot, entry, "backup.json"), "utf8");
      backups.push(JSON.parse(raw));
    } catch {
    }
  }
  return backups.sort((a, b) => b.createdAt - a.createdAt);
}
async function pruneProjectBackups(root, settings) {
  const resolvedRoot = ensureRoot$5(root);
  const backupsRoot = backupRoot(resolvedRoot, settings);
  const keepVersions = Math.max(1, Math.floor(settings.backup.keepVersions || 1));
  const backups = await listProjectBackups(resolvedRoot, settings);
  const staleBackups = backups.slice(keepVersions);
  for (const backup of staleBackups) {
    const backupPath = path.resolve(backup.path);
    if (backupPath === backupsRoot || !backupPath.startsWith(`${backupsRoot}${path.sep}`)) continue;
    await promises.rm(backupPath, { recursive: true, force: true });
  }
}
const BUILTIN_INTERFACE = {
  id: "wangyang",
  label: "王阳云",
  apiUrl: "https://llm.wangyang.local",
  apiKey: "",
  isBuiltIn: true,
  requestFormat: "openai",
  defaultModel: "deepseek"
};
const providerPresets = [
  BUILTIN_INTERFACE,
  {
    id: "openai",
    label: "OpenAI",
    apiUrl: "https://api.openai.com/v1",
    apiKey: "",
    requestFormat: "openai",
    defaultModel: "gpt-4o-mini"
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    apiUrl: "https://api.deepseek.com/v1",
    apiKey: "",
    requestFormat: "openai",
    defaultModel: "deepseek-chat"
  },
  {
    id: "dashscope",
    label: "DashScope",
    apiUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "",
    requestFormat: "openai",
    defaultModel: "qwen-plus-latest"
  },
  {
    id: "kimi",
    label: "Kimi",
    apiUrl: "https://api.kimi.com/v1",
    apiKey: "",
    requestFormat: "openai",
    defaultModel: "kimi-latest"
  },
  {
    id: "bigmodel",
    label: "BigModel",
    apiUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKey: "",
    requestFormat: "openai",
    defaultModel: "glm-4-flash"
  },
  {
    id: "volcengine",
    label: "Volcengine Ark",
    apiUrl: "https://ark.cn-beijing.volces.com/api/paas/v4",
    apiKey: "",
    requestFormat: "openai",
    defaultModel: ""
  },
  {
    id: "anthropic",
    label: "Anthropic",
    apiUrl: "https://api.anthropic.com/v1",
    apiKey: "",
    requestFormat: "claude",
    defaultModel: "claude-sonnet-4-5"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    apiUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    requestFormat: "openai",
    defaultModel: "openai/gpt-4o-mini"
  },
  {
    id: "aihubmix",
    label: "AiHubMix",
    apiUrl: "https://aihubmix.com/v1",
    apiKey: "",
    requestFormat: "openai",
    defaultModel: "gpt-4o-mini",
    defaultHeaders: {
      "APP-Code": "LHON5516"
    }
  }
];
const defaultAvailableModels = [
  "wangyang/auto",
  "wangyang/deepseek",
  "wangyang/qwen3.5-plus",
  "wangyang/kimi",
  "wangyang/GLM-latest",
  "wangyang/GLM-5",
  "wangyang/qwen3.5-flash",
  "wangyang/qwen-max-latest",
  "wangyang/qwen-plus-latest",
  "wangyang/qwen-flash-latest",
  "wangyang/GLM-Flash",
  "wangyang/deepseek-v3.2",
  "wangyang/wan-t2i",
  "wangyang/qwen-image-edit-plus",
  "openai/gpt-4o-mini",
  "deepseek/deepseek-chat"
];
const defaultScenarioConfig = {
  writing: "wangyang/deepseek",
  modification: "wangyang/deepseek",
  summary: "wangyang/qwen-flash-latest",
  smartContext: "wangyang/qwen-plus-latest",
  agent: "wangyang/deepseek",
  agentPlanner: "wangyang/deepseek",
  agentWriter: "wangyang/deepseek",
  agentPolisher: "wangyang/deepseek",
  agentReviewer: "wangyang/deepseek",
  image: "wangyang/wan-t2i",
  imageEdit: "wangyang/qwen-image-edit-plus"
};
const defaultModelMetadata = Object.fromEntries(
  defaultAvailableModels.map((modelId) => {
    const isImageModel = modelId.includes("wan-t2i") || modelId.includes("image");
    const isVisionCapable = isImageModel || modelId.includes("gpt-4o");
    const isDeprecated = modelId.includes("qwen3.5") || modelId.includes("GLM-latest");
    const contextWindow = modelId.includes("flash") ? 32e3 : modelId.includes("gpt-4o") ? 128e3 : modelId.includes("qwen-max") || modelId.includes("qwen-plus") ? 128e3 : 64e3;
    return [
      modelId,
      {
        id: modelId,
        label: modelId,
        maxContextWindow: contextWindow,
        supportImage: isVisionCapable,
        supportThinking: modelId.includes("deepseek") || modelId.includes("qwen") || modelId.includes("GLM"),
        priceTier: isImageModel ? "medium" : modelId.includes("flash") ? "low" : "unknown",
        deprecated: isDeprecated,
        defaultTemperature: isImageModel ? 0.8 : modelId.includes("writer") ? 0.7 : 0.2
      }
    ];
  })
);
const defaultAiConfig = {
  interfaces: Object.fromEntries(providerPresets.map((provider) => [provider.id, provider])),
  availableModels: defaultAvailableModels,
  modelMetadata: defaultModelMetadata,
  scenario: defaultScenarioConfig
};
const LEGACY_BRAND_PROVIDER_ID = "feelfish";
const BRAND_PROVIDER_ID = "wangyang";
const unsupportedDefaultModelReplacements = {
  "wangyang/deepseek-v4-flash": "wangyang/deepseek"
};
function modelProviderId(modelId) {
  return modelId.split("/").filter(Boolean)[0] ?? "";
}
function migrateLegacyBrandModelId(modelId) {
  const migrated = modelId.replace(/^feelfish(?=\/|$)/, BRAND_PROVIDER_ID);
  return unsupportedDefaultModelReplacements[migrated] ?? migrated;
}
function migrateLegacyBrandInterfaces(interfaces) {
  const next = { ...interfaces ?? {} };
  const legacy = next[LEGACY_BRAND_PROVIDER_ID];
  delete next[LEGACY_BRAND_PROVIDER_ID];
  const current = next[BRAND_PROVIDER_ID];
  if (legacy && (!current || !current.apiKey.trim() && legacy.apiKey.trim())) {
    next[BRAND_PROVIDER_ID] = {
      ...legacy,
      id: BRAND_PROVIDER_ID,
      label: "王阳云",
      apiUrl: current?.apiUrl || defaultAiConfig.interfaces[BRAND_PROVIDER_ID]?.apiUrl || "https://llm.wangyang.local"
    };
  }
  return next;
}
function normalizeProviderDefaultModels(interfaces) {
  return Object.fromEntries(
    Object.entries(interfaces).map(([id, provider]) => {
      const defaultModel = normalizedDefaultModel$1(provider);
      const replacement = unsupportedDefaultModelReplacements[`${id}/${defaultModel}`];
      if (!replacement) return [id, provider];
      const [, ...replacementParts] = replacement.split("/").filter(Boolean);
      return [
        id,
        {
          ...provider,
          defaultModel: replacementParts.join("/")
        }
      ];
    })
  );
}
function migrateLegacyBrandMetadata(metadata) {
  return Object.fromEntries(
    Object.entries(metadata ?? {}).map(([modelId, meta]) => {
      const nextModelId = migrateLegacyBrandModelId(modelId);
      return [
        nextModelId,
        {
          ...meta,
          id: migrateLegacyBrandModelId(meta.id),
          label: meta.label ? migrateLegacyBrandModelId(meta.label) : meta.label
        }
      ];
    })
  );
}
function migrateLegacyBrandScenario(scenario) {
  return Object.fromEntries(
    Object.entries(scenario ?? {}).map(([key, modelId]) => [
      key,
      typeof modelId === "string" ? migrateLegacyBrandModelId(modelId) : modelId
    ])
  );
}
function normalizedDefaultModel$1(provider) {
  return provider.defaultModel?.trim().replace(/^\/+/, "") ?? "";
}
function isTextRequestFormat(requestFormat) {
  return requestFormat === void 0 || requestFormat === "openai" || requestFormat === "responses" || requestFormat === "claude";
}
function isImageModelId(modelId) {
  return /(?:^|[/_-])(?:wan-t2i|t2i|image-edit|qwen-image|gpt-image|dall-e|imagen|flux|stable-diffusion)(?:$|[/_-])/i.test(
    modelId
  );
}
function mergeModelIds(models) {
  const seen = /* @__PURE__ */ new Set();
  return models.filter((model) => {
    if (!model || seen.has(model)) return false;
    seen.add(model);
    return true;
  });
}
function providerModelId(provider) {
  const modelName = normalizedDefaultModel$1(provider);
  return modelName ? `${provider.id}/${modelName}` : "";
}
function configuredProviderModelIds(config) {
  return Object.values(config.interfaces).filter((provider) => provider.apiKey.trim() && isTextRequestFormat(provider.requestFormat)).map(providerModelId).filter(Boolean);
}
function findProviderForBareModel(config, modelName) {
  const providers = Object.values(config.interfaces).filter((provider) => isTextRequestFormat(provider.requestFormat));
  const defaultMatches = providers.filter((provider) => normalizedDefaultModel$1(provider) === modelName);
  const keyedDefaultMatch = defaultMatches.find((provider) => provider.apiKey.trim());
  if (keyedDefaultMatch) return keyedDefaultMatch;
  if (defaultMatches.length) return defaultMatches[0];
  const keyedProviders = providers.filter((provider) => provider.apiKey.trim());
  return keyedProviders.length === 1 ? keyedProviders[0] : void 0;
}
function normalizeModelId(config, modelId) {
  const parts = migrateLegacyBrandModelId(modelId).split("/").filter(Boolean);
  if (!parts.length) return "";
  const provider = config.interfaces[parts[0]];
  if (provider) {
    const modelName = parts.length > 1 ? parts.slice(1).join("/") : normalizedDefaultModel$1(provider);
    return modelName ? `${provider.id}/${modelName}` : provider.id;
  }
  const bareProvider = findProviderForBareModel(config, parts[0]);
  return bareProvider ? `${bareProvider.id}/${parts[0]}` : modelId;
}
function isConfiguredRuntimeModel(config, modelId, options = {}) {
  const provider = config.interfaces[modelProviderId(modelId)];
  const requestFormat = provider?.requestFormat ?? "openai";
  if (options.image) {
    return Boolean(provider?.apiKey?.trim() && requestFormat === "openai");
  }
  return Boolean(provider?.apiKey?.trim() && isTextRequestFormat(requestFormat));
}
function pickRuntimeModel(config, preferred, options = {}) {
  const models = config.availableModels.length ? config.availableModels : defaultAiConfig.availableModels;
  const normalizedPreferred = preferred ? normalizeModelId(config, preferred) : "";
  const scopedModels = options.image ? models.filter((model) => isImageModelId(model)) : models.filter((model) => !isImageModelId(model));
  const candidates = scopedModels.length ? scopedModels : models;
  const preferredInScope = Boolean(normalizedPreferred && candidates.includes(normalizedPreferred));
  if (normalizedPreferred && preferredInScope && isConfiguredRuntimeModel(config, normalizedPreferred, options)) {
    return normalizedPreferred;
  }
  const configured = candidates.find((model) => isConfiguredRuntimeModel(config, model, options));
  if (configured) return configured;
  if (normalizedPreferred && preferredInScope) return normalizedPreferred;
  return candidates[0] ?? models[0] ?? defaultAiConfig.scenario.agent;
}
function normalizeScenarioModels(config, models) {
  const agentModel = pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agent);
  const writerModel = pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agentWriter || agentModel);
  const reviewerModel = pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agentReviewer || agentModel);
  const imageModel = pickRuntimeModel({ ...config, availableModels: models }, config.scenario.image, { image: true });
  return {
    writing: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.writing || writerModel),
    modification: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.modification || writerModel),
    summary: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.summary || agentModel),
    smartContext: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.smartContext || agentModel),
    agent: agentModel,
    agentPlanner: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agentPlanner || agentModel),
    agentWriter: writerModel,
    agentPolisher: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.agentPolisher || writerModel),
    agentReviewer: reviewerModel,
    image: imageModel,
    imageEdit: pickRuntimeModel({ ...config, availableModels: models }, config.scenario.imageEdit || imageModel, { image: true })
  };
}
function metadataForModel(config, modelId) {
  return config.modelMetadata[modelId] ?? defaultAiConfig.modelMetadata[modelId] ?? {
    id: modelId,
    label: modelId,
    maxContextWindow: 64e3,
    supportImage: isImageModelId(modelId),
    supportThinking: /deepseek|qwen|glm/i.test(modelId),
    priceTier: "unknown",
    defaultTemperature: isImageModelId(modelId) ? 0.8 : 0.2
  };
}
function normalizeAiConfigForLocalRuntime(input) {
  const migratedInput = {
    ...input,
    interfaces: migrateLegacyBrandInterfaces(input.interfaces),
    availableModels: (input.availableModels ?? []).map(migrateLegacyBrandModelId),
    modelMetadata: migrateLegacyBrandMetadata(input.modelMetadata),
    scenario: migrateLegacyBrandScenario(input.scenario)
  };
  const merged = {
    ...defaultAiConfig,
    ...migratedInput,
    interfaces: {
      ...defaultAiConfig.interfaces,
      ...migratedInput.interfaces ?? {}
    },
    modelMetadata: {
      ...defaultAiConfig.modelMetadata,
      ...migratedInput.modelMetadata ?? {}
    },
    scenario: {
      ...defaultAiConfig.scenario,
      ...migratedInput.scenario ?? {}
    }
  };
  merged.interfaces = normalizeProviderDefaultModels(merged.interfaces);
  delete merged.interfaces[LEGACY_BRAND_PROVIDER_ID];
  const normalizedListedModels = (merged.availableModels.length ? merged.availableModels : defaultAiConfig.availableModels).map((model) => normalizeModelId(merged, model)).filter(Boolean);
  const availableModels = mergeModelIds([...normalizedListedModels, ...configuredProviderModelIds(merged)]);
  const finalModels = availableModels.length ? availableModels : defaultAiConfig.availableModels;
  const withModels = {
    ...merged,
    availableModels: finalModels,
    modelMetadata: Object.fromEntries(finalModels.map((model) => [model, metadataForModel(merged, model)]))
  };
  return {
    ...withModels,
    scenario: normalizeScenarioModels(withModels, finalModels)
  };
}
const projectDirectories = [
  "rules",
  "outline",
  "chapters",
  "roles",
  "objects",
  "records",
  "inspirations",
  "assets",
  "others",
  ".wangyang",
  ".wangyang/skills",
  ".wangyang/agents",
  ".wangyang/archive",
  ".wangyang/backups",
  ".wangyang/exports"
];
function now() {
  return Date.now();
}
function slugProjectName(name) {
  const cleaned = name.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").slice(0, 80);
  return cleaned || `王阳项目 ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}`;
}
function projectId(root) {
  return Buffer.from(path.resolve(root).toLowerCase()).toString("base64url").slice(0, 48);
}
function normalizeTemplateType(value) {
  return value === "analysis" ? "analysis" : "basic";
}
function assertInsideParent(parentPath, projectName) {
  if (!parentPath.trim()) throw new Error("请选择项目父目录。");
  const parent = path.resolve(parentPath);
  const target = path.resolve(parent, slugProjectName(projectName));
  const parentWithSep = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  if (target !== parent && !target.startsWith(parentWithSep)) {
    throw new Error("项目目录必须位于选择的父目录内。");
  }
  return target;
}
async function pathExists(target) {
  try {
    await promises.stat(target);
    return true;
  } catch {
    return false;
  }
}
async function isEmptyDirectory(target) {
  try {
    const entries = await promises.readdir(target);
    return entries.length === 0;
  } catch {
    return true;
  }
}
function createWangyangConfig(projectType) {
  const base = {
    projectType,
    chapters: [],
    rules: [],
    outline: [],
    roles: [],
    objects: [],
    records: [],
    inspirations: [],
    assets: [],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (projectType === "analysis") {
    base.records = [
      {
        relativePath: "records/智能上下文-综合提炼小说信息.md",
        isSmartContext: true,
        smartContextPrompt: "请综合提炼当前小说信息，包括核心风格、人物关系、世界观设定、主线剧情、伏笔、章节进展和后续创作注意事项。"
      }
    ];
  }
  return base;
}
function smartContextTemplate() {
  return [
    "# 智能上下文-综合提炼小说信息",
    "",
    "## 核心风格与基调",
    "",
    "## 人物信息",
    "",
    "## 世界观与设定",
    "",
    "## 当前故事脉络",
    "",
    "## 伏笔与待跟进事项",
    ""
  ].join("\n");
}
function normalizeProjectInfo(project) {
  const root = path.resolve(project.root);
  const createdAt = typeof project.createdAt === "number" ? project.createdAt : now();
  return {
    id: project.id || projectId(root),
    name: project.name?.trim() || path.basename(root) || "未命名项目",
    root,
    projectType: normalizeTemplateType(project.projectType),
    language: project.language || "zh",
    createdAt,
    updatedAt: typeof project.updatedAt === "number" ? project.updatedAt : createdAt,
    lastOpenedAt: typeof project.lastOpenedAt === "number" ? project.lastOpenedAt : void 0
  };
}
function upsertProject(projects, project) {
  const normalized = normalizeProjectInfo(project);
  const withoutSame = projects.filter(
    (item) => item.id !== normalized.id && path.resolve(item.root).toLowerCase() !== normalized.root.toLowerCase()
  );
  return [normalized, ...withoutSame].sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0));
}
async function createProjectFromTemplate(input) {
  const projectType = normalizeTemplateType(input.projectType);
  const root = assertInsideParent(input.parentPath, input.name);
  if (await pathExists(root) && !await isEmptyDirectory(root)) {
    throw new Error(`项目目录已存在且不为空：${root}`);
  }
  await promises.mkdir(root, { recursive: true });
  await Promise.all(projectDirectories.map((dir) => promises.mkdir(path.join(root, dir), { recursive: true })));
  await promises.writeFile(path.join(root, "wangyang.json"), `${JSON.stringify(createWangyangConfig(projectType), null, 2)}
`, "utf8");
  await promises.writeFile(
    path.join(root, ".wangyang", "solution.json"),
    `${JSON.stringify({ version: 1, active: "professional", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2)}
`,
    "utf8"
  );
  if (projectType === "analysis") {
    await promises.writeFile(path.join(root, "records", "智能上下文-综合提炼小说信息.md"), smartContextTemplate(), "utf8");
  }
  const timestamp = now();
  return {
    id: projectId(root),
    name: slugProjectName(input.name),
    root,
    projectType,
    language: input.language || "zh",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp
  };
}
async function inferProjectFromRoot(root) {
  const resolved = path.resolve(root);
  let projectType = "basic";
  try {
    const raw = await promises.readFile(path.join(resolved, "wangyang.json"), "utf8");
    const parsed = JSON.parse(raw);
    projectType = normalizeTemplateType(parsed.projectType);
  } catch {
  }
  const meta = await promises.stat(resolved);
  return {
    id: projectId(resolved),
    name: path.basename(resolved) || "未命名项目",
    root: resolved,
    projectType,
    language: "zh",
    createdAt: meta.birthtimeMs || now(),
    updatedAt: meta.mtimeMs || now(),
    lastOpenedAt: now()
  };
}
async function deleteProjectFiles(root) {
  const resolved = path.resolve(root);
  if (!resolved || resolved === path.parse(resolved).root) {
    throw new Error("拒绝删除磁盘根目录。");
  }
  const rootMeta = await promises.lstat(resolved);
  if (!rootMeta.isDirectory() || rootMeta.isSymbolicLink()) {
    throw new Error("拒绝删除非真实项目目录。");
  }
  const realRoot = await promises.realpath(resolved);
  if (path.resolve(realRoot) !== resolved) {
    throw new Error("拒绝删除符号链接或目录联接指向的项目。");
  }
  const projectConfigPath = path.join(resolved, "wangyang.json");
  const solutionConfigPath = path.join(resolved, ".wangyang", "solution.json");
  const [projectConfigMeta, solutionConfigMeta] = await Promise.all([promises.lstat(projectConfigPath), promises.lstat(solutionConfigPath)]);
  if (!projectConfigMeta.isFile() || projectConfigMeta.isSymbolicLink() || !solutionConfigMeta.isFile() || solutionConfigMeta.isSymbolicLink()) {
    throw new Error("仅允许删除由本地模板创建并带有 wangyang.json 与 .wangyang/solution.json 的项目目录。");
  }
  await promises.rm(resolved, { recursive: true, force: true });
}
const defaultLocalSettings = {
  promptContext: {
    autoCarryProjectRules: true,
    autoCarrySmartContext: true,
    smartContextAutoUpdate: true,
    agentMemoryAutoUpdate: true,
    agentToolPermissionMode: "request",
    responseStylePreset: "wangyang-roast",
    autoSummaryThresholdPercent: 70,
    maxContextWindowLimit: 64e3,
    defaultAssistedPrompt: "请根据当前上下文辅助我继续创作，并给出可直接采用的修改建议。",
    defaultSelectedPromptId: "",
    prompts: [
      {
        id: "chapter-review",
        title: "章节审查",
        body: "检查逻辑、节奏、人物动机、伏笔和爽点。",
        text: "请审查当前章节，重点检查逻辑漏洞、节奏拖沓、人物动机、伏笔回收和读者期待，并按严重程度列出修改建议。",
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      },
      {
        id: "three-act-plan",
        title: "三幕式规划",
        body: "把当前故事拆成阶段目标和章节推进。",
        text: "请把当前故事拆成三幕式结构，列出每一幕的目标、冲突升级、关键反转、人物变化和章节安排。",
        enabled: true,
        createdAt: 0,
        updatedAt: 0
      }
    ],
    maxContextFiles: 12
  },
  editor: {
    fontFamily: "AlibabaSans",
    fontSize: 16,
    lineHeight: 1.7,
    viewMode: "markdown",
    autosave: true,
    spellcheck: false
  },
  backup: {
    autoBackup: true,
    intervalMinutes: 10,
    keepVersions: 50,
    backupDir: ""
  },
  system: {
    language: "zh",
    theme: "dark",
    autoUpdate: false,
    diagnostics: true,
    appLock: false,
    appLockPin: "",
    appLockPinHash: ""
  }
};
const defaultStore = {
  projectRoot: "",
  projects: [],
  aiConfig: defaultAiConfig,
  mcpConfig: { mcpServers: {}, disabled: {}, commandEnv: {}, inputs: {} },
  localSettings: defaultLocalSettings
};
const localFreeEntitlements = {
  mode: "local-free",
  auth: {
    loggedIn: false
  },
  capabilities: {
    cloudLikeFeatures: true,
    agentTool: true,
    semanticSearch: true,
    knowledgeBase: true,
    imageGeneration: true,
    subAgents: true,
    mcp: true
  },
  isLoggedIn: false,
  isVip: false,
  isProVip: false,
  enableCloudLikeFeatures: true,
  enableAgentTool: true,
  enableSemanticSearch: true,
  enableKnowledgeBase: true,
  enableImageGeneration: true,
  enableSubAgents: true,
  enableMcp: true
};
class JsonStore {
  filePath() {
    return path.join(electron.app.getPath("userData"), "wangyang-store.json");
  }
  legacyFilePaths() {
    const legacyFileName = `${"feel"}${"fishx"}-store.json`;
    const legacyAppName = `${"feel"}${"fishx"}-rebuild`;
    return [
      path.join(electron.app.getPath("userData"), legacyFileName),
      path.join(electron.app.getPath("appData"), legacyAppName, legacyFileName)
    ];
  }
  parseStoreRaw(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return void 0;
    }
  }
  hasConfiguredProvider(parsed) {
    return Object.values(parsed?.aiConfig?.interfaces ?? {}).some((provider) => provider.apiKey.trim());
  }
  async readStoreCandidateAt(sourcePath, isLegacy) {
    try {
      const parsed = this.parseStoreRaw(await promises.readFile(sourcePath, "utf8"));
      return parsed ? { parsed, sourcePath, isLegacy } : void 0;
    } catch {
      return void 0;
    }
  }
  async readStoreCandidate() {
    const current = await this.readStoreCandidateAt(this.filePath(), false);
    const legacyCandidates = [];
    for (const legacyPath of this.legacyFilePaths()) {
      try {
        const candidate = await this.readStoreCandidateAt(legacyPath, true);
        if (candidate) legacyCandidates.push(candidate);
      } catch {
      }
    }
    const configuredLegacy = legacyCandidates.find((candidate) => this.hasConfiguredProvider(candidate.parsed));
    if (current && (this.hasConfiguredProvider(current.parsed) || !configuredLegacy)) return current;
    return configuredLegacy ?? current ?? legacyCandidates[0];
  }
  normalizeParsedStore(parsed) {
    const aiConfig = normalizeAiConfigForLocalRuntime({
      ...defaultAiConfig,
      ...parsed.aiConfig,
      interfaces: {
        ...defaultAiConfig.interfaces,
        ...parsed.aiConfig?.interfaces ?? {}
      },
      modelMetadata: {
        ...defaultAiConfig.modelMetadata,
        ...parsed.aiConfig?.modelMetadata ?? {}
      },
      scenario: {
        ...defaultAiConfig.scenario,
        ...parsed.aiConfig?.scenario ?? {}
      }
    });
    const projects = Array.isArray(parsed.projects) ? parsed.projects.filter((project) => Boolean(project && typeof project.root === "string")).map((project) => normalizeProjectInfo(project)) : [];
    return {
      ...defaultStore,
      ...parsed,
      projects,
      aiConfig,
      mcpConfig: {
        mcpServers: parsed.mcpConfig?.mcpServers ?? {},
        disabled: parsed.mcpConfig?.disabled ?? {},
        commandEnv: parsed.mcpConfig?.commandEnv ?? {},
        inputs: parsed.mcpConfig?.inputs ?? {}
      },
      localSettings: {
        promptContext: {
          ...defaultLocalSettings.promptContext,
          ...parsed.localSettings?.promptContext ?? {}
        },
        editor: {
          ...defaultLocalSettings.editor,
          ...parsed.localSettings?.editor ?? {}
        },
        backup: {
          ...defaultLocalSettings.backup,
          ...parsed.localSettings?.backup ?? {}
        },
        system: {
          ...defaultLocalSettings.system,
          ...parsed.localSettings?.system ?? {}
        }
      }
    };
  }
  async read() {
    const candidate = await this.readStoreCandidate();
    const normalized = this.normalizeParsedStore(candidate?.parsed ?? defaultStore);
    const normalizedRaw = JSON.stringify(normalized, null, 2);
    const candidateRaw = JSON.stringify(candidate?.parsed ?? {}, null, 2);
    if (!candidate || candidate.isLegacy || candidate.sourcePath !== this.filePath() || candidateRaw !== normalizedRaw) {
      await this.write(normalized);
    }
    return normalized;
  }
  async write(next) {
    await promises.mkdir(path.dirname(this.filePath()), { recursive: true });
    await promises.writeFile(this.filePath(), JSON.stringify(next, null, 2), "utf8");
  }
  async snapshot() {
    const current = await this.read();
    return {
      projectRoot: current.projectRoot,
      aiConfig: current.aiConfig,
      mcpConfig: current.mcpConfig,
      localSettings: current.localSettings,
      entitlements: localFreeEntitlements
    };
  }
  async setProjectRoot(projectRoot) {
    const current = await this.read();
    const trimmedRoot = projectRoot.trim();
    if (!trimmedRoot) {
      await this.write({ ...current, projectRoot: "" });
      return;
    }
    let projects = current.projects;
    try {
      const project = await inferProjectFromRoot(trimmedRoot);
      projects = upsertProject(projects, project);
    } catch {
    }
    await this.write({ ...current, projectRoot: trimmedRoot, projects });
  }
  async getProjects() {
    const current = await this.read();
    return current.projects;
  }
  async createProject(input) {
    const current = await this.read();
    const project = await createProjectFromTemplate(input);
    const projects = upsertProject(current.projects, project);
    await this.write({ ...current, projectRoot: project.root, projects });
    return project;
  }
  async openProject(id) {
    const current = await this.read();
    const project = current.projects.find((item) => item.id === id);
    if (!project) throw new Error("项目不存在或已从列表移除。");
    const opened = { ...project, lastOpenedAt: Date.now(), updatedAt: Date.now() };
    await this.write({ ...current, projectRoot: opened.root, projects: upsertProject(current.projects, opened) });
  }
  async renameProject(id, name) {
    const current = await this.read();
    const trimmed = name.trim();
    if (!trimmed) throw new Error("项目名称不能为空。");
    const project = current.projects.find((item) => item.id === id);
    if (!project) throw new Error("项目不存在或已从列表移除。");
    const renamed = { ...project, name: trimmed, updatedAt: Date.now() };
    await this.write({ ...current, projects: upsertProject(current.projects, renamed) });
    return renamed;
  }
  async deleteProject(id, deleteFiles = false) {
    const current = await this.read();
    const project = current.projects.find((item) => item.id === id);
    if (!project) throw new Error("项目不存在或已从列表移除。");
    if (deleteFiles) await deleteProjectFiles(project.root);
    const projects = current.projects.filter((item) => item.id !== id);
    const nextRoot = current.projectRoot && path.resolve(current.projectRoot) === path.resolve(project.root) ? "" : current.projectRoot;
    await this.write({ ...current, projectRoot: nextRoot, projects });
    return { deleted: id, root: project.root, filesDeleted: deleteFiles };
  }
  async setAiConfig(aiConfig) {
    const current = await this.read();
    const normalized = normalizeAiConfigForLocalRuntime(aiConfig);
    await this.write({ ...current, aiConfig: normalized });
    return normalized;
  }
  async setMcpConfig(mcpConfig) {
    const current = await this.read();
    await this.write({ ...current, mcpConfig });
  }
  async setLocalSettings(localSettings) {
    const current = await this.read();
    await this.write({ ...current, localSettings });
  }
}
const jsonStore = new JsonStore();
let backupTimer;
let backupRunning = false;
let schedulerGeneration = 0;
function clearBackupTimer() {
  if (!backupTimer) return;
  clearInterval(backupTimer);
  backupTimer = void 0;
}
async function runScheduledBackupOnce() {
  if (backupRunning) return;
  backupRunning = true;
  try {
    const snapshot = await jsonStore.snapshot();
    if (!snapshot.projectRoot || !snapshot.localSettings.backup.autoBackup) return;
    await createProjectBackup(snapshot.projectRoot, snapshot.localSettings);
  } catch (error) {
    console.warn("[backup] scheduled backup failed:", error);
  } finally {
    backupRunning = false;
  }
}
async function refreshBackupScheduler() {
  const generation = ++schedulerGeneration;
  clearBackupTimer();
  const snapshot = await jsonStore.snapshot();
  if (generation !== schedulerGeneration) return;
  if (!snapshot.projectRoot || !snapshot.localSettings.backup.autoBackup) return;
  const intervalMinutes = Math.max(1, Math.floor(snapshot.localSettings.backup.intervalMinutes || 1));
  const nextTimer = setInterval(() => {
    void runScheduledBackupOnce();
  }, intervalMinutes * 60 * 1e3);
  nextTimer.unref?.();
  if (generation !== schedulerGeneration) {
    clearInterval(nextTimer);
    return;
  }
  backupTimer = nextTimer;
}
function stopBackupScheduler() {
  schedulerGeneration += 1;
  clearBackupTimer();
}
function runCommand(command, cwd, extraEnv = {}) {
  return new Promise((resolve) => {
    node_child_process.exec(
      command.trim(),
      {
        cwd: cwd || void 0,
        timeout: 6e4,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          ...extraEnv
        }
      },
      (error, stdout, stderr) => {
        const code = typeof error?.errno === "number" ? null : 0;
        resolve({
          stdout,
          stderr,
          code: error && "code" in error ? Number(error.code) : code,
          error: error?.message
        });
      }
    );
  });
}
const groupDirs = [
  { key: "rules", dir: "rules" },
  { key: "outline", dir: "outline" },
  { key: "chapters", dir: "chapters" },
  { key: "roles", dir: "roles" },
  { key: "objects", dir: "objects" },
  { key: "records", dir: "records" },
  { key: "inspirations", dir: "inspirations" },
  { key: "assets", dir: "assets" },
  { key: "others", dir: "others" }
];
function configPath(root) {
  if (!root.trim()) throw new Error("Project root is not configured.");
  return path.join(root, "wangyang.json");
}
function normalizeRelativePath(relativePath) {
  return relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+/g, "/");
}
function isSafeConfigPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const segments = normalized.split("/").filter(Boolean);
  return Boolean(normalized) && !path.isAbsolute(relativePath) && !path.isAbsolute(normalized) && segments.length > 0 && segments.every((segment) => segment !== "." && segment !== "..") && normalized !== "wangyang.json" && !normalized.startsWith(".wangyang/");
}
function groupForPath(relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  if (!isSafeConfigPath(normalized)) return void 0;
  return groupDirs.find((entry) => normalized === entry.dir || normalized.startsWith(`${entry.dir}/`))?.key;
}
function defaultProjectConfig() {
  return {
    projectType: "basic",
    chapters: [],
    rules: [],
    outline: [],
    roles: [],
    objects: [],
    records: [],
    inspirations: [],
    assets: [],
    others: []
  };
}
function sanitizeProjectConfig(input) {
  const config = {
    ...defaultProjectConfig(),
    ...input && typeof input === "object" ? input : {}
  };
  for (const { key } of groupDirs) {
    const current = config[key];
    const seen = /* @__PURE__ */ new Set();
    config[key] = Array.isArray(current) ? current.filter((item) => Boolean(item && typeof item.relativePath === "string")).map((item) => ({ ...item, relativePath: normalizeRelativePath(item.relativePath) })).filter((item) => {
      if (!item.relativePath || groupForPath(item.relativePath) !== key || seen.has(item.relativePath)) return false;
      seen.add(item.relativePath);
      return true;
    }) : [];
  }
  return config;
}
async function readProjectConfig(root) {
  const target = configPath(root);
  try {
    const raw = await promises.readFile(target, "utf8");
    const parsed = JSON.parse(raw);
    return sanitizeProjectConfig(parsed);
  } catch {
    return defaultProjectConfig();
  }
}
async function writeProjectConfig(root, config) {
  const target = configPath(root);
  const next = {
    ...sanitizeProjectConfig(config),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await promises.writeFile(target, `${JSON.stringify(next, null, 2)}
`, "utf8");
  return next;
}
function listFor(config, group) {
  const current = config[group];
  return Array.isArray(current) ? current.filter((item) => item && typeof item.relativePath === "string") : [];
}
async function addProjectConfigEntry(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const group = groupForPath(normalized);
  if (!group) return;
  const config = await readProjectConfig(root);
  const list = listFor(config, group);
  if (list.some((item) => item.relativePath === normalized)) return;
  config[group] = [...list, { relativePath: normalized }];
  await writeProjectConfig(root, config);
}
async function removeProjectConfigEntry(root, relativePath) {
  const normalized = normalizeRelativePath(relativePath);
  const config = await readProjectConfig(root);
  let changed = false;
  for (const { key } of groupDirs) {
    const list = listFor(config, key);
    const next = list.filter(
      (item) => item.relativePath !== normalized && !item.relativePath.startsWith(`${normalized}/`)
    );
    if (next.length !== list.length) {
      config[key] = next;
      changed = true;
    }
  }
  if (changed) await writeProjectConfig(root, config);
}
async function moveProjectConfigEntry(root, sourcePath, targetPath) {
  const source = normalizeRelativePath(sourcePath);
  const target = normalizeRelativePath(targetPath);
  const sourceGroup = groupForPath(source);
  const targetGroup = groupForPath(target);
  if (!sourceGroup && !targetGroup) return;
  const config = await readProjectConfig(root);
  let movedRecords = [];
  if (sourceGroup) {
    const list = listFor(config, sourceGroup);
    const remaining = [];
    for (const item of list) {
      if (item.relativePath === source || item.relativePath.startsWith(`${source}/`)) {
        movedRecords.push({
          ...item,
          relativePath: item.relativePath === source ? target : `${target}/${item.relativePath.slice(source.length + 1)}`
        });
      } else {
        remaining.push(item);
      }
    }
    config[sourceGroup] = remaining;
  }
  if (!movedRecords.length && targetGroup) {
    movedRecords = [{ relativePath: target }];
  }
  if (targetGroup && movedRecords.length) {
    const existing = listFor(config, targetGroup);
    const existingPaths = new Set(existing.map((item) => item.relativePath));
    config[targetGroup] = [
      ...existing,
      ...movedRecords.filter((item) => {
        if (existingPaths.has(item.relativePath)) return false;
        existingPaths.add(item.relativePath);
        return true;
      })
    ];
  }
  await writeProjectConfig(root, config);
}
function ensureRoot$4(root) {
  if (!root.trim()) {
    throw new Error("Project root is not configured.");
  }
  return path.resolve(root);
}
function resolveInsideRoot$1(root, relativePath = "") {
  const resolvedRoot = ensureRoot$4(root);
  const target = path.resolve(resolvedRoot, relativePath);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return target;
}
function assertEntryPath(relativePath, operation) {
  const raw = relativePath.trim();
  const normalized = relativePath.trim().replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (path.isAbsolute(raw) || path.isAbsolute(normalized)) {
    throw new Error(`${operation} path must be relative to the project root.`);
  }
  if (!normalized || normalized === "." || normalized === "/" || segments.length === 0) {
    throw new Error(`${operation} path must not be the project root.`);
  }
  if (segments.some((segment) => segment.includes(".."))) {
    throw new Error(`${operation} path must not contain parent directory segments.`);
  }
  return normalized;
}
function resolveMutableEntry(root, relativePath, operation) {
  const safeRelativePath = assertEntryPath(relativePath, operation);
  const target = resolveInsideRoot$1(root, safeRelativePath);
  if (target === ensureRoot$4(root)) {
    throw new Error(`${operation} path must not target the project root.`);
  }
  return { relativePath: safeRelativePath, target };
}
function assertEntryName(name) {
  const normalized = name.trim();
  if (!normalized || normalized === "." || normalized.includes("..") || normalized.includes("/") || normalized.includes("\\")) {
    throw new Error("New name must not be empty, parent traversal, or contain path separators.");
  }
  return normalized;
}
function toRelative$2(root, fullPath) {
  return path.relative(root, fullPath).replace(/\\/g, "/");
}
async function listDirectory(root, relativePath = "") {
  const absolute = resolveInsideRoot$1(root, relativePath);
  const entries = await promises.readdir(absolute, { withFileTypes: true });
  const resolvedRoot = ensureRoot$4(root);
  const listed = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(absolute, entry.name);
      const meta = await promises.stat(fullPath);
      return {
        name: entry.name,
        relativePath: toRelative$2(resolvedRoot, fullPath),
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isFile() ? meta.size : void 0,
        updatedAt: meta.mtimeMs
      };
    })
  );
  return {
    root: resolvedRoot,
    relativePath,
    entries: listed.sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
  };
}
async function readProjectFile(root, relativePath) {
  return promises.readFile(resolveInsideRoot$1(root, relativePath), "utf8");
}
async function writeProjectFile(root, relativePath, content) {
  const target = resolveInsideRoot$1(root, relativePath);
  await promises.mkdir(path.dirname(target), { recursive: true });
  await promises.writeFile(target, content, "utf8");
  return { relativePath, bytes: Buffer.byteLength(content, "utf8") };
}
async function createProjectEntry(root, relativePath, type, content = "") {
  const { target } = resolveMutableEntry(root, relativePath, "Create");
  const resolvedRoot = ensureRoot$4(root);
  if (type === "directory") {
    await promises.mkdir(target, { recursive: true });
  } else {
    await promises.mkdir(path.dirname(target), { recursive: true });
    await promises.writeFile(target, content, { encoding: "utf8", flag: "wx" });
  }
  const meta = await promises.stat(target);
  const entry = {
    name: path.basename(target),
    relativePath: toRelative$2(resolvedRoot, target),
    type,
    size: type === "file" ? meta.size : void 0,
    updatedAt: meta.mtimeMs
  };
  await addProjectConfigEntry(resolvedRoot, entry.relativePath);
  return entry;
}
async function renameProjectEntry(root, relativePath, nextName) {
  const { relativePath: safeRelativePath, target: source } = resolveMutableEntry(root, relativePath, "Rename");
  const safeName2 = assertEntryName(nextName);
  const target = resolveInsideRoot$1(root, path.join(path.dirname(safeRelativePath), safeName2));
  if (target === ensureRoot$4(root)) {
    throw new Error("Rename target must not be the project root.");
  }
  await promises.rename(source, target);
  const resolvedRoot = ensureRoot$4(root);
  const nextRelativePath = toRelative$2(resolvedRoot, target);
  await moveProjectConfigEntry(resolvedRoot, safeRelativePath, nextRelativePath);
  const meta = await promises.stat(target);
  const isDirectory = meta.isDirectory();
  return {
    name: path.basename(target),
    relativePath: nextRelativePath,
    type: isDirectory ? "directory" : "file",
    size: isDirectory ? void 0 : meta.size,
    updatedAt: meta.mtimeMs
  };
}
async function deleteProjectEntry(root, relativePath) {
  const { relativePath: safeRelativePath, target } = resolveMutableEntry(root, relativePath, "Delete");
  await promises.rm(target, { recursive: true, force: false });
  await removeProjectConfigEntry(ensureRoot$4(root), safeRelativePath);
  return { deleted: safeRelativePath };
}
async function moveProjectEntry(root, relativePath, targetRelativePath) {
  const { relativePath: sourceRelativePath, target: source } = resolveMutableEntry(root, relativePath, "Move");
  const { relativePath: nextRelativePath, target } = resolveMutableEntry(root, targetRelativePath, "Move target");
  await promises.mkdir(path.dirname(target), { recursive: true });
  await promises.rename(source, target);
  const resolvedRoot = ensureRoot$4(root);
  await moveProjectConfigEntry(resolvedRoot, sourceRelativePath, nextRelativePath);
  const meta = await promises.stat(target);
  const isDirectory = meta.isDirectory();
  return {
    name: path.basename(target),
    relativePath: toRelative$2(resolvedRoot, target),
    type: isDirectory ? "directory" : "file",
    size: isDirectory ? void 0 : meta.size,
    updatedAt: meta.mtimeMs
  };
}
async function walkFiles(root, dir, out, limit) {
  if (out.length >= limit) return;
  const entries = await promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= limit) break;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(root, fullPath, out, limit);
    } else if (entry.isFile()) {
      out.push(toRelative$2(root, fullPath));
    }
  }
}
async function walkProjectEntries(root, dir, query, out, limit) {
  if (out.length >= limit) return;
  const entries = await promises.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (out.length >= limit) break;
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);
    const meta = await promises.stat(fullPath);
    const isDirectory = entry.isDirectory();
    const relativePath = toRelative$2(root, fullPath);
    if (entry.name.toLowerCase().includes(query) || relativePath.toLowerCase().includes(query)) {
      out.push({
        name: entry.name,
        relativePath,
        type: isDirectory ? "directory" : "file",
        size: isDirectory ? void 0 : meta.size,
        updatedAt: meta.mtimeMs
      });
    }
    if (isDirectory) {
      await walkProjectEntries(root, fullPath, query, out, limit);
    }
  }
}
async function searchProjectFiles(root, query, limit = 200) {
  const resolvedRoot = ensureRoot$4(root);
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const matches = [];
  await walkProjectEntries(resolvedRoot, resolvedRoot, needle, matches, limit);
  return matches;
}
async function searchInFiles(root, query, limit = 200) {
  const resolvedRoot = ensureRoot$4(root);
  const files = [];
  await walkFiles(resolvedRoot, resolvedRoot, files, 2e3);
  const matches = [];
  const needle = query.toLowerCase();
  for (const file of files) {
    if (matches.length >= limit) break;
    try {
      const text = await readProjectFile(resolvedRoot, file);
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        if (matches.length >= limit) break;
        if (lines[i].toLowerCase().includes(needle)) {
          matches.push({ file, line: i + 1, preview: lines[i].trim().slice(0, 240) });
        }
      }
    } catch {
    }
  }
  return matches;
}
const skillsRoot = ".wangyang/skills";
const agentsRoot = ".wangyang/agents";
function ensureRoot$3(root) {
  if (!root.trim()) throw new Error("Project root is not configured.");
  return path.resolve(root);
}
function safeName$1(name, label) {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`${label} name must not be empty or contain path separators.`);
  }
  return trimmed.replace(/[<>:"|?*]/g, "-").slice(0, 80);
}
function resolveInside$1(root, relativePath) {
  const resolvedRoot = ensureRoot$3(root);
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (!normalized || path.isAbsolute(normalized) || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Path must be project-relative and stay inside the project root.");
  }
  const target = path.resolve(resolvedRoot, normalized);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return target;
}
function toRelative$1(root, fullPath) {
  return path.relative(root, fullPath).replace(/\\/g, "/");
}
async function listEntries(root, relativePath) {
  const resolvedRoot = ensureRoot$3(root);
  const absolute = resolveInside$1(resolvedRoot, relativePath);
  const entries = await promises.readdir(absolute, { withFileTypes: true });
  return Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(absolute, entry.name);
      const meta = await promises.stat(fullPath);
      return {
        name: entry.name,
        relativePath: toRelative$1(resolvedRoot, fullPath),
        type: entry.isDirectory() ? "directory" : "file",
        size: entry.isFile() ? meta.size : void 0,
        updatedAt: meta.mtimeMs
      };
    })
  ).then(
    (items) => items.sort((left, right) => {
      if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
      return left.name.localeCompare(right.name);
    })
  );
}
function parseSkillDescription(content) {
  const description = /^description:\s*(.+)$/im.exec(content)?.[1]?.trim();
  if (description) return description.replace(/^["']|["']$/g, "");
  const firstParagraph = content.replace(/^---[\s\S]*?---\s*/, "").split(/\n\s*\n/).map((part) => part.replace(/^#\s+.+\n?/, "").trim()).find(Boolean);
  return firstParagraph?.slice(0, 180);
}
function parseFrontmatter(content) {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  const lines = match[1].split(/\r?\n/);
  const parsed = {};
  let activeListKey = "";
  for (const line of lines) {
    const listItem = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (listItem && activeListKey) {
      const current = parsed[activeListKey];
      parsed[activeListKey] = [...Array.isArray(current) ? current : [], listItem[1].replace(/^["']|["']$/g, "")];
      continue;
    }
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (!key) continue;
    if (!value) {
      parsed[key] = [];
      activeListKey = key;
    } else {
      parsed[key] = value;
      activeListKey = "";
    }
  }
  return parsed;
}
function parseFrontmatterList(value) {
  if (Array.isArray(value)) return value.map((item) => item.trim()).filter(Boolean);
  if (!value?.trim()) return void 0;
  const raw = value.trim();
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw.replace(/'/g, '"'));
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
    }
  }
  return raw.replace(/^\[|\]$/g, "").split(",").map((item) => item.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}
function parseFrontmatterString(value) {
  return typeof value === "string" ? value : void 0;
}
function parseFrontmatterBoolean(value) {
  if (typeof value !== "string" || !value.trim()) return void 0;
  if (/^(true|yes|1)$/i.test(value.trim())) return true;
  if (/^(false|no|0)$/i.test(value.trim())) return false;
  return void 0;
}
function parseAgentMetadata(content, fallbackName) {
  const frontmatter = parseFrontmatter(content);
  return {
    name: parseFrontmatterString(frontmatter.name) || fallbackName,
    description: parseFrontmatterString(frontmatter.description),
    tools: parseFrontmatterList(frontmatter.tools),
    skills: parseFrontmatterList(frontmatter.skills),
    isBuiltIn: parseFrontmatterBoolean(frontmatter.isBuiltIn ?? frontmatter.builtIn)
  };
}
async function listSkills(root) {
  const resolvedRoot = ensureRoot$3(root);
  const base = resolveInside$1(resolvedRoot, skillsRoot);
  await promises.mkdir(base, { recursive: true });
  const entries = await promises.readdir(base, { withFileTypes: true });
  const skills = [];
  for (const entry of entries) {
    const fullPath = path.join(base, entry.name);
    const meta = await promises.stat(fullPath);
    const entryFile = entry.isDirectory() ? path.join(fullPath, "SKILL.md") : fullPath;
    if (!entry.isDirectory() && !entry.name.toLowerCase().endsWith(".md")) continue;
    try {
      const content = await promises.readFile(entryFile, "utf8");
      skills.push({
        name: entry.isDirectory() ? entry.name : entry.name.replace(/\.md$/i, ""),
        relativePath: toRelative$1(resolvedRoot, fullPath),
        entryPath: toRelative$1(resolvedRoot, entryFile),
        description: parseSkillDescription(content),
        updatedAt: meta.mtimeMs
      });
    } catch {
    }
  }
  return skills.sort((left, right) => left.name.localeCompare(right.name));
}
async function listSkillDirectory(root, skillName) {
  const name = safeName$1(skillName, "Skill");
  return listEntries(root, `${skillsRoot}/${name}`);
}
async function createSkill(root, name, content) {
  const resolvedRoot = ensureRoot$3(root);
  const skillName = safeName$1(name, "Skill");
  const parent = resolveInside$1(resolvedRoot, skillsRoot);
  const dir = resolveInside$1(resolvedRoot, `${skillsRoot}/${skillName}`);
  await promises.mkdir(parent, { recursive: true });
  try {
    await promises.mkdir(dir);
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Skill already exists: ${skillName}`);
    }
    throw error;
  }
  const entryFile = path.join(dir, "SKILL.md");
  const body = content ?? `---
name: ${skillName}
description: 本地项目技能。
---

# ${skillName}

## 使用场景

## 输入要求

## 执行步骤

## 输出格式
`;
  await promises.writeFile(entryFile, body, { encoding: "utf8", flag: "wx" });
  const meta = await promises.stat(entryFile);
  return {
    name: skillName,
    relativePath: toRelative$1(resolvedRoot, dir),
    entryPath: toRelative$1(resolvedRoot, entryFile),
    description: parseSkillDescription(body),
    updatedAt: meta.mtimeMs
  };
}
async function deleteSkill(root, name) {
  const skillName = safeName$1(name, "Skill");
  await promises.rm(resolveInside$1(root, `${skillsRoot}/${skillName}`), { recursive: true, force: false });
  return { deleted: skillName };
}
async function listAgents(root) {
  const resolvedRoot = ensureRoot$3(root);
  const base = resolveInside$1(resolvedRoot, agentsRoot);
  await promises.mkdir(base, { recursive: true });
  const entries = await promises.readdir(base, { withFileTypes: true });
  const agents = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
    const fullPath = path.join(base, entry.name);
    const meta = await promises.stat(fullPath);
    const content = await promises.readFile(fullPath, "utf8");
    const fallbackName = entry.name.replace(/\.md$/i, "");
    const metadata = parseAgentMetadata(content, fallbackName);
    agents.push({
      id: fallbackName,
      name: metadata.name || fallbackName,
      relativePath: toRelative$1(resolvedRoot, fullPath),
      description: metadata.description,
      tools: metadata.tools,
      skills: metadata.skills,
      isBuiltIn: metadata.isBuiltIn,
      updatedAt: meta.mtimeMs
    });
  }
  return agents.sort((left, right) => left.name.localeCompare(right.name));
}
function agentPath(root, agentId) {
  const name = safeName$1(agentId.replace(/\.md$/i, ""), "Agent");
  return resolveInside$1(root, `${agentsRoot}/${name}.md`);
}
async function readAgentContent(root, agentId) {
  return promises.readFile(agentPath(root, agentId), "utf8");
}
async function writeAgentContent(root, agentId, content) {
  const resolvedRoot = ensureRoot$3(root);
  const target = agentPath(resolvedRoot, agentId);
  await promises.mkdir(path.dirname(target), { recursive: true });
  await promises.writeFile(target, content, "utf8");
  const meta = await promises.stat(target);
  const metadata = parseAgentMetadata(content, path.basename(target, ".md"));
  return {
    id: path.basename(target, ".md"),
    name: metadata.name || path.basename(target, ".md"),
    relativePath: toRelative$1(resolvedRoot, target),
    description: metadata.description,
    tools: metadata.tools,
    skills: metadata.skills,
    isBuiltIn: metadata.isBuiltIn,
    updatedAt: meta.mtimeMs
  };
}
async function createAgent(root, agentId, content) {
  const resolvedRoot = ensureRoot$3(root);
  const name = safeName$1(agentId, "Agent");
  const target = agentPath(resolvedRoot, name);
  const body = content ?? `---
name: ${name}
description: 本地项目智能体。
tools: []
skills: []
isBuiltIn: false
---

# ${name}

## 角色定位

## 工作方式

## 输出要求
`;
  await promises.mkdir(path.dirname(target), { recursive: true });
  await promises.writeFile(target, body, { encoding: "utf8", flag: "wx" });
  const meta = await promises.stat(target);
  const metadata = parseAgentMetadata(body, path.basename(target, ".md"));
  return {
    id: path.basename(target, ".md"),
    name: metadata.name || path.basename(target, ".md"),
    relativePath: toRelative$1(resolvedRoot, target),
    description: metadata.description,
    tools: metadata.tools,
    skills: metadata.skills,
    isBuiltIn: metadata.isBuiltIn,
    updatedAt: meta.mtimeMs
  };
}
async function deleteAgent(root, agentId) {
  const name = safeName$1(agentId, "Agent");
  await promises.rm(agentPath(root, name), { force: false });
  return { deleted: name };
}
const sessionsRoot = ".wangyang/memory/sessions";
const roles = /* @__PURE__ */ new Set(["planner", "writer", "reviewer", "researcher"]);
const statuses = /* @__PURE__ */ new Set(["running", "done", "error"]);
function ensureRoot$2(root) {
  if (!root.trim()) throw new Error("Project root is not configured.");
  return path.resolve(root);
}
function resolveInside(root, relativePath) {
  const resolvedRoot = ensureRoot$2(root);
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const segments = normalized.split("/").filter(Boolean);
  if (!normalized || path.isAbsolute(normalized) || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("Path must be project-relative and stay inside the project root.");
  }
  const target = path.resolve(resolvedRoot, normalized);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return target;
}
function safeSessionId(id) {
  const safe = id.trim().replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 120);
  if (!safe || safe === "." || safe === "..") throw new Error("Sub-agent session id is invalid.");
  return safe;
}
function sessionJsonPath(root, sessionId) {
  return resolveInside(root, `${sessionsRoot}/${safeSessionId(sessionId)}.json`);
}
function sessionMarkdownPath(root, sessionId) {
  return resolveInside(root, `${sessionsRoot}/${safeSessionId(sessionId)}.md`);
}
function normalizeMessage(value) {
  const candidate = value;
  if (!candidate || typeof candidate.id !== "string" || !["system", "user", "assistant", "tool"].includes(String(candidate.role)) || typeof candidate.content !== "string" || typeof candidate.createdAt !== "number") {
    return void 0;
  }
  return candidate;
}
function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeMessage).filter((message) => Boolean(message));
}
function normalizeSession(value) {
  const candidate = value;
  if (!candidate || typeof candidate.id !== "string" || !roles.has(candidate.role) || typeof candidate.title !== "string" || typeof candidate.prompt !== "string" || !statuses.has(candidate.status) || typeof candidate.createdAt !== "number" || typeof candidate.updatedAt !== "number") {
    return void 0;
  }
  return {
    id: candidate.id,
    role: candidate.role,
    title: candidate.title,
    prompt: candidate.prompt,
    messages: normalizeMessages(candidate.messages),
    status: candidate.status,
    error: typeof candidate.error === "string" ? candidate.error : void 0,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt
  };
}
function normalizeLoadedSession(value) {
  const session = normalizeSession(value);
  if (!session) return { changed: false };
  if (session.status !== "running") return { session, changed: false };
  return {
    session: {
      ...session,
      status: "error",
      error: session.error ?? "Previous sub-agent run was interrupted before completion.",
      updatedAt: Date.now()
    },
    changed: true
  };
}
function dateLabel(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : "";
}
function renderSessionMarkdown(session) {
  const lines = [
    "# Sub-agent Session",
    "",
    `- ID: ${session.id}`,
    `- Role: ${session.role}`,
    `- Status: ${session.status}`,
    `- Created: ${dateLabel(session.createdAt)}`,
    `- Updated: ${dateLabel(session.updatedAt)}`,
    ...session.error ? [`- Error: ${session.error}`] : [],
    "",
    "## Prompt",
    "",
    session.prompt,
    "",
    "## Messages"
  ];
  for (const message of session.messages.filter((item) => item.role !== "system")) {
    lines.push("", `### ${message.role}`, "", message.content);
  }
  return `${lines.join("\n")}
`;
}
async function listSubAgentSessions(root) {
  const sessionDir = resolveInside(root, sessionsRoot);
  try {
    const entries = await promises.readdir(sessionDir, { withFileTypes: true });
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
      try {
        const raw = await promises.readFile(path.join(sessionDir, entry.name), "utf8");
        const { session, changed } = normalizeLoadedSession(JSON.parse(raw));
        if (!session) continue;
        sessions.push(session);
        if (changed) await writeSubAgentSession(root, session);
      } catch {
      }
    }
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 50);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function writeSubAgentSession(root, value) {
  const session = normalizeSession(value);
  if (!session) throw new Error("Sub-agent session is invalid.");
  const jsonPath = sessionJsonPath(root, session.id);
  const markdownPath = sessionMarkdownPath(root, session.id);
  await promises.mkdir(path.dirname(jsonPath), { recursive: true });
  await promises.writeFile(jsonPath, `${JSON.stringify(session, null, 2)}
`, "utf8");
  await promises.writeFile(markdownPath, renderSessionMarkdown(session), "utf8");
  return session;
}
async function deleteSubAgentSession(root, sessionId) {
  const safeId = safeSessionId(sessionId);
  await promises.rm(sessionJsonPath(root, safeId), { force: true });
  await promises.rm(sessionMarkdownPath(root, safeId), { force: true });
  return { deleted: safeId };
}
function normalizedDefaultModel(interfaceConfig) {
  return interfaceConfig.defaultModel?.trim().replace(/^\/+/, "") ?? "";
}
function supportsTextRequests(interfaceConfig) {
  const requestFormat = interfaceConfig.requestFormat ?? "openai";
  return requestFormat === "openai" || requestFormat === "responses" || requestFormat === "claude";
}
function resolveBareModel(config, modelName) {
  const interfaces = Object.values(config.interfaces).filter(supportsTextRequests);
  const defaultMatches = interfaces.filter((interfaceConfig) => normalizedDefaultModel(interfaceConfig) === modelName);
  const keyedDefaultMatch = defaultMatches.find((interfaceConfig) => interfaceConfig.apiKey.trim());
  if (keyedDefaultMatch) return keyedDefaultMatch;
  if (defaultMatches.length) return defaultMatches[0];
  const keyedInterfaces = interfaces.filter((interfaceConfig) => interfaceConfig.apiKey.trim());
  return keyedInterfaces.length === 1 ? keyedInterfaces[0] : void 0;
}
function resolveModel(config, modelId) {
  const parts = modelId.split("/").filter(Boolean);
  const [interfaceId] = parts;
  const interfaceConfig = config.interfaces[interfaceId];
  if (interfaceConfig) {
    const modelName = parts.length > 1 ? parts.slice(1).join("/") : normalizedDefaultModel(interfaceConfig);
    if (!modelName) {
      throw new Error(
        `Model interface "${interfaceConfig.id}" has no default model. Use a model id like "${interfaceConfig.id}/your-model-name".`
      );
    }
    return {
      modelId: parts.length > 1 ? modelId : `${interfaceConfig.id}/${modelName}`,
      modelName,
      interfaceId: interfaceConfig.id,
      interfaceConfig,
      requestFormat: interfaceConfig.requestFormat ?? "openai"
    };
  }
  const bareModelName = modelId.trim().replace(/^\/+/, "");
  const bareModelInterface = bareModelName ? resolveBareModel(config, bareModelName) : void 0;
  if (bareModelInterface) {
    return {
      modelId: `${bareModelInterface.id}/${bareModelName}`,
      modelName: bareModelName,
      interfaceId: bareModelInterface.id,
      interfaceConfig: bareModelInterface,
      requestFormat: bareModelInterface.requestFormat ?? "openai"
    };
  }
  throw new Error(`No model interface configured for "${interfaceId}". Use a model id like "openai/gpt-4o-mini".`);
}
function buildDefaultHeaders(model) {
  const headers = {
    ...model.interfaceConfig.defaultHeaders ?? {}
  };
  if (model.interfaceConfig.apiUrl.includes("dashscope.aliyuncs.com")) {
    headers["x-dashscope-session-cache"] = "enable";
  }
  if (model.interfaceId === "wangyang") {
    headers["X-DashScope-DataInspection"] = JSON.stringify({ input: "disable", output: "disable" });
  }
  return headers;
}
function toOpenAiContent(message) {
  const imageAttachments = message.attachments?.filter((attachment) => attachment.type === "image") ?? [];
  if (!imageAttachments.length) return message.content;
  return [
    { type: "text", text: message.content || "Please analyze these images." },
    ...imageAttachments.map((attachment) => ({
      type: "image_url",
      image_url: {
        url: attachment.dataUrl
      }
    }))
  ];
}
function toOpenAiMessages(messages) {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId ?? message.id,
        content: message.content
      };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: message.content || null,
        tool_calls: message.toolCalls.map((toolCall) => ({
          id: toolCall.id,
          type: "function",
          function: {
            name: toolCall.name,
            arguments: toolCall.argumentsText
          }
        }))
      };
    }
    return {
      role: message.role,
      content: toOpenAiContent(message)
    };
  });
}
function toOpenAiTools(tools = []) {
  if (!tools.length) return void 0;
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }
  }));
}
function toResponsesContent(message) {
  const imageAttachments = message.attachments?.filter((attachment) => attachment.type === "image") ?? [];
  if (!imageAttachments.length) return message.content;
  return [
    { type: "input_text", text: message.content || "Please analyze these images." },
    ...imageAttachments.map((attachment) => ({
      type: "input_image",
      image_url: attachment.dataUrl,
      detail: "auto"
    }))
  ];
}
function toResponsesInput(messages) {
  const input = [];
  for (const message of messages) {
    if (message.role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId ?? message.id,
        output: message.content
      });
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      if (message.content.trim()) {
        input.push({
          type: "message",
          role: "assistant",
          content: message.content
        });
      }
      for (const toolCall of message.toolCalls) {
        input.push({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.argumentsText
        });
      }
      continue;
    }
    input.push({
      type: "message",
      role: message.role,
      content: toResponsesContent(message)
    });
  }
  return input;
}
function toResponsesTools(tools = []) {
  if (!tools.length) return void 0;
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: false
  }));
}
function parseDataUrl(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl);
  return match ? { mediaType: match[1], data: match[2] } : void 0;
}
function parseJsonObject(text) {
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value : void 0;
}
function pushClaudeMessage(messages, role, content) {
  const previous = messages.at(-1);
  if (previous?.role === role && Array.isArray(previous.content)) {
    previous.content.push(...content);
    return;
  }
  messages.push({ role, content });
}
function toClaudeMessages(messages) {
  const system = [];
  const output = [];
  for (const message of messages) {
    if (message.role === "system") {
      if (message.content.trim()) system.push(message.content);
      continue;
    }
    if (message.role === "tool") {
      pushClaudeMessage(output, "user", [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId ?? message.id,
          content: message.content
        }
      ]);
      continue;
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      const content2 = [];
      if (message.content.trim()) content2.push({ type: "text", text: message.content });
      for (const toolCall of message.toolCalls) {
        content2.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.argumentsJson ?? parseJsonObject(toolCall.argumentsText)
        });
      }
      pushClaudeMessage(output, "assistant", content2);
      continue;
    }
    const content = [];
    if (message.content.trim() || !message.attachments?.length) {
      content.push({ type: "text", text: message.content || "Please analyze these images." });
    }
    for (const attachment of message.attachments?.filter((item) => item.type === "image") ?? []) {
      const parsed = parseDataUrl(attachment.dataUrl);
      if (!parsed) continue;
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: parsed.mediaType,
          data: parsed.data
        }
      });
    }
    pushClaudeMessage(output, message.role === "assistant" ? "assistant" : "user", content);
  }
  return {
    system: system.length ? system.join("\n\n") : void 0,
    messages: output
  };
}
function toClaudeTools(tools = []) {
  if (!tools.length) return void 0;
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters
  }));
}
function mergeToolCall(current, index, delta) {
  const deltaId = nonEmptyString(delta.id);
  const deltaName = nonEmptyString(delta.function?.name);
  const existing = current.get(index) ?? {
    id: deltaId ?? `tool_${index}_${Date.now()}`,
    name: deltaName ?? "",
    argumentsText: "",
    status: "running"
  };
  const next = {
    ...existing,
    id: deltaId ?? existing.id,
    name: deltaName ?? existing.name,
    argumentsText: `${existing.argumentsText}${delta.function?.arguments ?? ""}`
  };
  current.set(index, next);
  return next;
}
function mergeResponsesToolCall(current, index, patch) {
  const patchId = nonEmptyString(patch.call_id) ?? nonEmptyString(patch.id) ?? nonEmptyString(patch.item_id);
  const patchName = nonEmptyString(patch.name);
  const existing = current.get(index) ?? {
    id: patchId ?? `tool_${index}_${Date.now()}`,
    name: patchName ?? "",
    argumentsText: "",
    status: "running"
  };
  const next = {
    ...existing,
    id: patchId ?? existing.id,
    name: patchName ?? existing.name,
    argumentsText: typeof patch.arguments === "string" ? patch.arguments : `${existing.argumentsText}${patch.argumentsDelta ?? ""}`
  };
  current.set(index, next);
  return next;
}
function createClient(input, baseURL = input.model.interfaceConfig.apiUrl) {
  if (!input.model.interfaceConfig.apiKey.trim()) {
    throw new Error(`Model interface "${input.model.interfaceConfig.label}" has no API key configured.`);
  }
  return new OpenAI({
    apiKey: input.model.interfaceConfig.apiKey,
    baseURL,
    defaultHeaders: buildDefaultHeaders(input.model),
    dangerouslyAllowBrowser: true
  });
}
function openAiErrorText(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}
function isInvalidModelError(error) {
  const text = openAiErrorText(error).toLowerCase();
  return text.includes("invalid model") || text.includes("model name") || text.includes("model_not_found") || text.includes("model not found") || text.includes("no such model");
}
function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}
function uniqueCandidates(candidates) {
  return candidates.map((candidate) => candidate.trim()).filter(Boolean).filter((candidate, index, all) => all.indexOf(candidate) === index);
}
function versionedOpenAiBaseUrl(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  if (/\/(?:v\d+|compatible-mode\/v\d+|api\/paas\/v\d+)$/i.test(base)) return void 0;
  return `${base}/v1`;
}
function modelsEndpointCandidates(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  const versionedBase = versionedOpenAiBaseUrl(base);
  return uniqueCandidates([`${base}/models`, versionedBase ? `${versionedBase}/models` : ""]);
}
function chatBaseUrlCandidates(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  return uniqueCandidates([base, versionedOpenAiBaseUrl(base) ?? ""]);
}
function openAiChatModelCandidates(input, requestedModelName) {
  return uniqueCandidates([requestedModelName, input.model.modelId]);
}
function isLikelyChatModel(modelId) {
  return !/(?:embed|embedding|rerank|moderation|whisper|tts|speech|audio|image|vision|stable-diffusion|dall-e|wan-t2i)/i.test(
    modelId
  );
}
function scoreFallbackModel(providerId, modelId) {
  const model = modelId.toLowerCase();
  const provider = providerId.toLowerCase();
  let score = 0;
  if (model === "deepseek-chat") score += 120;
  if (model.includes("deepseek-chat")) score += 110;
  if (provider === "deepseek" && model.includes("deepseek") && model.includes("chat")) score += 100;
  if (provider === "deepseek" && model.includes("deepseek")) score += 80;
  if (model.includes("qwen") && model.includes("plus")) score += 70;
  if (model.includes("gpt-4o-mini")) score += 65;
  if (model.includes("chat")) score += 55;
  if (model.includes("pro")) score += 10;
  if (model.includes("free")) score -= 10;
  return score;
}
async function listOpenAiCompatibleModels(input) {
  const headers = {
    ...buildDefaultHeaders(input.model),
    authorization: `Bearer ${input.model.interfaceConfig.apiKey}`,
    "content-type": "application/json"
  };
  for (const url of modelsEndpointCandidates(input.model.interfaceConfig.apiUrl)) {
    try {
      const response = await fetch(url, { headers, signal: input.signal });
      if (!response.ok) continue;
      const payload = await response.json();
      const models = (payload.data ?? []).map((item) => typeof item.id === "string" ? item.id.trim() : "").filter(Boolean);
      if (models.length) return models;
    } catch {
    }
  }
  return [];
}
async function resolveFallbackOpenAiModel(input) {
  const listedModels = (await listOpenAiCompatibleModels(input)).filter(isLikelyChatModel);
  const [bestListedModel] = listedModels.sort(
    (left, right) => scoreFallbackModel(input.model.interfaceId, right) - scoreFallbackModel(input.model.interfaceId, left)
  );
  if (bestListedModel && bestListedModel !== input.model.modelName) return bestListedModel;
  if (input.model.interfaceId === "deepseek" && input.model.modelName !== "deepseek-chat") {
    return "deepseek-chat";
  }
  if (input.model.interfaceId === "wangyang" && input.model.modelName !== "deepseek") {
    return "deepseek";
  }
  return void 0;
}
async function createOpenAiChatStream(input, modelName, baseURL = input.model.interfaceConfig.apiUrl) {
  const client = createClient(input, baseURL);
  return client.chat.completions.create(
    {
      model: modelName,
      messages: toOpenAiMessages(input.messages),
      tools: toOpenAiTools(input.tools),
      temperature: input.temperature,
      stream: true,
      stream_options: {
        include_usage: true
      }
    },
    {
      signal: input.signal
    }
  );
}
async function createCompatibleOpenAiChatStream(input, requestedModelName) {
  const baseURLs = chatBaseUrlCandidates(input.model.interfaceConfig.apiUrl);
  const modelNames = openAiChatModelCandidates(input, requestedModelName);
  let lastError;
  for (const baseURL of baseURLs) {
    for (const modelName of modelNames) {
      try {
        return await createOpenAiChatStream(input, modelName, baseURL);
      } catch (error) {
        if (isAbortError(error)) throw error;
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(openAiErrorText(lastError));
}
async function* streamOpenAiChatCompletion(input) {
  let stream;
  try {
    stream = await createCompatibleOpenAiChatStream(input, input.model.modelName);
  } catch (error) {
    if (!isInvalidModelError(error)) throw error;
    const fallbackModel = await resolveFallbackOpenAiModel(input);
    if (!fallbackModel) throw error;
    stream = await createCompatibleOpenAiChatStream(input, fallbackModel);
  }
  const toolCalls = /* @__PURE__ */ new Map();
  for await (const chunk of stream) {
    const usage = chunk.usage;
    if (usage) {
      yield {
        type: "usage",
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        totalTokens: usage.total_tokens
      };
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) continue;
    if (typeof delta.content === "string" && delta.content.length > 0) {
      yield { type: "text-delta", text: delta.content };
    }
    for (const rawToolCall of delta.tool_calls ?? []) {
      const toolCall = mergeToolCall(toolCalls, rawToolCall.index ?? 0, rawToolCall);
      yield { type: "tool-call", toolCall };
    }
  }
}
async function* streamResponsesCompletion(input) {
  const client = createClient(input);
  const stream = await client.responses.create(
    {
      model: input.model.modelName,
      input: toResponsesInput(input.messages),
      tools: toResponsesTools(input.tools),
      temperature: input.temperature,
      stream: true,
      store: false,
      parallel_tool_calls: true
    },
    {
      signal: input.signal
    }
  );
  const toolCalls = /* @__PURE__ */ new Map();
  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string" && event.delta.length > 0) {
      yield { type: "text-delta", text: event.delta };
      continue;
    }
    if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
      const toolCall = mergeResponsesToolCall(toolCalls, event.output_index ?? 0, event.item);
      yield { type: "tool-call", toolCall };
      continue;
    }
    if (event.type === "response.function_call_arguments.delta") {
      const toolCall = mergeResponsesToolCall(toolCalls, event.output_index ?? 0, {
        item_id: event.item_id,
        argumentsDelta: event.delta
      });
      yield { type: "tool-call", toolCall };
      continue;
    }
    if (event.type === "response.function_call_arguments.done") {
      const toolCall = mergeResponsesToolCall(toolCalls, event.output_index ?? 0, {
        item_id: event.item_id,
        arguments: event.arguments
      });
      yield { type: "tool-call", toolCall };
      continue;
    }
    if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
      const toolCall = mergeResponsesToolCall(toolCalls, event.output_index ?? 0, event.item);
      yield { type: "tool-call", toolCall };
      continue;
    }
    if (event.type === "response.completed" && event.response?.usage) {
      const usage = event.response.usage;
      yield {
        type: "usage",
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens
      };
    }
  }
}
async function* streamSseEvents(response) {
  const reader = response.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = /\r?\n\r?\n/.exec(buffer);
    while (boundary) {
      const rawEvent = buffer.slice(0, boundary.index);
      buffer = buffer.slice(boundary.index + boundary[0].length);
      const data = rawEvent.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
      if (data && data !== "[DONE]") {
        yield JSON.parse(data);
      }
      boundary = /\r?\n\r?\n/.exec(buffer);
    }
  }
}
function mergeClaudeToolCall(current, index, patch) {
  const patchId = nonEmptyString(patch.id);
  const patchName = nonEmptyString(patch.name);
  const existing = current.get(index) ?? {
    id: patchId ?? `tool_${index}_${Date.now()}`,
    name: patchName ?? "",
    argumentsText: patch.input && Object.keys(patch.input).length ? JSON.stringify(patch.input) : "",
    status: "running"
  };
  const next = {
    ...existing,
    id: patchId ?? existing.id,
    name: patchName ?? existing.name,
    argumentsText: patch.input ? Object.keys(patch.input).length ? JSON.stringify(patch.input) : existing.argumentsText : `${existing.argumentsText}${patch.inputDelta ?? ""}`
  };
  current.set(index, next);
  return next;
}
async function* streamClaudeCompletion(input) {
  if (!input.model.interfaceConfig.apiKey.trim()) {
    throw new Error(`Model interface "${input.model.interfaceConfig.label}" has no API key configured.`);
  }
  const mapped = toClaudeMessages(input.messages);
  const headers = {
    ...buildDefaultHeaders(input.model),
    "content-type": "application/json",
    "anthropic-dangerous-direct-browser-access": "true",
    "x-api-key": input.model.interfaceConfig.apiKey
  };
  headers["anthropic-version"] = headers["anthropic-version"] ?? "2023-06-01";
  const response = await fetch(`${input.model.interfaceConfig.apiUrl.replace(/\/+$/, "")}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: input.model.modelName,
      max_tokens: 4096,
      system: mapped.system,
      messages: mapped.messages,
      tools: toClaudeTools(input.tools),
      temperature: input.temperature,
      stream: true
    }),
    signal: input.signal
  });
  if (!response.ok) {
    throw new Error(`Claude request failed (${response.status}): ${await response.text()}`);
  }
  const toolCalls = /* @__PURE__ */ new Map();
  let inputTokens;
  for await (const event of streamSseEvents(response)) {
    if (event.type === "message_start" && event.message?.usage) {
      inputTokens = event.message.usage.input_tokens;
      yield {
        type: "usage",
        inputTokens,
        outputTokens: event.message.usage.output_tokens,
        totalTokens: typeof inputTokens === "number" && typeof event.message.usage.output_tokens === "number" ? inputTokens + event.message.usage.output_tokens : void 0
      };
      continue;
    }
    if (event.type === "content_block_start" && event.content_block?.type === "tool_use") {
      const toolCall = mergeClaudeToolCall(toolCalls, event.index ?? 0, {
        id: event.content_block.id,
        name: event.content_block.name,
        input: event.content_block.input
      });
      yield { type: "tool-call", toolCall };
      continue;
    }
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
      yield { type: "text-delta", text: event.delta.text };
      continue;
    }
    if (event.type === "content_block_delta" && event.delta?.type === "input_json_delta") {
      const toolCall = mergeClaudeToolCall(toolCalls, event.index ?? 0, {
        inputDelta: event.delta.partial_json ?? ""
      });
      yield { type: "tool-call", toolCall };
      continue;
    }
    if (event.type === "content_block_stop") {
      const toolCall = toolCalls.get(event.index ?? 0);
      if (toolCall?.name) {
        yield { type: "tool-call", toolCall: toolCall.argumentsText ? toolCall : { ...toolCall, argumentsText: "{}" } };
      }
      continue;
    }
    if (event.type === "message_delta" && event.usage) {
      const outputTokens = event.usage.output_tokens;
      yield {
        type: "usage",
        inputTokens,
        outputTokens,
        totalTokens: typeof inputTokens === "number" && typeof outputTokens === "number" ? inputTokens + outputTokens : void 0
      };
    }
  }
}
async function* streamChatCompletion(input) {
  if (input.model.requestFormat === "openai") {
    yield* streamOpenAiChatCompletion(input);
    return;
  }
  if (input.model.requestFormat === "responses") {
    yield* streamResponsesCompletion(input);
    return;
  }
  if (input.model.requestFormat === "claude") {
    yield* streamClaudeCompletion(input);
    return;
  }
  throw new Error(`Unsupported request format: ${input.model.requestFormat}.`);
}
function estimateTokens(text) {
  try {
    return gptTokenizer.encode(text).length;
  } catch {
    return Math.ceil(text.length / 4);
  }
}
function buildSmartContextUserPrompt(input) {
  const maxInputTokens = input.maxInputTokens;
  const chunks = [];
  let used = estimateTokens(input.existingContext ?? "");
  for (const file of input.files) {
    const block = `<file path="${file.path}">
${file.content}
</file>`;
    const cost = estimateTokens(block);
    if (used + cost > maxInputTokens) {
      const head = file.content.slice(0, 4e3);
      const tail = file.content.slice(-4e3);
      chunks.push(`<file path="${file.path}" truncated="true">
${head}
...
${tail}
</file>`);
      break;
    }
    chunks.push(block);
    used += cost;
  }
  return [
    `Project: ${input.projectName}`,
    input.existingContext ? `<existing_context>
${input.existingContext}
</existing_context>` : "",
    "<changed_files>",
    chunks.join("\n\n"),
    "</changed_files>",
    "Update the project memory so future writing and agent tasks can use concise, durable context."
  ].filter(Boolean).join("\n\n");
}
const contextDirs = ["rules", "outline", "chapters", "roles", "objects", "records", "inspirations"];
const textExtensions = /* @__PURE__ */ new Set([".md", ".txt", ".json", ".yaml", ".yml"]);
const defaultMaxFiles = 40;
const hardMaxFiles = 60;
const maxFileBytes = 256 * 1024;
function ensureRoot$1(root) {
  if (!root.trim()) throw new Error("Project root is not configured.");
  return path.resolve(root);
}
function toRelative(root, fullPath) {
  return path.relative(root, fullPath).replace(/\\/g, "/");
}
function clampMaxFiles(value) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : defaultMaxFiles;
  if (!Number.isFinite(numeric)) return defaultMaxFiles;
  return Math.min(hardMaxFiles, Math.max(1, Math.floor(numeric)));
}
async function readLimitedText(fullPath) {
  const meta = await promises.stat(fullPath);
  if (meta.size <= maxFileBytes) return promises.readFile(fullPath, "utf8");
  const handle = await promises.open(fullPath, "r");
  try {
    const buffer = Buffer.alloc(maxFileBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxFileBytes, 0);
    return `${buffer.subarray(0, bytesRead).toString("utf8")}

[文件超过 ${maxFileBytes} bytes，仅收集开头片段]`;
  } finally {
    await handle.close();
  }
}
function hashText(content) {
  return node_crypto.createHash("sha256").update(content).digest("hex");
}
async function collectTextFiles(root, dir, out, maxFiles) {
  if (out.length >= maxFiles) return;
  let entries;
  try {
    entries = await promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (out.length >= maxFiles) break;
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "out") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectTextFiles(root, fullPath, out, maxFiles);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name).toLowerCase())) continue;
    try {
      const content = await readLimitedText(fullPath);
      out.push({ path: toRelative(root, fullPath), content });
    } catch {
    }
  }
}
async function buildSmartContextDraft(root, maxFilesInput = defaultMaxFiles) {
  const resolvedRoot = ensureRoot$1(root);
  const maxFiles = clampMaxFiles(maxFilesInput);
  const files = [];
  for (const dir of contextDirs) {
    await collectTextFiles(resolvedRoot, path.join(resolvedRoot, dir), files, maxFiles);
  }
  const projectName = path.basename(resolvedRoot);
  const prompt = buildSmartContextUserPrompt({
    projectName,
    files,
    maxInputTokens: 7e4
  });
  return {
    projectName,
    files: files.map((file) => ({ path: file.path, chars: file.content.length, hash: hashText(file.content) })),
    prompt,
    createdAt: Date.now()
  };
}
async function generateSmartContext(root, aiConfig, maxFilesInput = defaultMaxFiles) {
  const draft = await buildSmartContextDraft(root, maxFilesInput);
  const model = resolveModel(aiConfig, aiConfig.scenario.smartContext);
  if (!model.interfaceConfig.apiKey.trim()) {
    throw new Error("Smart context generation requires an API key for the configured smartContext model.");
  }
  const messages = [
    {
      id: "smart_context_system",
      role: "system",
      content: "You maintain a durable memory document for a long-form fiction project. Return concise Chinese Markdown with stable facts, character state, world rules, unresolved threads, and continuity risks. Do not include tool instructions.",
      createdAt: Date.now()
    },
    {
      id: "smart_context_user",
      role: "user",
      content: draft.prompt,
      createdAt: Date.now()
    }
  ];
  let content = "";
  for await (const event of streamChatCompletion({
    model,
    messages,
    temperature: 0.2
  })) {
    if (event.type === "text-delta") content += event.text;
  }
  const generatedContent = content.trim();
  if (!generatedContent) {
    throw new Error("Smart context model returned empty content.");
  }
  return {
    ...draft,
    content: generatedContent,
    model: model.modelId
  };
}
function ensureRoot(root) {
  if (!root.trim()) throw new Error("项目根目录未配置。");
  return path.resolve(root);
}
function resolveInsideRoot(root, relativePath) {
  const resolvedRoot = ensureRoot(root);
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const target = path.resolve(resolvedRoot, normalized);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`路径超出项目根目录：${relativePath}。项目根目录：${resolvedRoot}，解析目标：${target}`);
  }
  return target;
}
function safeName(input) {
  return input.trim().replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, "-").slice(0, 36) || "generated-image";
}
function imageMimeType(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}
function assertSupportedImagePath(relativePath) {
  const ext = path.extname(relativePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) {
    throw new Error(`图片编辑源文件必须是项目内 PNG、JPG、JPEG 或 WebP 图片：${relativePath || "未提供路径"}（当前扩展名：${ext || "无"}）`);
  }
}
function assertOpenAiCompatibleImageModel(model, feature) {
  if (model.requestFormat !== "openai") {
    throw new Error(
      `${feature} 需要 OpenAI-compatible Images API 接口。当前模型 ${model.modelId} 所属接口 ${model.interfaceId} 的请求格式是 ${model.requestFormat}。`
    );
  }
}
async function imageBufferFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`图片 URL 下载失败：${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}
async function generateProjectImage(root, aiConfig, prompt, size = "1024x1024") {
  const cleanPrompt = prompt.trim();
  if (!cleanPrompt) throw new Error("图片提示词不能为空。");
  const resolvedRoot = ensureRoot(root);
  const model = resolveModel(aiConfig, aiConfig.scenario.image);
  if (!model.interfaceConfig.apiKey.trim()) {
    throw new Error("图片生成需要先在模型配置中为图片模型接口填写 API key。");
  }
  assertOpenAiCompatibleImageModel(model, "图片生成");
  const client = new OpenAI({
    apiKey: model.interfaceConfig.apiKey,
    baseURL: model.interfaceConfig.apiUrl,
    defaultHeaders: buildDefaultHeaders(model)
  });
  const result = await client.images.generate({
    model: model.modelName,
    prompt: cleanPrompt,
    size,
    n: 1,
    response_format: "b64_json"
  });
  const first = result.data?.[0];
  if (!first) throw new Error("图片生成接口没有返回图片。");
  const buffer = first.b64_json ? Buffer.from(first.b64_json, "base64") : first.url ? await imageBufferFromUrl(first.url) : void 0;
  if (!buffer) throw new Error("图片生成接口返回了不支持的结果格式。");
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const baseName = `${stamp}-${safeName(cleanPrompt)}`;
  const relativePath = `assets/generated/${baseName}.png`;
  const manifestPath = `assets/generated/${baseName}.md`;
  const imagePath = path.join(resolvedRoot, relativePath);
  const manifestFullPath = path.join(resolvedRoot, manifestPath);
  await promises.mkdir(path.dirname(imagePath), { recursive: true });
  await promises.writeFile(imagePath, buffer);
  await promises.writeFile(
    manifestFullPath,
    `# 图片资产

创建时间：${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}

## 文件

${relativePath}

## 模型

${model.modelName}

## 尺寸

${size}

## 提示词

${cleanPrompt}
`,
    "utf8"
  );
  return {
    relativePath,
    manifestPath,
    prompt: cleanPrompt,
    model: model.modelName,
    size,
    operation: "generate",
    createdAt: Date.now()
  };
}
async function editProjectImage(root, aiConfig, sourcePath, prompt, size = "1024x1024") {
  const cleanPrompt = prompt.trim();
  const cleanSourcePath = sourcePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleanSourcePath) throw new Error("源图片路径不能为空。");
  if (!cleanPrompt) throw new Error("图片编辑提示词不能为空。");
  assertSupportedImagePath(cleanSourcePath);
  const resolvedRoot = ensureRoot(root);
  const sourceFullPath = resolveInsideRoot(resolvedRoot, cleanSourcePath);
  const sourceBuffer = await promises.readFile(sourceFullPath);
  const model = resolveModel(aiConfig, aiConfig.scenario.imageEdit);
  if (!model.interfaceConfig.apiKey.trim()) {
    throw new Error("图片编辑需要先在模型配置中为图片编辑模型接口填写 API Key。");
  }
  assertOpenAiCompatibleImageModel(model, "图片编辑");
  const client = new OpenAI({
    apiKey: model.interfaceConfig.apiKey,
    baseURL: model.interfaceConfig.apiUrl,
    defaultHeaders: buildDefaultHeaders(model)
  });
  const imageFile = await OpenAI.toFile(sourceBuffer, path.basename(cleanSourcePath), {
    type: imageMimeType(cleanSourcePath)
  });
  const result = await client.images.edit({
    model: model.modelName,
    image: imageFile,
    prompt: cleanPrompt,
    size,
    n: 1,
    response_format: "b64_json"
  });
  const first = result.data?.[0];
  if (!first) throw new Error("图片编辑接口没有返回图片。");
  const buffer = first.b64_json ? Buffer.from(first.b64_json, "base64") : first.url ? await imageBufferFromUrl(first.url) : void 0;
  if (!buffer) throw new Error("图片编辑接口返回了不支持的结果格式。");
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
  const baseName = `${stamp}-edit-${safeName(cleanPrompt)}`;
  const relativePath = `assets/generated/${baseName}.png`;
  const manifestPath = `assets/generated/${baseName}.md`;
  const imagePath = path.join(resolvedRoot, relativePath);
  const manifestFullPath = path.join(resolvedRoot, manifestPath);
  await promises.mkdir(path.dirname(imagePath), { recursive: true });
  await promises.writeFile(imagePath, buffer);
  await promises.writeFile(
    manifestFullPath,
    `# 图片编辑资产

创建时间：${(/* @__PURE__ */ new Date()).toLocaleString("zh-CN")}

## 文件

${relativePath}

## 源图片

${cleanSourcePath}

## 模型

${model.modelName}

## 尺寸

${size}

## 提示词

${cleanPrompt}
`,
    "utf8"
  );
  return {
    relativePath,
    manifestPath,
    prompt: cleanPrompt,
    model: model.modelName,
    size,
    operation: "edit",
    sourcePath: cleanSourcePath,
    createdAt: Date.now()
  };
}
const clients = /* @__PURE__ */ new Map();
function normalizeParameters(schema) {
  if (schema && typeof schema === "object") {
    return schema;
  }
  return { type: "object", properties: {}, additionalProperties: true };
}
function uniqueToolName(serverName, toolName, used) {
  if (!used.has(toolName)) return toolName;
  return `${serverName}_${toolName}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}
function createTransport(serverName, config) {
  const server = config.mcpServers[serverName];
  const type = server.type ?? "stdio";
  if (type === "stdio") {
    if (!server.command) {
      throw new Error(`MCP server command is missing: ${serverName}`);
    }
    return new stdio_js.StdioClientTransport({
      command: server.command,
      args: server.args ?? [],
      env: {
        ...process.env,
        ...config.commandEnv ?? {},
        ...server.env ?? {}
      }
    });
  }
  if (!server.url?.trim()) {
    throw new Error(`MCP server URL is missing: ${serverName}`);
  }
  const requestInit = Object.keys(server.headers ?? {}).length ? { headers: server.headers } : void 0;
  const url = new URL(server.url);
  if (type === "sse") {
    return new sse_js.SSEClientTransport(url, { requestInit });
  }
  return new streamableHttp_js.StreamableHTTPClientTransport(url, { requestInit });
}
async function getClient(serverName, config) {
  const existing = clients.get(serverName);
  if (existing) return existing;
  const server = config.mcpServers[serverName];
  if (!server || server.disabled || config.disabled?.[serverName]) {
    throw new Error(`MCP server is disabled or missing: ${serverName}`);
  }
  const transport = createTransport(serverName, config);
  const client = new index_js.Client(
    { name: "wangyang", version: "0.1.0" },
    { capabilities: {} }
  );
  await client.connect(transport);
  const record = { client, transport };
  clients.set(serverName, record);
  return record;
}
async function listMcpTools(config) {
  const used = /* @__PURE__ */ new Set();
  const output = [];
  for (const serverName of Object.keys(config.mcpServers)) {
    const server = config.mcpServers[serverName];
    if (server.disabled || config.disabled?.[serverName]) continue;
    const record = await getClient(serverName, config);
    const result = await record.client.listTools();
    for (const tool of result.tools ?? []) {
      const finalName = uniqueToolName(serverName, tool.name, used);
      used.add(finalName);
      output.push({
        serverName,
        toolName: tool.name,
        finalName,
        description: tool.description ?? `MCP tool ${tool.name} from ${serverName}`,
        parameters: normalizeParameters(tool.inputSchema),
        transport: server.type ?? "stdio"
      });
    }
  }
  return output;
}
async function callMcpTool(config, serverName, toolName, args) {
  const record = await getClient(serverName, config);
  return record.client.callTool({ name: toolName, arguments: args });
}
async function closeAllMcpClients() {
  const records = [...clients.values()];
  clients.clear();
  await Promise.allSettled(records.map((record) => record.client.close()));
}
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
function htmlToText(input) {
  return input.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
}
async function fetchUrlContent(url, timeoutMs = 3e4) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http and https URLs are allowed.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, 6e4));
  try {
    const response = await fetch(parsed, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "王阳/0.1"
      }
    });
    const contentType = response.headers.get("content-type") ?? "";
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_RESPONSE_BYTES) {
      throw new Error("Response is larger than 5 MB.");
    }
    const rawText = buffer.toString("utf8");
    return {
      url,
      finalUrl: response.url,
      status: response.status,
      contentType,
      text: contentType.includes("html") ? htmlToText(rawText) : rawText
    };
  } finally {
    clearTimeout(timeout);
  }
}
const IPC = {
  getAppSnapshot: "app:get-snapshot",
  getProjects: "project:get-projects",
  createProject: "project:create-project",
  openProject: "project:open-project",
  renameProject: "project:rename-project",
  deleteProject: "project:delete-project",
  readProjectConfig: "project:read-config",
  writeProjectConfig: "project:write-config",
  listSkills: "skill:list",
  listSkillDirectory: "skill:list-directory",
  createSkill: "skill:create",
  deleteSkill: "skill:delete",
  listAgents: "agent:list-files",
  readAgentContent: "agent:read-content",
  writeAgentContent: "agent:write-content",
  createAgent: "agent:create-file",
  deleteAgent: "agent:delete-file",
  listSubAgentSessions: "sub-agent:list-sessions",
  writeSubAgentSession: "sub-agent:write-session",
  deleteSubAgentSession: "sub-agent:delete-session",
  setProjectRoot: "project:set-root",
  listDirectory: "project:list-directory",
  readFile: "project:read-file",
  writeFile: "project:write-file",
  createEntry: "project:create-entry",
  renameEntry: "project:rename-entry",
  deleteEntry: "project:delete-entry",
  moveEntry: "project:move-entry",
  searchInFiles: "project:search-in-files",
  searchFiles: "project:search-files",
  importAgentSessionsFromDirectory: "dialog:import-agent-sessions-from-directory",
  openTextFile: "dialog:open-text-file",
  saveTextFile: "dialog:save-text-file",
  saveBinaryFile: "dialog:save-binary-file",
  savePdfFromHtml: "dialog:save-pdf-from-html",
  selectDirectory: "dialog:select-directory",
  showItemInFolder: "shell:show-item-in-folder",
  openProjectPathExternal: "shell:open-project-path-external",
  showProjectPathInFolder: "shell:show-project-path-in-folder",
  openProjectFolder: "shell:open-project-folder",
  readProjectFileDataUrl: "project:read-file-data-url",
  buildSmartContext: "project:build-smart-context",
  generateSmartContext: "project:generate-smart-context",
  generateImage: "image:generate",
  editImage: "image:edit",
  createBackup: "backup:create",
  listBackups: "backup:list",
  getAiConfig: "ai:get-config",
  saveAiConfig: "ai:save-config",
  listRemoteModels: "ai:list-remote-models",
  getMcpConfig: "mcp:get-config",
  saveMcpConfig: "mcp:save-config",
  getLocalSettings: "settings:get-local",
  saveLocalSettings: "settings:save-local",
  listMcpTools: "mcp:list-tools",
  callMcpTool: "mcp:call-tool",
  closeMcpClients: "mcp:close-all",
  fetchUrlContent: "network:fetch-url-content",
  runCommand: "command:run",
  windowMinimize: "window:minimize",
  windowToggleMaximize: "window:toggle-maximize",
  windowClose: "window:close"
};
const TEXT_IMPORT_EXTENSIONS = /* @__PURE__ */ new Set([".txt", ".md", ".markdown", ".html", ".htm"]);
const MAX_TEXT_IMPORT_BYTES = 20 * 1024 * 1024;
const AGENT_SESSIONS_FILE_NAME = "agent-sessions.json";
function uniqueStrings(values) {
  return values.filter((value, index, all) => value && all.indexOf(value) === index);
}
function versionedModelBaseUrl(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  if (/\/(?:v\d+|compatible-mode\/v\d+|api\/paas\/v\d+)$/i.test(base)) return void 0;
  return `${base}/v1`;
}
function modelEndpointCandidates(apiUrl) {
  const base = apiUrl.replace(/\/+$/, "");
  const versioned = versionedModelBaseUrl(base);
  return uniqueStrings([`${base}/models`, versioned ? `${versioned}/models` : ""]);
}
function remoteModelHeaders(provider) {
  const requestFormat = provider.requestFormat ?? "openai";
  const headers = {
    ...provider.defaultHeaders ?? {},
    "content-type": "application/json"
  };
  if (requestFormat === "claude") {
    headers["x-api-key"] = provider.apiKey;
    headers["anthropic-version"] = headers["anthropic-version"] ?? "2023-06-01";
  } else {
    headers.authorization = `Bearer ${provider.apiKey}`;
  }
  return headers;
}
async function listRemoteProviderModels(provider) {
  const apiUrl = provider.apiUrl.trim();
  const apiKey = provider.apiKey.trim();
  if (!apiUrl) throw new Error("请先填写 Base URL");
  if (!apiKey) throw new Error("请先填写 API Key");
  let lastError = "";
  for (const url of modelEndpointCandidates(apiUrl)) {
    try {
      const response = await fetch(url, { headers: remoteModelHeaders({ ...provider, apiUrl, apiKey }) });
      if (!response.ok) {
        lastError = `${response.status} ${response.statusText}`.trim();
        continue;
      }
      const payload = await response.json();
      const models = uniqueStrings(
        (payload.data ?? []).map((item) => typeof item.id === "string" ? item.id.trim() : "").filter(Boolean)
      );
      if (models.length) return models;
      lastError = "接口没有返回模型列表";
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError || "加载模型失败");
}
function normalizeImportedAgentSessions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((session) => {
    const candidate = session;
    return typeof candidate.id === "string" && typeof candidate.title === "string" && ["professional", "planning", "writing", "adventure"].includes(String(candidate.mode)) && Array.isArray(candidate.messages) && typeof candidate.createdAt === "number" && typeof candidate.updatedAt === "number";
  });
}
async function readAgentSessionsFromDirectory(directoryPath) {
  const resolved = path.resolve(directoryPath);
  const candidates = [
    path.join(resolved, AGENT_SESSIONS_FILE_NAME),
    path.join(resolved, ".wangyang", AGENT_SESSIONS_FILE_NAME)
  ];
  for (const candidate of candidates) {
    try {
      const raw = await promises.readFile(candidate, "utf8");
      const sessions = normalizeImportedAgentSessions(JSON.parse(raw));
      if (!sessions.length) throw new Error("No valid sessions found.");
      return { path: candidate, sessions };
    } catch {
    }
  }
  throw new Error("未找到可导入的历史会话文件。请选择包含 agent-sessions.json 的文件夹，或项目根目录。");
}
const IMAGE_PREVIEW_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};
const MAX_IMAGE_PREVIEW_BYTES = 15 * 1024 * 1024;
function resolveCommandCwd(projectRoot, requestedCwd) {
  if (!projectRoot.trim()) return requestedCwd?.trim() ? path.resolve(requestedCwd) : "";
  const root = path.resolve(projectRoot);
  const requested = requestedCwd?.trim() ? path.resolve(requestedCwd) : root;
  const rootWithSep = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return requested === root || requested.startsWith(rootWithSep) ? requested : root;
}
function resolveInsideProject(root, relativePath) {
  if (!root.trim()) throw new Error("Project root is not configured.");
  const resolvedRoot = path.resolve(root);
  const normalized = relativePath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || path.isAbsolute(normalized) || normalized.split("/").some((segment) => segment === "..")) {
    throw new Error("Project path must be relative and stay inside the project root.");
  }
  const target = path.resolve(resolvedRoot, normalized);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return target;
}
async function chooseSavePath(event, defaultName, filters) {
  const snapshot = await jsonStore.snapshot();
  const window = electron.BrowserWindow.fromWebContents(event.sender);
  const safeDefaultName = defaultName.trim() || "wangyang-export";
  const defaultPath = snapshot.projectRoot ? path.join(snapshot.projectRoot, ".wangyang", "exports", safeDefaultName) : safeDefaultName;
  const options = {
    defaultPath,
    filters: [...filters, { name: "All files", extensions: ["*"] }]
  };
  const result = window ? await electron.dialog.showSaveDialog(window, options) : await electron.dialog.showSaveDialog(options);
  return result.canceled || !result.filePath ? void 0 : result.filePath;
}
function registerIpcHandlers() {
  electron.ipcMain.handle(IPC.windowMinimize, (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  electron.ipcMain.handle(IPC.windowToggleMaximize, (event) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  electron.ipcMain.handle(IPC.windowClose, (event) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.close();
  });
  electron.ipcMain.handle(IPC.getAppSnapshot, () => jsonStore.snapshot());
  electron.ipcMain.handle(IPC.getProjects, () => jsonStore.getProjects());
  electron.ipcMain.handle(IPC.createProject, async (_event, input) => {
    const project = await jsonStore.createProject(input);
    void refreshBackupScheduler();
    return project;
  });
  electron.ipcMain.handle(IPC.openProject, async (_event, id) => {
    await jsonStore.openProject(id);
    void refreshBackupScheduler();
    return jsonStore.snapshot();
  });
  electron.ipcMain.handle(IPC.renameProject, async (_event, id, name) => jsonStore.renameProject(id, name));
  electron.ipcMain.handle(IPC.deleteProject, async (_event, id, deleteFiles) => {
    const result = await jsonStore.deleteProject(id, Boolean(deleteFiles));
    void refreshBackupScheduler();
    return result;
  });
  electron.ipcMain.handle(IPC.readProjectConfig, async () => {
    const snapshot = await jsonStore.snapshot();
    return readProjectConfig(snapshot.projectRoot);
  });
  electron.ipcMain.handle(IPC.writeProjectConfig, async (_event, config) => {
    const snapshot = await jsonStore.snapshot();
    return writeProjectConfig(snapshot.projectRoot, config);
  });
  electron.ipcMain.handle(IPC.listSkills, async () => {
    const snapshot = await jsonStore.snapshot();
    return listSkills(snapshot.projectRoot);
  });
  electron.ipcMain.handle(IPC.listSkillDirectory, async (_event, skillName) => {
    const snapshot = await jsonStore.snapshot();
    return listSkillDirectory(snapshot.projectRoot, skillName);
  });
  electron.ipcMain.handle(IPC.createSkill, async (_event, name, content) => {
    const snapshot = await jsonStore.snapshot();
    return createSkill(snapshot.projectRoot, name, content);
  });
  electron.ipcMain.handle(IPC.deleteSkill, async (_event, name) => {
    const snapshot = await jsonStore.snapshot();
    return deleteSkill(snapshot.projectRoot, name);
  });
  electron.ipcMain.handle(IPC.listAgents, async () => {
    const snapshot = await jsonStore.snapshot();
    return listAgents(snapshot.projectRoot);
  });
  electron.ipcMain.handle(IPC.readAgentContent, async (_event, agentId) => {
    const snapshot = await jsonStore.snapshot();
    return readAgentContent(snapshot.projectRoot, agentId);
  });
  electron.ipcMain.handle(IPC.writeAgentContent, async (_event, agentId, content) => {
    const snapshot = await jsonStore.snapshot();
    return writeAgentContent(snapshot.projectRoot, agentId, content);
  });
  electron.ipcMain.handle(IPC.createAgent, async (_event, agentId, content) => {
    const snapshot = await jsonStore.snapshot();
    return createAgent(snapshot.projectRoot, agentId, content);
  });
  electron.ipcMain.handle(IPC.deleteAgent, async (_event, agentId) => {
    const snapshot = await jsonStore.snapshot();
    return deleteAgent(snapshot.projectRoot, agentId);
  });
  electron.ipcMain.handle(IPC.listSubAgentSessions, async () => {
    const snapshot = await jsonStore.snapshot();
    return listSubAgentSessions(snapshot.projectRoot);
  });
  electron.ipcMain.handle(IPC.writeSubAgentSession, async (_event, session) => {
    const snapshot = await jsonStore.snapshot();
    return writeSubAgentSession(snapshot.projectRoot, session);
  });
  electron.ipcMain.handle(IPC.deleteSubAgentSession, async (_event, sessionId) => {
    const snapshot = await jsonStore.snapshot();
    return deleteSubAgentSession(snapshot.projectRoot, sessionId);
  });
  electron.ipcMain.handle(IPC.setProjectRoot, async (_event, projectRoot) => {
    await jsonStore.setProjectRoot(projectRoot);
    void refreshBackupScheduler();
    return jsonStore.snapshot();
  });
  electron.ipcMain.handle(IPC.listDirectory, async (_event, relativePath = "") => {
    const snapshot = await jsonStore.snapshot();
    return listDirectory(snapshot.projectRoot, relativePath);
  });
  electron.ipcMain.handle(IPC.readFile, async (_event, relativePath) => {
    const snapshot = await jsonStore.snapshot();
    if (!snapshot.projectRoot) return "";
    return readProjectFile(snapshot.projectRoot, relativePath);
  });
  electron.ipcMain.handle(IPC.writeFile, async (_event, relativePath, content) => {
    const snapshot = await jsonStore.snapshot();
    return writeProjectFile(snapshot.projectRoot, relativePath, content);
  });
  electron.ipcMain.handle(
    IPC.createEntry,
    async (_event, relativePath, type, content) => {
      const snapshot = await jsonStore.snapshot();
      return createProjectEntry(snapshot.projectRoot, relativePath, type, content);
    }
  );
  electron.ipcMain.handle(IPC.renameEntry, async (_event, relativePath, nextName) => {
    const snapshot = await jsonStore.snapshot();
    return renameProjectEntry(snapshot.projectRoot, relativePath, nextName);
  });
  electron.ipcMain.handle(IPC.deleteEntry, async (_event, relativePath) => {
    const snapshot = await jsonStore.snapshot();
    return deleteProjectEntry(snapshot.projectRoot, relativePath);
  });
  electron.ipcMain.handle(IPC.moveEntry, async (_event, relativePath, targetRelativePath) => {
    const snapshot = await jsonStore.snapshot();
    return moveProjectEntry(snapshot.projectRoot, relativePath, targetRelativePath);
  });
  electron.ipcMain.handle(IPC.searchInFiles, async (_event, query, limit) => {
    const snapshot = await jsonStore.snapshot();
    return searchInFiles(snapshot.projectRoot, query, limit);
  });
  electron.ipcMain.handle(IPC.searchFiles, async (_event, query, limit) => {
    const snapshot = await jsonStore.snapshot();
    return searchProjectFiles(snapshot.projectRoot, query, limit);
  });
  electron.ipcMain.handle(IPC.importAgentSessionsFromDirectory, async (_event, directoryPath) => {
    return readAgentSessionsFromDirectory(directoryPath);
  });
  electron.ipcMain.handle(IPC.openTextFile, async (event) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    const options = {
      properties: ["openFile"],
      filters: [
        { name: "Text documents", extensions: ["txt", "md", "markdown", "html", "htm"] }
      ]
    };
    const result = window ? await electron.dialog.showOpenDialog(window, options) : await electron.dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return void 0;
    const filePath = result.filePaths[0];
    const extension = path.extname(filePath).toLowerCase();
    if (!TEXT_IMPORT_EXTENSIONS.has(extension)) {
      throw new Error("Only TXT, Markdown, and HTML files can be imported as full-book text.");
    }
    const meta = await promises.stat(filePath);
    if (!meta.isFile()) throw new Error("Selected import path is not a file.");
    if (meta.size > MAX_TEXT_IMPORT_BYTES) {
      throw new Error("Import file is too large. Please choose a text file under 20 MB.");
    }
    return {
      path: filePath,
      name: path.basename(filePath),
      content: await promises.readFile(filePath, "utf8")
    };
  });
  electron.ipcMain.handle(IPC.saveTextFile, async (event, defaultName, content) => {
    const snapshot = await jsonStore.snapshot();
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    const safeDefaultName = defaultName.trim() || "wangyang-export.md";
    const defaultPath = snapshot.projectRoot ? path.join(snapshot.projectRoot, ".wangyang", "exports", safeDefaultName) : safeDefaultName;
    const result = window ? await electron.dialog.showSaveDialog(window, {
      defaultPath,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "Text", extensions: ["txt"] },
        { name: "HTML", extensions: ["html", "htm"] },
        { name: "All files", extensions: ["*"] }
      ]
    }) : await electron.dialog.showSaveDialog({
      defaultPath,
      filters: [
        { name: "Markdown", extensions: ["md", "markdown"] },
        { name: "Text", extensions: ["txt"] },
        { name: "HTML", extensions: ["html", "htm"] },
        { name: "All files", extensions: ["*"] }
      ]
    });
    if (result.canceled || !result.filePath) return void 0;
    await promises.mkdir(path.dirname(result.filePath), { recursive: true });
    await promises.writeFile(result.filePath, content, "utf8");
    return { path: result.filePath };
  });
  electron.ipcMain.handle(IPC.saveBinaryFile, async (event, defaultName, base64) => {
    const extension = path.extname(defaultName).toLowerCase();
    const filters = extension === ".docx" ? [{ name: "Word document", extensions: ["docx"] }] : extension === ".pdf" ? [{ name: "PDF", extensions: ["pdf"] }] : extension === ".epub" ? [{ name: "EPUB", extensions: ["epub"] }] : [{ name: "Binary file", extensions: [extension.replace(/^\./, "") || "*"] }];
    const filePath = await chooseSavePath(event, defaultName, filters);
    if (!filePath) return void 0;
    await promises.mkdir(path.dirname(filePath), { recursive: true });
    await promises.writeFile(filePath, Buffer.from(base64, "base64"));
    return { path: filePath };
  });
  electron.ipcMain.handle(IPC.savePdfFromHtml, async (event, defaultName, html) => {
    const filePath = await chooseSavePath(event, defaultName, [{ name: "PDF", extensions: ["pdf"] }]);
    if (!filePath) return void 0;
    const pdfWindow = new electron.BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true
      }
    });
    try {
      await pdfWindow.loadURL("about:blank");
      await pdfWindow.webContents.executeJavaScript(
        `document.open(); document.write(${JSON.stringify(html)}); document.close();`
      );
      const buffer = await pdfWindow.webContents.printToPDF({
        printBackground: true,
        pageSize: "A4"
      });
      await promises.mkdir(path.dirname(filePath), { recursive: true });
      await promises.writeFile(filePath, buffer);
      return { path: filePath };
    } finally {
      if (!pdfWindow.isDestroyed()) {
        pdfWindow.destroy();
      }
    }
  });
  electron.ipcMain.handle(IPC.selectDirectory, async (event, defaultPath) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    const options = {
      defaultPath: defaultPath?.trim() || void 0,
      properties: ["openDirectory", "createDirectory"]
    };
    const result = window ? await electron.dialog.showOpenDialog(window, options) : await electron.dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? void 0 : { path: result.filePaths[0] };
  });
  electron.ipcMain.handle(IPC.showItemInFolder, (_event, filePath) => {
    if (filePath.trim()) electron.shell.showItemInFolder(filePath);
  });
  electron.ipcMain.handle(IPC.openProjectPathExternal, async (_event, relativePath) => {
    const snapshot = await jsonStore.snapshot();
    const fullPath = resolveInsideProject(snapshot.projectRoot, relativePath);
    const error = await electron.shell.openPath(fullPath);
    return { path: fullPath, error: error || void 0 };
  });
  electron.ipcMain.handle(IPC.showProjectPathInFolder, async (_event, relativePath) => {
    const snapshot = await jsonStore.snapshot();
    electron.shell.showItemInFolder(resolveInsideProject(snapshot.projectRoot, relativePath));
  });
  electron.ipcMain.handle(IPC.openProjectFolder, async () => {
    const snapshot = await jsonStore.snapshot();
    if (!snapshot.projectRoot.trim()) throw new Error("Project root is not configured.");
    const fullPath = path.resolve(snapshot.projectRoot);
    const error = await electron.shell.openPath(fullPath);
    return { path: fullPath, error: error || void 0 };
  });
  electron.ipcMain.handle(IPC.readProjectFileDataUrl, async (_event, relativePath) => {
    const snapshot = await jsonStore.snapshot();
    const fullPath = resolveInsideProject(snapshot.projectRoot, relativePath);
    const extension = path.extname(fullPath).toLowerCase();
    const mime = IMAGE_PREVIEW_MIME[extension];
    if (!mime) throw new Error("Only PNG, JPG, WebP, GIF, and SVG files can be previewed.");
    const meta = await promises.stat(fullPath);
    if (!meta.isFile()) throw new Error("Preview target is not a file.");
    if (meta.size > MAX_IMAGE_PREVIEW_BYTES) throw new Error("Image is too large to preview.");
    const buffer = await promises.readFile(fullPath);
    return {
      dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
      mime,
      size: meta.size
    };
  });
  electron.ipcMain.handle(IPC.buildSmartContext, async (_event, maxFiles) => {
    const snapshot = await jsonStore.snapshot();
    return buildSmartContextDraft(snapshot.projectRoot, maxFiles);
  });
  electron.ipcMain.handle(IPC.generateSmartContext, async (_event, maxFiles) => {
    const snapshot = await jsonStore.snapshot();
    return generateSmartContext(snapshot.projectRoot, snapshot.aiConfig, maxFiles);
  });
  electron.ipcMain.handle(IPC.generateImage, async (_event, prompt, size) => {
    const snapshot = await jsonStore.snapshot();
    return generateProjectImage(snapshot.projectRoot, snapshot.aiConfig, prompt, size);
  });
  electron.ipcMain.handle(IPC.editImage, async (_event, sourcePath, prompt, size) => {
    const snapshot = await jsonStore.snapshot();
    return editProjectImage(snapshot.projectRoot, snapshot.aiConfig, sourcePath, prompt, size);
  });
  electron.ipcMain.handle(IPC.createBackup, async () => {
    const snapshot = await jsonStore.snapshot();
    return createProjectBackup(snapshot.projectRoot, snapshot.localSettings);
  });
  electron.ipcMain.handle(IPC.listBackups, async () => {
    const snapshot = await jsonStore.snapshot();
    return listProjectBackups(snapshot.projectRoot, snapshot.localSettings);
  });
  electron.ipcMain.handle(IPC.getAiConfig, () => jsonStore.snapshot().then((snapshot) => snapshot.aiConfig));
  electron.ipcMain.handle(IPC.saveAiConfig, async (_event, config) => {
    return jsonStore.setAiConfig(config);
  });
  electron.ipcMain.handle(IPC.listRemoteModels, async (_event, provider) => {
    return listRemoteProviderModels(provider);
  });
  electron.ipcMain.handle(IPC.getMcpConfig, () => jsonStore.snapshot().then((snapshot) => snapshot.mcpConfig));
  electron.ipcMain.handle(IPC.saveMcpConfig, async (_event, config) => {
    await jsonStore.setMcpConfig(config);
    await closeAllMcpClients();
    return config;
  });
  electron.ipcMain.handle(
    IPC.getLocalSettings,
    () => jsonStore.snapshot().then((snapshot) => snapshot.localSettings)
  );
  electron.ipcMain.handle(IPC.saveLocalSettings, async (_event, settings) => {
    await jsonStore.setLocalSettings(settings);
    void refreshBackupScheduler();
    return settings;
  });
  electron.ipcMain.handle(IPC.listMcpTools, async () => {
    const snapshot = await jsonStore.snapshot();
    return listMcpTools(snapshot.mcpConfig);
  });
  electron.ipcMain.handle(
    IPC.callMcpTool,
    async (_event, serverName, toolName, args) => {
      const snapshot = await jsonStore.snapshot();
      return callMcpTool(snapshot.mcpConfig, serverName, toolName, args);
    }
  );
  electron.ipcMain.handle(IPC.closeMcpClients, () => closeAllMcpClients());
  electron.ipcMain.handle(
    IPC.fetchUrlContent,
    (_event, url, timeoutMs) => fetchUrlContent(url, timeoutMs)
  );
  electron.ipcMain.handle(IPC.runCommand, async (_event, command, cwd) => {
    const snapshot = await jsonStore.snapshot();
    return runCommand(command, resolveCommandCwd(snapshot.projectRoot, cwd), snapshot.mcpConfig.commandEnv ?? {});
  });
}
let mainWindow = null;
function appIconPath() {
  return electron.app.isPackaged ? path.join(process.resourcesPath, "icon.ico") : path.join(__dirname, "../../resources/icon.ico");
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 2048,
    height: 1152,
    minWidth: 1100,
    minHeight: 720,
    title: "王阳",
    icon: appIconPath(),
    backgroundColor: "#f6f7f9",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void electron.shell.openExternal(url);
    return { action: "deny" };
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  mainWindow.maximize();
}
electron.app.whenReady().then(() => {
  registerIpcHandlers();
  void refreshBackupScheduler();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  stopBackupScheduler();
  if (process.platform !== "darwin") electron.app.quit();
});
