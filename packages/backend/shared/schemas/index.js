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

/** Farcaster ID. Positive integer. */
export const fidSchema = {
  type: "integer",
  minimum: 1,
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

/**
 * `{fid?, wallet?}` shape used by allowlist/access mutations. Requires
 * at least one identifier. The route handlers still resolve the priority
 * (fid wins over wallet) — this only enforces presence at the boundary.
 */
export const fidOrWalletSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fid: fidSchema,
    wallet: addressSchema,
  },
  anyOf: [{ required: ["fid"] }, { required: ["wallet"] }],
};

/** Body shape for POST /api/access/set-access-level. */
export const setAccessLevelBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fid: fidSchema,
    wallet: addressSchema,
    accessLevel: { type: "integer", minimum: 0, maximum: 4 },
  },
  required: ["accessLevel"],
  anyOf: [{ required: ["fid"] }, { required: ["wallet"] }],
};

/**
 * Body shape for POST /api/airdrop/claim. Three discriminated variants by
 * `type`: initial requires fid, basic + daily each require signature.
 */
export const claimAirdropBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    address: addressSchema,
    type: { type: "string", enum: ["initial", "basic", "daily"] },
    fid: fidSchema,
    signature: signatureSchema,
  },
  required: ["address", "type"],
  oneOf: [
    {
      properties: { type: { const: "initial" } },
      required: ["fid"],
    },
    {
      properties: { type: { const: "basic" } },
      required: ["signature"],
    },
    {
      properties: { type: { const: "daily" } },
      required: ["signature"],
    },
  ],
};

/** Body shape for POST /api/wallet/delegate. */
export const delegateBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    userAddress: addressSchema,
    // EIP-7702 authorization tuple. Frontend serializes a viem
    // `signAuthorization` result; downstream code re-parses, so a
    // permissive shape is acceptable here.
    authorization: { type: "object" },
  },
  required: ["userAddress", "authorization"],
};

/** Body shape for POST /api/wallet/delegate-shortcut (LOCAL only). */
export const delegateShortcutBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    userAddress: addressSchema,
  },
  required: ["userAddress"],
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
 * Body shape for POST /api/admin/send-notification. fid is optional —
 * when present, the broadcast targets that single user; when absent, the
 * notification fans out to every subscribed user.
 */
export const sendNotificationBodySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    fid: fidSchema,
    title: { type: "string", minLength: 1, maxLength: 200 },
    body: { type: "string", minLength: 1, maxLength: 2000 },
    targetUrl: { type: "string", format: "uri" },
  },
  required: ["title", "body"],
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
