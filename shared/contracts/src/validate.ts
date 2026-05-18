import { ContractRegistry, type ExtensionContract } from './registry.js';
import { EXTENSION_NAMES, type ExtensionName } from './extensions.js';

let _registry: ContractRegistry | null = null;

function registry(): ContractRegistry {
  if (!_registry) _registry = new ContractRegistry();
  return _registry;
}

export function loadAllSchemas(): ExtensionContract[] {
  return registry().all();
}

export function validateResponse(
  name: ExtensionName,
  data: unknown,
): { valid: boolean; errors: string[] } {
  return registry().validateResponse(name, data);
}

export function validateRequest(
  name: ExtensionName,
  data: unknown,
): { valid: boolean; errors: string[] } {
  return registry().validateRequest(name, data);
}

export { EXTENSION_NAMES, type ExtensionName };
