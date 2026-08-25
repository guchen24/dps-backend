import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const root = process.cwd()
const scopeDir = join(root, 'node_modules', '@deepseek-ai')
const candidates = []

function visit(directory, depth) {
  if (depth > 3) return
  const manifest = join(directory, 'package.json')
  if (existsSync(manifest)) candidates.push(directory)
  if (depth === 3) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name.startsWith('.')) continue
    visit(join(directory, entry.name), depth + 1)
  }
}

for (const base of ['apps', 'packages', 'vendor']) visit(join(root, base), 0)

for (const directory of candidates) {
  const { name } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
  if (typeof name !== 'string' || !name.startsWith('@deepseek-ai/')) continue
  const destination = join(scopeDir, name.slice('@deepseek-ai/'.length))
  if (existsSync(destination) || (() => { try { return lstatSync(destination).isSymbolicLink() } catch { return false } })()) continue
  mkdirSync(dirname(destination), { recursive: true })
  symlinkSync(relative(dirname(destination), directory), destination, 'dir')
}
