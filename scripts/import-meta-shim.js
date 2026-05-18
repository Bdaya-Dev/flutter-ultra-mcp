// Shim injected by esbuild to replace import.meta.url in CJS output.
// When esbuild injects this, it hoists the exported binding into every chunk
// that references the defined symbol.
import { pathToFileURL } from 'node:url';
export const __importMetaUrl = pathToFileURL(__filename).href;
