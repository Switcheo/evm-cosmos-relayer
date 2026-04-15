# Relayer Troubleshooting Runbook

This runbook is for Axelar relays that remain in `in_transit` on Hydrogen for longer than expected.

It is intentionally evidence-based:

- Start by identifying exactly where the relay stopped.
- Use the smallest safe recovery action that matches that state.
- Do not blindly retry every step. Some failures are indexing, IBC, or funding issues and should be escalated instead.

## Scope

This document covers the stuck states already modeled in the relayer code, especially [src/cron/index.ts](../src/cron/index.ts).

It does not try to guess about failures that are outside the currently implemented flow, such as downstream application-specific contract logic after the relay itself is complete.

## Safety Model

Treat actions in this runbook in three groups:

- Read-only inspection:
  `curl` to Hydrogen or Demex APIs, `yarn ts-node scripts/inspect-relay.ts`, `yarn ts-node scripts/test-query-contract-call-submitted.ts`, `yarn ts-node scripts/test-scan-stuck-batches.ts <chain> --dry-run`
- Controlled repair:
  `yarn ts-node scripts/fix-hydrogen.ts`, `yarn ts-node scripts/test-axelar-confirm-evm-tx.ts`, `yarn ts-node scripts/test-axelar-route-message.ts`, `yarn ts-node scripts/test-axelar-sign-commands.ts`, `yarn ts-node scripts/test-scan-stuck-batches.ts <chain>`
- Escalation only:
  Hydrogen indexing gaps, Carbon executor funding or liveness issues, Carbon-to-Axelar IBC delivery issues, EVM-side executor issues after approval

If the diagnosis points to an external dependency, stop after collecting evidence and escalate with the exact relay id, chain id, and the observed missing event.

## Prerequisites

The commands below assume:

- You are in the repo root.
- `.env` is populated.
- `AXELAR_MNEMONIC` has enough gas to submit Axelar transactions.
- `EVM_PRIVATE_KEY` has enough gas to execute gateway batches on destination EVM chains.
- `HYDROGEN_URL` and `DEMEX_URL` point to the correct environment.

Useful setup commands:

```bash
yarn
make up
make prisma-push
make prisma-generate
```

## Quick Start

If you already know the Hydrogen relay id:

```bash
yarn ts-node scripts/inspect-relay.ts <relay_id>
```

That script prints:

- relay summary
- key events present on the relay
- likely stuck state
- next recommended action

If you only have a source tx hash and log index, first look up the local relay record:

```bash
curl "http://localhost:${PORT:-3000}/tx.get?txHash=<tx_hash>&logIndex=<log_index>"
```

If you need the full Hydrogen relay payload directly:

```bash
curl "${HYDROGEN_URL}/relays/<relay_id>"
```

## Bulk Recovery

The safest first repair action for supported cases is the existing built-in fixer:

```bash
yarn ts-node scripts/fix-hydrogen.ts
```

Use this when:

- you want to process all relays currently stuck in Hydrogen
- the stuck state is one already handled in `fixStuckRelay`
- you do not need to target a single relay with a custom action

Do not rely on this command alone for cases that are clearly indexing-only or external-owner failures. In those cases, the right answer is usually to gather proof and escalate.

## Triage Matrix

Use the relay's `flow_type`, `bridging_tx_hash`, `destination_tx_hash`, and event list to classify the failure.

| Flow | `bridging_tx_hash` | `destination_tx_hash` | Most likely meaning | Primary action |
| --- | --- | --- | --- | --- |
| `in` | `null` | any | EVM event not confirmed on Axelar yet, or Hydrogen missed `EVMEventConfirmed` | Inspect Axelar event presence; if absent and finalized, confirm tx |
| `in` | present | `null` | Message not routed to Carbon, timed out, or Hydrogen missed Carbon receive event | Prefer built-in fixer; if needed, route message using source tx hash, log index, and payload |
| `out` | `null` | any | Hydrogen missed `ContractCallSubmitted`, Carbon pending action stuck, or Carbon-to-Axelar IBC failed | Inspect `ModuleAxelarCallContractEvent`, `BridgeAcknowledgedEvent`, and pending action status |
| `out` | present | `null` | Message not routed on Axelar, commands not signed, signed batch not executed on EVM, or EVM execution missing after approval | Prefer built-in fixer, then inspect pending commands or stuck batches |

## Case Playbooks

### 1. Inbound relay with no `bridging_tx_hash`

Expected pattern:

- `flow_type = in`
- `bridging_tx_hash = null`
- relay includes `ContractCall`

What this means:

- Axelar may already have `EVMEventConfirmed`, but Hydrogen did not index it
- or the EVM tx has not been confirmed on Axelar yet

Inspect:

```bash
yarn ts-node scripts/inspect-relay.ts <relay_id>
```

Safe repair if the source EVM tx is finalized and Axelar does not yet show the event:

```bash
yarn ts-node scripts/test-axelar-confirm-evm-tx.ts <chain_id> <source_tx_hash>
```

Escalate instead of retrying if:

- Axelar already has the event and the relay is still missing `bridging_tx_hash`
- this points to Hydrogen indexing/resync, not a missing confirmation broadcast

### 2. Inbound relay with no `destination_tx_hash`

Expected pattern:

- `flow_type = in`
- `bridging_tx_hash` is present
- `destination_tx_hash = null`

What this means:

- message was not routed to Carbon yet
- message timed out or failed in transit
- or Carbon received it but Hydrogen did not index `BridgeReceivedEvent`

Recommended first action:

```bash
yarn ts-node scripts/fix-hydrogen.ts
```

Targeted manual retry for the route step:

```bash
yarn ts-node scripts/test-axelar-route-message.ts <contract_call_tx_hash> <contract_call_tx_index> <payload>
```

Use the values from the relay's `ContractCall` event.

Escalate instead of repeated retries if:

- Carbon already shows a receive-side event but Hydrogen does not
- repeated route attempts fail or the message appears to have timed out

### 3. Outbound relay with no `bridging_tx_hash`

Expected pattern:

- `flow_type = out`
- `bridging_tx_hash = null`

There are three important sub-cases here.

#### 3a. Carbon already sent the packet, but Hydrogen missed `ContractCallSubmitted`

Expected events:

- `Switcheo.carbon.bridge.ModuleAxelarCallContractEvent`
- `Switcheo.carbon.bridge.BridgeAcknowledgedEvent`

Inspect:

```bash
yarn ts-node scripts/test-query-contract-call-submitted.ts <relay_id>
```

If the script finds a `message_id` on Axelar:

- the packet reached Axelar
- Hydrogen likely missed `ContractCallSubmitted`
- stop retrying relay actions and request Hydrogen resync

#### 3b. Carbon sent the packet, but Axelar never received it

Expected events:

- `Switcheo.carbon.bridge.ModuleAxelarCallContractEvent`
- `Switcheo.carbon.bridge.BridgeAcknowledgedEvent`
- `test-query-contract-call-submitted.ts` does not find a matching event on Axelar

Meaning:

- this is likely Carbon-to-Axelar IBC delivery trouble

Next action:

- escalate to the IBC relayer or chain-ops owner
- include relay id, chain id, and proof that Carbon emitted the packet but Axelar has no matching `ContractCallSubmitted`

#### 3c. Pending action is stuck or expired on Carbon

Expected pattern:

- relay includes `Switcheo.carbon.bridge.NewPendingActionEvent`
- no `ModuleAxelarCallContractEvent` plus `BridgeAcknowledgedEvent` pair yet

Inspect:

```bash
yarn ts-node scripts/inspect-relay.ts <relay_id>
```

If the pending action expired more than one hour ago and is still uncleared:

- likely the Carbon executor is down or out of funds
- do not keep retrying Axelar-side actions
- escalate to the Carbon-side operator

### 4. Outbound relay with no `destination_tx_hash`

Expected pattern:

- `flow_type = out`
- `bridging_tx_hash` is present
- `destination_tx_hash = null`

This bucket contains several distinct stages.

#### 4a. Message approved on Axelar but not fully processed yet

Recommended first action:

```bash
yarn ts-node scripts/fix-hydrogen.ts
```

Why:

- the built-in fixer already handles the route, sign, and batch-send decision tree for supported cases

If the relay is still stuck afterward, inspect it:

```bash
yarn ts-node scripts/inspect-relay.ts <relay_id>
```

#### 4b. Commands are pending signature on Axelar

If inspection shows the message has reached the pending-command stage, you can trigger signing:

```bash
yarn ts-node scripts/test-axelar-sign-commands.ts <chain_id>
```

Use this carefully. It is chain-wide, not relay-specific.

#### 4c. Batch is signed on Axelar but never executed on EVM

Inspect first:

```bash
yarn ts-node scripts/test-scan-stuck-batches.ts <chain_id> --dry-run
```

If the dry run finds unexecuted batches, send them:

```bash
yarn ts-node scripts/test-scan-stuck-batches.ts <chain_id>
```

This is already the same strategy used by [src/cron/sendStuckBatches.ts](../src/cron/sendStuckBatches.ts).

#### 4d. `ContractCallApproved` exists but `ContractCallExecuted` does not

Meaning:

- Axelar approved the call
- the destination EVM chain has not executed it
- this usually points to executor funding or liveness, not an Axelar routing issue

Next action:

- check the EVM executor wallet and chain gas conditions
- escalate to the EVM-side operator if needed

## Evidence To Capture Before Escalation

For any case that is not safe to auto-fix, collect:

- Hydrogen relay id
- `connection_id`
- `flow_type`
- source tx hash
- bridging tx hash if present
- destination tx hash if present
- event names present on the relay
- exact missing event you expected to see
- whether `scripts/inspect-relay.ts` or `scripts/test-query-contract-call-submitted.ts` found proof of progress on Axelar

This is usually enough for Hydrogen, Carbon, Axelar, or IBC owners to pick up the issue without re-triaging from scratch.

## Current Limitations

These cases are recognized by the code but not fully auto-remediated yet:

- Hydrogen missing an already-emitted event
- Carbon receive-side event exists but Hydrogen did not sync it
- expired pending actions on Carbon that were not cleared
- EVM execution missing after approval, where the underlying problem is executor funding or liveness

Those should still be documented in the client runbook. The important thing is to give a deterministic diagnosis and a clear escalation boundary instead of pretending they are self-healing.

## Recommended Next Improvements

If this runbook is useful, the next most valuable follow-ups are:

- add a relay-specific fix script so operators do not need to run the bulk fixer for single incidents
- add a Hydrogen resync procedure if the upstream service supports it
- add Carbon-side checks for pending action expiry, funds, and executor health
- add a checklist for IBC relayer health between Carbon and Axelar
