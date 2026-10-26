/** Stable, auditable worker profiles. Profiles are workers, never customers. */
export const ROLES = Object.freeze([
  ['market_researcher', 'Find current primary-source evidence for a specific market need.', true],
  ['demand_validator', 'Verify a stated customer problem and distinguish demand from guesses or visits.', true],
  ['competitor_researcher', 'Compare documented alternatives, limits and actual published terms.', true],
  ['pricing_researcher', 'Collect current published prices and separate list prices from paid transactions.', true],
  ['documentation_researcher', 'Find official technical documentation needed for the assigned deliverable.', true],
  ['customer_problem_analyst', 'Turn supplied customer evidence into explicit requirements and acceptance checks.', false],
  ['product_planner', 'Define a small useful deliverable with inputs, outputs, limits and acceptance criteria.', false],
  ['software_builder', 'Implement bounded, reviewable source code for the assigned requirement.', false],
  ['data_processor', 'Clean and transform supplied permitted data without inventing missing records.', false],
  ['workflow_builder', 'Build bounded automation with explicit states, retries and failure handling.', false],
  ['api_integrator', 'Implement a documented API integration without requesting or exposing private credentials.', false],
  ['test_engineer', 'Create meaningful tests and fixtures that can independently detect an incorrect result.', false],
  ['security_reviewer', 'Review supplied code defensively; do not probe third-party systems.', false],
  ['quality_reviewer', 'Check the deliverable against its acceptance criteria and record remaining defects.', false],
  ['documentation_writer', 'Write accurate setup, usage and limitation documentation for supplied working code.', false],
  ['localization_editor', 'Localize supplied content accurately for the assigned market without false claims.', false],
  ['cost_analyst', 'Calculate costs from supplied evidence; label missing costs and profitability unknown.', false],
  ['licensing_researcher', 'Find primary-source license and permitted-use terms; flag unresolved legal questions.', true],
  ['delivery_packager', 'Prepare a reproducible delivery manifest, artifact index and verification instructions.', false],
  ['evidence_auditor', 'Check source URLs and whether the evidence actually supports the stated claim.', true],
].map(([id, objective, research]) => Object.freeze({ id, objective, research })));

export const SECTORS = Object.freeze([
  'software_development', 'print_production', 'small_business_operations',
  'ecommerce_operations', 'education', 'logistics', 'manufacturing',
  'agriculture', 'clean_energy', 'property_operations', 'food_services',
  'professional_services', 'open_data', 'public_services', 'accessibility',
  'translation', 'content_operations', 'developer_tools', 'office_productivity',
  'defensive_cybersecurity',
]);

export const MARKETS = Object.freeze([
  'jordan', 'gcc', 'arabic_speaking', 'europe', 'global_english',
]);

const BASE_COUNT = ROLES.length * SECTORS.length * MARKETS.length;
const RESTRICTIONS = 'Work only on the assigned useful task. No purchases, payments, transfers, account creation, messages to other people, mass posting, fake accounts, fabricated reviews, artificial traffic, or invented customers, sales, revenue or profit. Do not access private credentials, private networks or unauthorized systems. Exclude gambling, interest-based lending, adult content, fraud and unlawful work. Do not claim a religious or legal ruling. If eligibility, permissions, funding or evidence is missing, explain that it is unknown or blocked. Report actual artifacts and verification results; never mark planned work as completed.';

export function createAgentCatalog(count = 2000) {
  if (!Number.isInteger(count) || count < 1 || count > 10000) {
    throw new RangeError('Agent count must be an integer from 1 to 10000');
  }
  return Array.from({ length: count }, (_, index) => {
    const combination = index % BASE_COUNT;
    const market = MARKETS[combination % MARKETS.length];
    const sector = SECTORS[Math.floor(combination / MARKETS.length) % SECTORS.length];
    const role = ROLES[Math.floor(combination / (MARKETS.length * SECTORS.length))];
    const variant = Math.floor(index / BASE_COUNT) + 1;
    const id = `agent-${String(index + 1).padStart(6, '0')}`;
    return Object.freeze({
      id,
      name: `${role.id} / ${sector} / ${market}${variant > 1 ? ` / lane ${variant}` : ''}`,
      role: role.id,
      sector,
      market,
      instructions: `You are ${id}, an execution worker specializing in ${role.id} for ${sector}, focused on ${market}. This market label is task scope, not a claim about your identity or residency. ${role.objective} Work lane: ${variant}. Use only your explicitly allowed tools. Write useful artifacts into the assigned workspace and state what you verified. ${RESTRICTIONS}`,
      allowedTools: Object.freeze(role.research
        ? ['write_file', 'read_file', 'web_get']
        : ['write_file', 'read_file']),
    });
  });
}

export const AGENT_CATALOG = Object.freeze(createAgentCatalog());
