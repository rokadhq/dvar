# Inventory and Lockfile Reference

## Inventory

`dvar.inventory.json` is an observation artifact produced by `dvar scan`.

```json
{
  "inventoryVersion": "1",
  "generatedAt": "2026-06-27T00:00:00.000Z",
  "servers": []
}
```

It is safe to regenerate and is not an approval record.

## Lockfile

`dvar.lock.json` is the reviewed approval record produced by `dvar lock`.

```json
{
  "lockfileVersion": "1",
  "generatedAt": "2026-06-27T00:00:00.000Z",
  "servers": []
}
```

Each server records identity, transport, endpoint, negotiated protocol information, server metadata, a manifest hash, and canonical tool records. Each tool records reviewable schemas and metadata alongside hashes, inferred capabilities, risk, and a definition hash.

## Review rule

Do not accept a lockfile update merely because the hash changed. Review the semantic diff, especially:

- new destinations;
- schema widening;
- new destructive or privileged capabilities;
- tools whose descriptions changed without a corresponding version change;
- broad `additionalProperties` changes;
- newly introduced financial, identity, secret, shell, or infrastructure operations.
