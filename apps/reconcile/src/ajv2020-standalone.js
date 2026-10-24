import { validators } from "./generated/bazaar-validators.js";
import { schemaKey } from "./schema-key.js";

// Wrangler aliases only Ajv's 2020 entry point in this Worker. The SDK still
// validates discovery with the same Ajv-generated functions and error objects,
// but compile() performs a lookup rather than code generation during requests.
export default class StandaloneAjv2020 {
  constructor(options) {
    if (options?.strict !== false || options?.allErrors !== true || Object.keys(options).length !== 2) {
      throw new Error("Unsupported Ajv options: regenerate the standalone Bazaar validators");
    }
  }

  compile(schema) {
    const validate = validators.get(schemaKey(schema));
    if (!validate) throw new Error("Unknown Bazaar schema: regenerate the standalone validators");
    return validate;
  }
}
