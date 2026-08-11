/**
 * Public JSON Schema 2020-12 generation for qualification report v1.
 * Shared model (constants/helpers) lives in evidence-model.ts;
 * runtime validation in evidence-contract.ts.
 */
import {
  ARRAY_MAX_64,
  ARRAY_MAX_256,
  ARTIFACT_KEYS,
  ARTIFACT_MAX_BYTES,
  ARTIFACT_ROLES,
  DECISIONS,
  DOMAIN_ID_MAX,
  DURATION_MAX_SECONDS,
  ENVIRONMENT_ID_RE,
  EVIDENCE_LEVELS,
  FIXTURE_CORPUS_ID_RE,
  GATES,
  GATE_EVIDENCE_LEVELS,
  GIT_SHA_RE,
  IDENTITY_KEYS,
  IMAGE_DIGEST_RE,
  MAP_MAX_32,
  MAP_MAX_64,
  MEDIA_TYPE_MAX_LENGTH,
  MEDIA_TYPE_RE,
  PACKAGE_NAME_RE,
  PATH_MAX_LENGTH,
  PATH_RELATIVE_PATTERN,
  PLATFORMS,
  REPORT_ID,
  SAFE_NUMBER_MAX,
  SAFE_NUMBER_MIN,
  SAMPLE_COUNT_MAX,
  SCHEMA_VERSION,
  SHA256_RE,
  SUPPORT_ROWS,
  TEXT_1,
  TEXT_64,
  TEXT_128,
  TEXT_256,
  TEXT_1024,
  TEXT_4096,
  WARMUP_COUNT_MAX,
  stableJsonPretty,
} from "./evidence-model.ts";

function stringBounds(min: number, max: number) {
  return { type: "string", minLength: min, maxLength: max };
}

/** Closed scalar used by budgets, queues, and resources. */
export function scalarValueSchema(): Record<string, unknown> {
  return {
    anyOf: [
      { type: "string", minLength: TEXT_1, maxLength: TEXT_256 },
      {
        type: "number",
        minimum: SAFE_NUMBER_MIN,
        maximum: SAFE_NUMBER_MAX,
      },
      { type: "boolean" },
    ],
  };
}

function gateEvidenceAllOf(): Array<Record<string, unknown>> {
  return (Object.keys(GATE_EVIDENCE_LEVELS) as Array<keyof typeof GATE_EVIDENCE_LEVELS>).map(
    (gate) => ({
      if: {
        properties: { gate: { const: gate } },
        required: ["gate"],
      },
      then: {
        properties: {
          evidence_level: { enum: [...GATE_EVIDENCE_LEVELS[gate]] },
        },
      },
    }),
  );
}

/** Build the public JSON Schema 2020-12 document from contract constants. */
export function buildQualificationReportSchema(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://moonspan.dev/schemas/qualification-report-v1.json",
    title: "Moonspan qualification report v1",
    description:
      "Closed machine-readable qualification evidence contract for Moonspan gates. Generated from scripts/evidence-schema.ts using constants in evidence-contract.ts; the Bun checker enforces the same constants plus ordering, calendar, filesystem, and integrity checks.",
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "report_id",
      "gate",
      "evidence_level",
      "identity",
      "invocation",
      "artifacts",
      "measurements",
      "review",
    ],
    properties: {
      schema_version: { type: "integer", const: SCHEMA_VERSION },
      report_id: { type: "string", const: REPORT_ID },
      gate: { type: "string", enum: [...GATES] },
      evidence_level: { type: "string", enum: [...EVIDENCE_LEVELS] },
      identity: {
        type: "object",
        additionalProperties: false,
        required: [...IDENTITY_KEYS],
        properties: {
          code_revision: { type: "string", pattern: GIT_SHA_RE.source },
          fixture_manifests: {
            type: "object",
            minProperties: 1,
            maxProperties: MAP_MAX_32,
            propertyNames: {
              type: "string",
              minLength: 1,
              maxLength: TEXT_64,
              pattern: FIXTURE_CORPUS_ID_RE.source,
            },
            additionalProperties: {
              type: "string",
              pattern: SHA256_RE.source,
            },
          },
          package_versions: {
            type: "object",
            minProperties: 1,
            maxProperties: MAP_MAX_64,
            propertyNames: {
              type: "string",
              minLength: 1,
              maxLength: TEXT_128,
              pattern: PACKAGE_NAME_RE.source,
            },
            additionalProperties: stringBounds(TEXT_1, TEXT_256),
          },
          image_digests: {
            type: "object",
            minProperties: 0,
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_128),
            additionalProperties: {
              type: "string",
              pattern: IMAGE_DIGEST_RE.source,
            },
          },
          environment: {
            type: "object",
            additionalProperties: false,
            required: ["environment_id", "platform", "toolchain"],
            properties: {
              environment_id: {
                type: "string",
                pattern: ENVIRONMENT_ID_RE.source,
              },
              platform: { type: "string", enum: [...PLATFORMS] },
              toolchain: {
                type: "object",
                minProperties: 1,
                maxProperties: 16,
                propertyNames: stringBounds(TEXT_1, TEXT_64),
                additionalProperties: stringBounds(TEXT_1, TEXT_128),
              },
              attributes: {
                type: "object",
                minProperties: 0,
                maxProperties: MAP_MAX_32,
                propertyNames: stringBounds(TEXT_1, TEXT_64),
                additionalProperties: stringBounds(TEXT_1, TEXT_256),
              },
            },
          },
        },
      },
      provenance: {
        type: "object",
        additionalProperties: false,
        properties: {
          support_row_id: { type: "string", enum: [...SUPPORT_ROWS] },
          gateway_instance_id: stringBounds(TEXT_1, TEXT_128),
          domain_ids: {
            type: "array",
            minItems: 1,
            maxItems: ARRAY_MAX_64,
            uniqueItems: true,
            items: { type: "integer", minimum: 0, maximum: DOMAIN_ID_MAX },
          },
          adapter_profile: stringBounds(TEXT_1, TEXT_128),
        },
      },
      invocation: {
        type: "object",
        additionalProperties: false,
        required: [
          "commands",
          "workload",
          "budgets",
          "duration_seconds",
          "sample_count",
          "warmup_count",
        ],
        properties: {
          commands: {
            type: "array",
            minItems: 1,
            maxItems: ARRAY_MAX_64,
            items: stringBounds(TEXT_1, TEXT_1024),
          },
          workload: stringBounds(TEXT_1, TEXT_4096),
          budgets: {
            type: "object",
            minProperties: 1,
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_64),
            additionalProperties: scalarValueSchema(),
          },
          duration_seconds: {
            type: "number",
            minimum: 0,
            maximum: DURATION_MAX_SECONDS,
          },
          sample_count: {
            type: "integer",
            minimum: 0,
            maximum: SAMPLE_COUNT_MAX,
          },
          warmup_count: {
            type: "integer",
            minimum: 0,
            maximum: WARMUP_COUNT_MAX,
          },
          variance: stringBounds(TEXT_1, TEXT_1024),
        },
      },
      artifacts: {
        type: "array",
        minItems: 1,
        maxItems: ARRAY_MAX_64,
        items: {
          type: "object",
          additionalProperties: false,
          required: [...ARTIFACT_KEYS],
          properties: {
            role: { type: "string", enum: [...ARTIFACT_ROLES] },
            path: {
              type: "string",
              minLength: TEXT_1,
              maxLength: PATH_MAX_LENGTH,
              pattern: PATH_RELATIVE_PATTERN,
            },
            sha256: { type: "string", pattern: SHA256_RE.source },
            byte_length: {
              type: "integer",
              minimum: 0,
              maximum: ARTIFACT_MAX_BYTES,
            },
            media_type: {
              type: "string",
              minLength: 3,
              maxLength: MEDIA_TYPE_MAX_LENGTH,
              pattern: MEDIA_TYPE_RE.source,
            },
            retention_policy: stringBounds(TEXT_1, TEXT_128),
          },
        },
      },
      measurements: {
        type: "object",
        additionalProperties: false,
        required: ["errors", "dispositions"],
        properties: {
          timestamps: {
            type: "object",
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_64),
            additionalProperties: stringBounds(TEXT_1, TEXT_64),
          },
          queues: {
            type: "object",
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_64),
            additionalProperties: scalarValueSchema(),
          },
          resources: {
            type: "object",
            maxProperties: MAP_MAX_32,
            propertyNames: stringBounds(TEXT_1, TEXT_64),
            additionalProperties: scalarValueSchema(),
          },
          errors: {
            type: "array",
            maxItems: ARRAY_MAX_256,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["code", "message"],
              properties: {
                code: stringBounds(TEXT_1, TEXT_64),
                message: stringBounds(TEXT_1, TEXT_1024),
              },
            },
          },
          dispositions: {
            type: "array",
            maxItems: ARRAY_MAX_256,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "count"],
              properties: {
                name: stringBounds(TEXT_1, TEXT_64),
                count: {
                  type: "integer",
                  minimum: 0,
                  maximum: SAMPLE_COUNT_MAX,
                },
              },
            },
          },
        },
      },
      review: {
        type: "object",
        additionalProperties: false,
        required: ["decision", "known_limits"],
        properties: {
          decision: { type: "string", enum: [...DECISIONS] },
          reviewer: stringBounds(TEXT_1, TEXT_128),
          decision_date: {
            type: "string",
            pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
            format: "date",
          },
          known_limits: {
            type: "array",
            maxItems: ARRAY_MAX_64,
            items: stringBounds(TEXT_1, TEXT_1024),
          },
        },
        allOf: [
          {
            if: {
              properties: { decision: { const: "pending" } },
              required: ["decision"],
            },
            then: {
              not: {
                anyOf: [{ required: ["reviewer"] }, { required: ["decision_date"] }],
              },
            },
            else: {
              required: ["reviewer", "decision_date"],
            },
          },
        ],
      },
    },
    allOf: [
      ...gateEvidenceAllOf(),
      {
        if: {
          properties: {
            evidence_level: { enum: ["N1", "N2"] },
          },
          required: ["evidence_level"],
        },
        then: {
          required: ["provenance"],
          properties: {
            provenance: {
              type: "object",
              required: ["support_row_id"],
            },
          },
        },
      },
    ],
  };
}

export function schemaCanonicalBytes(): string {
  return stableJsonPretty(buildQualificationReportSchema());
}
