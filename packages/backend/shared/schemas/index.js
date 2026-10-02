// Reusable JSON Schema fragments for Fastify route bodies / params / queries.
//
// Fastify validates request shape against `schema` BEFORE any handler runs;
// invalid payloads get rejected with a structured 400. Routes can drop the
// hand-rolled `if (!body.foo)` checks once the schema covers them.
//
// All object schemas default `additionalProperties: false` so unrecognized
// fields are rejected — protects against typo'd field names silently being
// dropped, and discourages accidental field-shape drift.

/** Hex 0x-prefixed 20-byte EVM address. */
export const addressSchema = {
  type: "string",
  pattern: "^0x[a-fA-F0-9]{40}$",
};

/** 65-byte ECDSA signature in hex (0x + 130 chars). */
export const signatureSchema = {
  type: "string",
  pattern: "^0x[a-fA-F0-9]{130}$",
};

/** Unix-seconds timestamp expressed as a positive integer. */
export const unixSecondsSchema = {
  type: "integer",
  minimum: 0,
};

/** `{wallet}` body shape used by allowlist mutations (/add, /remove). */
export const walletBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    wallet: addressSchema,
  },
  required: ["wallet"],
};

/** Body shape for POST /api/access/set-access-level. */
export const setAccessLevelBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    wallet: addressSchema,
    accessLevel: { type: "integer", minimum: 0, maximum: 4 },
  },
  required: ["wallet", "accessLevel"],
};

/**
 * One row in the bulk-signature upload accepted by
 * POST /api/gating/signatures/:seasonId.
 */
export const gatingSignatureRowSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    address: addressSchema,
    deadline: unixSecondsSchema,
    signature: signatureSchema,
    gateIndex: { type: "integer", minimum: 0 },
  },
  required: ["address", "deadline", "signature"],
};

/** Body shape for POST /api/gating/signatures/:seasonId. */
export const gatingSignaturesBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    signatures: {
      type: "array",
      minItems: 1,
      maxItems: 200,
      items: gatingSignatureRowSchema,
    },
  },
  required: ["signatures"],
};

/** Body shape for POST /api/admin/create-market. */
export const createMarketBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    seasonId: { type: "integer", minimum: 1 },
    playerAddress: addressSchema,
  },
  required: ["seasonId", "playerAddress"],
};

/**
 * `:seasonId` path-param schema. Coerces the URL string to integer at the
 * boundary so handlers can rely on `request.params.seasonId` being a number.
 */
export const seasonIdParamsSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    seasonId: { type: "integer", minimum: 1 },
  },
  required: ["seasonId"],
};
