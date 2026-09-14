# Material Metadata Versions Implementation Plan

**Goal:** Complete R09 by making accepted material metadata directly editable, versioned, restorable, and immediately visible to lesson preparation without changing the material file.

### 1. Core state and migration

- Extend accepted material records with bounded private metadata revision, versions, receipts and head hash.
- Treat legacy records without metadata state as revision 0 without rewriting them during a read.
- Validate current values, continuous retained history, request identities and global storage limits.

### 2. Core update, restore and deletion serialization

- Add strict `material-metadata` update and restore request handlers.
- Acquire the entity deletion lock before the education intake lock; reject deleted, missing, ambiguous and stale targets.
- Preserve file identity fields and write the canonical intake state plus existing material mirror in one admitted mutation.

### 3. Private history and preparation refresh

- Add opt-in material metadata history to `workspace-resources`; omit it from ordinary responses.
- Project revision, history count and metadata update time through `teacherMaterials`.
- Refresh rhythm tasks after successful update or restore and prove title/scope changes update the same lesson occurrence.

### 4. Core verification and merge

- Cover migration, update/no-op, restore, replay, stale/conflicting requests, deletion, capacity, restart and unchanged file bytes.
- Regenerate component manifests and bridge parity evidence.
- Run focused tests, typecheck, full tests, audit and independent P1/P2 review; merge the Core PR.

### 5. Desktop adapter and routes

- Pin the merged Core and expose bounded same-origin update/history/restore routes.
- Validate version identities and chains, bind deterministic request IDs, and reconcile every mutation against current material projection plus history.
- Add an isolated Core/Desktop E2 covering write, restore, deletion recovery, stale requests and preparation refresh.

### 6. Desktop material drawer

- Add direct metadata edit/cancel/save for accepted materials.
- Add on-demand complete before/after history with both restore directions and truthful loading/error states.
- Keep AI collaboration in the global conversation with the current metadata and an explicit teacher input slot.
- Refresh list category, selected drawer, sidebar counts and linked preparation data from the returned Core contract.

### 7. Live acceptance and delivery

- Exercise edit, cancel, save, history restore, delete/restore and reload in isolated browser data.
- Verify source file bytes, material list/category and preparation summary after every relevant change.
- Run full Desktop checks and independent review, merge the Desktop PR, update the canonical R09 ledger, then continue R08/R10/R11/R12/R17.
