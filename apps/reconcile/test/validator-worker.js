import StandaloneAjv2020 from "../src/ajv2020-standalone.js";

// Separate test Worker; this entry point is never included in production.
export default {
  async fetch(request) {
    let codeGenerationBlocked = false;
    try { new Function("return true")(); } catch (error) {
      codeGenerationBlocked = error instanceof EvalError;
    }
    const { schema, info } = await request.json();
    try {
      const validate = new StandaloneAjv2020({ strict: false, allErrors: true }).compile(schema);
      return Response.json({ codeGenerationBlocked, valid: validate(info), errors: validate.errors });
    } catch (error) {
      return Response.json({ codeGenerationBlocked, error: error.message }, { status: 400 });
    }
  }
};
