import validateDiscovery from './generated/discovery-validator.js';
import { discoverySchemaKey } from './generated/discovery-schema-key.js';
import { schemaKey } from './schema-key.js';

// Bundler replacement for x402's Ajv import. The generated validator retains
// Ajv's allErrors behavior and error records without a runtime Function call.
export default class StaticAjv {
  constructor(options) {
    if (options?.strict !== false || options?.allErrors !== true) throw new Error('unsupported_static_validator_options');
  }
  compile(schema) {
    if (schemaKey(schema) !== discoverySchemaKey) throw new Error('schema_not_precompiled');
    return validateDiscovery;
  }
}
