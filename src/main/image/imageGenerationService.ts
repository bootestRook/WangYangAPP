import OpenAI, { toFile } from 'openai'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildDefaultHeaders, resolveModel, type ResolvedModel } from '../../core/models/resolveModel'
import type { AiConfig, ImageGenerationResult } from '../../shared/types'

function ensureRoot(root: string): string {
  if (!root.trim()) throw new Error('项目根目录未配置。')
  return path.resolve(root)
}

function resolveInsideRoot(root: string, relativePath: string): string {
  const resolvedRoot = ensureRoot(root)
  const normalized = relativePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  const target = path.resolve(resolvedRoot, normalized)
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`
  if (target !== resolvedRoot && !target.startsWith(rootWithSep)) {
    throw new Error(`路径超出项目根目录：${relativePath}。项目根目录：${resolvedRoot}，解析目标：${target}`)
  }
  return target
}

function safeName(input: string): string {
  return (
    input
      .trim()
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, '-')
      .slice(0, 36) || 'generated-image'
  )
}

function imageMimeType(relativePath: string): string {
  const ext = path.extname(relativePath).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  return 'image/png'
}

function assertSupportedImagePath(relativePath: string): void {
  const ext = path.extname(relativePath).toLowerCase()
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    throw new Error(`图片编辑源文件必须是项目内 PNG、JPG、JPEG 或 WebP 图片：${relativePath || '未提供路径'}（当前扩展名：${ext || '无'}）`)
  }
}

function assertOpenAiCompatibleImageModel(model: ResolvedModel, feature: string): void {
  if (model.requestFormat !== 'openai') {
    throw new Error(
      `${feature} 需要 OpenAI-compatible Images API 接口。当前模型 ${model.modelId} 所属接口 ${model.interfaceId} 的请求格式是 ${model.requestFormat}。`
    )
  }
}

async function imageBufferFromUrl(url: string): Promise<Buffer> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`图片 URL 下载失败：${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

export async function generateProjectImage(
  root: string,
  aiConfig: AiConfig,
  prompt: string,
  size = '1024x1024'
): Promise<ImageGenerationResult> {
  const cleanPrompt = prompt.trim()
  if (!cleanPrompt) throw new Error('图片提示词不能为空。')

  const resolvedRoot = ensureRoot(root)
  const model = resolveModel(aiConfig, aiConfig.scenario.image)
  if (!model.interfaceConfig.apiKey.trim()) {
    throw new Error('图片生成需要先在模型配置中为图片模型接口填写 API key。')
  }
  assertOpenAiCompatibleImageModel(model, '图片生成')

  const client = new OpenAI({
    apiKey: model.interfaceConfig.apiKey,
    baseURL: model.interfaceConfig.apiUrl,
    defaultHeaders: buildDefaultHeaders(model)
  })

  const result = await client.images.generate({
    model: model.modelName,
    prompt: cleanPrompt,
    size: size as '1024x1024',
    n: 1,
    response_format: 'b64_json'
  })

  const first = result.data?.[0]
  if (!first) throw new Error('图片生成接口没有返回图片。')
  const buffer = first.b64_json
    ? Buffer.from(first.b64_json, 'base64')
    : first.url
      ? await imageBufferFromUrl(first.url)
      : undefined
  if (!buffer) throw new Error('图片生成接口返回了不支持的结果格式。')

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const baseName = `${stamp}-${safeName(cleanPrompt)}`
  const relativePath = `assets/generated/${baseName}.png`
  const manifestPath = `assets/generated/${baseName}.md`
  const imagePath = path.join(resolvedRoot, relativePath)
  const manifestFullPath = path.join(resolvedRoot, manifestPath)
  await mkdir(path.dirname(imagePath), { recursive: true })
  await writeFile(imagePath, buffer)
  await writeFile(
    manifestFullPath,
    `# 图片资产\n\n创建时间：${new Date().toLocaleString('zh-CN')}\n\n## 文件\n\n${relativePath}\n\n## 模型\n\n${model.modelName}\n\n## 尺寸\n\n${size}\n\n## 提示词\n\n${cleanPrompt}\n`,
    'utf8'
  )

  return {
    relativePath,
    manifestPath,
    prompt: cleanPrompt,
    model: model.modelName,
    size,
    operation: 'generate',
    createdAt: Date.now()
  }
}

export async function editProjectImage(
  root: string,
  aiConfig: AiConfig,
  sourcePath: string,
  prompt: string,
  size = '1024x1024'
): Promise<ImageGenerationResult> {
  const cleanPrompt = prompt.trim()
  const cleanSourcePath = sourcePath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  if (!cleanSourcePath) throw new Error('源图片路径不能为空。')
  if (!cleanPrompt) throw new Error('图片编辑提示词不能为空。')
  assertSupportedImagePath(cleanSourcePath)

  const resolvedRoot = ensureRoot(root)
  const sourceFullPath = resolveInsideRoot(resolvedRoot, cleanSourcePath)
  const sourceBuffer = await readFile(sourceFullPath)
  const model = resolveModel(aiConfig, aiConfig.scenario.imageEdit)
  if (!model.interfaceConfig.apiKey.trim()) {
    throw new Error('图片编辑需要先在模型配置中为图片编辑模型接口填写 API Key。')
  }
  assertOpenAiCompatibleImageModel(model, '图片编辑')

  const client = new OpenAI({
    apiKey: model.interfaceConfig.apiKey,
    baseURL: model.interfaceConfig.apiUrl,
    defaultHeaders: buildDefaultHeaders(model)
  })

  const imageFile = await toFile(sourceBuffer, path.basename(cleanSourcePath), {
    type: imageMimeType(cleanSourcePath)
  })
  const result = await client.images.edit({
    model: model.modelName,
    image: imageFile,
    prompt: cleanPrompt,
    size: size as '1024x1024',
    n: 1,
    response_format: 'b64_json'
  } as any)

  const first = result.data?.[0]
  if (!first) throw new Error('图片编辑接口没有返回图片。')
  const buffer = first.b64_json
    ? Buffer.from(first.b64_json, 'base64')
    : first.url
      ? await imageBufferFromUrl(first.url)
      : undefined
  if (!buffer) throw new Error('图片编辑接口返回了不支持的结果格式。')

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
  const baseName = `${stamp}-edit-${safeName(cleanPrompt)}`
  const relativePath = `assets/generated/${baseName}.png`
  const manifestPath = `assets/generated/${baseName}.md`
  const imagePath = path.join(resolvedRoot, relativePath)
  const manifestFullPath = path.join(resolvedRoot, manifestPath)
  await mkdir(path.dirname(imagePath), { recursive: true })
  await writeFile(imagePath, buffer)
  await writeFile(
    manifestFullPath,
    `# 图片编辑资产\n\n创建时间：${new Date().toLocaleString('zh-CN')}\n\n## 文件\n\n${relativePath}\n\n## 源图片\n\n${cleanSourcePath}\n\n## 模型\n\n${model.modelName}\n\n## 尺寸\n\n${size}\n\n## 提示词\n\n${cleanPrompt}\n`,
    'utf8'
  )

  return {
    relativePath,
    manifestPath,
    prompt: cleanPrompt,
    model: model.modelName,
    size,
    operation: 'edit',
    sourcePath: cleanSourcePath,
    createdAt: Date.now()
  }
}
