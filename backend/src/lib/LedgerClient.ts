/**
 * Fission LedgerClient
 * --------------------
 * Thin wrapper around the Canton JSON Ledger API V2.
 *
 * Endpoints used:
 *   POST /v2/commands/submit-and-wait    - submit a transaction
 *   POST /v2/state/active-contracts      - query the active contract set
 *   POST /v2/parties                     - allocate a party
 *   POST /v2/packages                    - upload a DAR (admin only)
 *
 * Auth: every request carries a JWT bearer token. The token's `sub` claim must include
 * the parties the caller is acting as. We delegate token acquisition to the caller via
 * a tokenProvider callback; the backend uses Keycloak client_credentials flow.
 */

export interface LedgerClientConfig {
  baseUrl: string;
  tokenProvider: () => Promise<string>;
  userId?: string;
}

export interface ContractEntry<T = unknown> {
  contractId: string;
  templateId: string;
  payload: T;
}

export interface SubmitArgs {
  templateId: string;
  contractId: string;
  choice: string;
  argument: unknown;
  actAs: string[];
  readAs?: string[];
  commandId?: string;
}

export interface CreateArgs {
  templateId: string;
  argument: unknown;
  actAs: string[];
  commandId?: string;
}

export class LedgerClient {
  private readonly baseUrl: string;
  private readonly tokenProvider: () => Promise<string>;
  private readonly userId: string;

  constructor(config: LedgerClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.tokenProvider = config.tokenProvider;
    this.userId = config.userId ?? 'fission-app';
  }

  private async authHeaders(): Promise<HeadersInit> {
    const token = await this.tokenProvider();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  private genCommandId(): string {
    return `fission-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  private async submitForTransaction(jsCommands: Record<string, unknown>): Promise<{
    events: Array<{ created?: { contractId: string; templateId: string } }>;
    updateId: string;
  }> {
    const body = { commands: jsCommands };
    const res = await fetch(`${this.baseUrl}/v2/commands/submit-and-wait-for-transaction`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `submit-and-wait-for-transaction failed: ${res.status} ${res.statusText} - ${await res.text()}`,
      );
    }
    const data = (await res.json()) as {
      transaction: {
        updateId: string;
        events: Array<{
          CreatedEvent?: { contractId: string; templateId: string };
          ExercisedEvent?: { contractId: string; templateId: string };
        }>;
      };
    };
    return {
      updateId: data.transaction.updateId,
      events: data.transaction.events.map((ev) => {
        if (ev.CreatedEvent) {
          return { created: { contractId: ev.CreatedEvent.contractId, templateId: ev.CreatedEvent.templateId } };
        }
        return {};
      }),
    };
  }

  /**
   * Submit a single ExerciseCommand and wait for completion.
   */
  async exerciseChoice(args: SubmitArgs): Promise<unknown> {
    return this.submitForTransaction({
      commands: [
        {
          ExerciseCommand: {
            templateId: args.templateId,
            contractId: args.contractId,
            choice: args.choice,
            choiceArgument: args.argument,
          },
        },
      ],
      userId: this.userId,
      commandId: args.commandId ?? this.genCommandId(),
      actAs: args.actAs,
      readAs: args.readAs ?? args.actAs,
    });
  }

  /**
   * Submit a CreateCommand and wait for completion.
   */
  async createContract(args: CreateArgs): Promise<unknown> {
    return this.submitForTransaction({
      commands: [
        {
          CreateCommand: {
            templateId: args.templateId,
            createArguments: args.argument,
          },
        },
      ],
      userId: this.userId,
      commandId: args.commandId ?? this.genCommandId(),
      actAs: args.actAs,
      readAs: args.actAs,
    });
  }

  /**
   * Query the active contract set for a given template, filtered by party visibility.
   *
   * Uses POST /v2/state/active-contracts with a TransactionFilter where each party
   * gets a Filters object listing the templates of interest. We always pass
   * verbose=false and use the latest available offset.
   */
  async queryActiveContracts<T = unknown>(
    templateId: string,
    parties: string[],
  ): Promise<ContractEntry<T>[]> {
    // Get the current ledger end first so we have a valid offset.
    const offsetRes = await fetch(`${this.baseUrl}/v2/state/ledger-end`, {
      headers: await this.authHeaders(),
    });
    const offsetData = offsetRes.ok ? ((await offsetRes.json()) as { offset?: number }) : {};

    const body = {
      filter: {
        filtersByParty: Object.fromEntries(
          parties.map((p) => [
            p,
            {
              cumulative: [
                {
                  identifierFilter: {
                    TemplateFilter: {
                      value: { templateId, includeCreatedEventBlob: false },
                    },
                  },
                },
              ],
            },
          ]),
        ),
      },
      verbose: false,
      activeAtOffset: offsetData.offset ?? 0,
    };

    const res = await fetch(`${this.baseUrl}/v2/state/active-contracts`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`active-contracts query failed: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as Array<{
      contractEntry?: {
        JsActiveContract?: {
          createdEvent: {
            contractId: string;
            templateId: string;
            createArgument: T;
          };
        };
      };
    }>;

    return data
      .map((row) => row.contractEntry?.JsActiveContract?.createdEvent)
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
      .map((e) => ({
        contractId: e.contractId,
        templateId: e.templateId,
        payload: e.createArgument,
      }));
  }

  /**
   * Query a single contract by its key. Returns null if not found.
   *
   * Note: the JSON Ledger API V2 doesn't expose a direct "fetch by key" endpoint,
   * so we query the active contract set for the template and look up the key
   * client-side. The Daml Finance pattern is to use distinct keys per template
   * which keeps the active set small enough that this is fast.
   */
  async queryContractByKey<T = unknown>(
    templateId: string,
    key: unknown,
    parties?: string[],
  ): Promise<ContractEntry<T> | null> {
    const lookupParties = parties ?? [];
    const all = await this.queryActiveContracts<T & { [k: string]: unknown }>(
      templateId,
      lookupParties,
    );
    const match = all.find((c) => keysEqual((c.payload as Record<string, unknown>), key));
    return match
      ? { contractId: match.contractId, templateId: match.templateId, payload: match.payload as T }
      : null;
  }

  /**
   * Allocate a new party on the participant. Used during onboarding.
   */
  async allocateParty(partyHint: string, displayName?: string): Promise<{ party: string }> {
    const body = {
      partyIdHint: partyHint,
      displayName: displayName ?? partyHint,
      identityProviderId: '',
    };
    const res = await fetch(`${this.baseUrl}/v2/parties`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`party allocation failed: ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as { partyDetails: { party: string } };
    return { party: data.partyDetails.party };
  }

  /**
   * Health check.
   */
  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/livez`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Look up a contract by its contract ID. Returns the create event payload.
   * Uses /v2/events/events-by-contract-id (JSON Ledger API V2).
   */
  async eventsByContractId<T = unknown>(req: {
    contractId: string;
    requestingParties?: string[];
  }): Promise<{ created?: { createArgument: T; templateId: string } } | null> {
    const body = {
      contractId: req.contractId,
      requestingParties: req.requestingParties ?? [],
      eventFormat: {
        filtersByParty: Object.fromEntries(
          (req.requestingParties ?? []).map((p) => [
            p,
            { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] },
          ]),
        ),
        verbose: false,
      },
    };

    const res = await fetch(`${this.baseUrl}/v2/events/events-by-contract-id`, {
      method: 'POST',
      headers: await this.authHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      created?: {
        createdEvent: {
          contractId: string;
          templateId: string;
          createArgument: T;
        };
      };
    };

    if (!data.created) return null;
    return {
      created: {
        createArgument: data.created.createdEvent.createArgument,
        templateId: data.created.createdEvent.templateId,
      },
    };
  }
}

/**
 * Compare a contract payload against a key.
 *
 * Daml keys come in many shapes:
 *   - tuples: `(party, instrumentId)` -> serialized as { _1: ..., _2: ... }
 *   - records: { issuer, assetCode, maturity }
 *   - primitives: a Party or Text directly
 *
 * For tuples and records, we compare each top-level field. For nested newtypes
 * (e.g. AssetCode { unAssetCode: "USYC" }), the JSON encoding wraps them, so we
 * compare deeply.
 */
function unwrapNewtype(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const keys = Object.keys(v as Record<string, unknown>);
    if (keys.length === 1 && /^un[A-Z]/.test(keys[0])) {
      return (v as Record<string, unknown>)[keys[0]];
    }
  }
  return v;
}

function keysEqual(payload: Record<string, unknown>, key: unknown): boolean {
  if (Array.isArray(key)) {
    const payloadKeys = Object.keys(payload);
    return key.every((k, i) =>
      deepEqual(unwrapNewtype(payload[payloadKeys[i]]), unwrapNewtype(k)),
    );
  }
  if (key && typeof key === 'object') {
    return Object.entries(key as Record<string, unknown>).every(([k, v]) =>
      deepEqual(unwrapNewtype(payload[k]), unwrapNewtype(v)),
    );
  }
  return false;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  // ISO-8601 timestamps: compare by Date.parse so "2026-12-31T16:00:00Z"
  // equals "2026-12-31T16:00:00.000Z" (Canton drops trailing zero ms).
  if (typeof a === 'string' && typeof b === 'string' && ISO_RE.test(a) && ISO_RE.test(b)) {
    return Date.parse(a) === Date.parse(b);
  }
  if (typeof a !== 'object') return a === b;
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
}
