# ANCHOR Gym System — Database Normalization

## Scope and method

This document assesses the 14 relations used by the application and documents
the normalization reasoning independently of the ERD. The column inventory
comes from the project's existing database-design documentation; application
behavior and startup schema changes were cross-checked in
[`backend/server.js`](./backend/server.js).

There is no live PostgreSQL catalog export, complete baseline migration, or
persisted unnormalized relation in this repository. Therefore:

- The UNF example below is an explicitly illustrative source/report layout,
  not a claim that the project currently stores one wide UNF table.
- The existing SQL implementation is described as an application-level
  logical schema. Primary/unique constraints on legacy tables and therefore
  some formal normal-form proofs remain conditional until the live catalog is
  checked.
- No table is called non-normalized unless a concrete repeating group or
  functional dependency is shown.

The finished relation inventory in Section 5 matches the entity/attribute
inventory in [`DATABASE-ERD.md`](./DATABASE-ERD.md). Types follow the existing
project documentation; confirm exact timezone modifiers and legacy
constraints against PostgreSQL.

## 1. Unnormalized form (UNF)

No stored UNF table was found. To illustrate the problem normalization
addresses, imagine a single membership/visit report assembled as one
wide record per user:

```text
GYM_REPORT(
  user_id, full_name, email, phone,
  applications{application_id, plan, amount, payment_reference, status},
  memberships{member_row_id, member_id, plan, start_date, expiration_date},
  visits{attendance_id, subject_type, check_in, check_out},
  charges{transaction_id, amount, method, transaction_date}
)
```

The braces indicate repeating groups, not actual PostgreSQL array/JSON
columns. A user may have multiple applications, memberships, visits, and
charges. Putting those groups into one row makes the attributes
non-atomic/repeating and creates ambiguous combinations (for example, which
charge belongs to which visit). No sample values are invented here because
the repository does not provide a database seed dataset.

**Change required:** represent each repeatable fact as a row in its own
relation and retain identifiers that connect related facts. The system's
existing application schema already follows this broad decomposition.

## 2. First normal form (1NF)

**Rule:** each field contains one value from its domain, and a row represents
one occurrence rather than a list of occurrences.

### Before → after

| Illustrative UNF structure | 1NF row structures |
|---|---|
| `GYM_REPORT(user facts, applications{...}, memberships{...}, visits{...}, charges{...})` | `USERS(id, ...)`; `APPLICATIONS(id, user_id, ...)`; `MEMBERS(id, user_id, ...)`; `ATTENDANCE(id, member_id, guest_id, ...)`; `MEMBER_TRANSACTIONS(id, ...)`; `GUESTS(id, ...)`; `GUEST_TRANSACTIONS(id, ...)`; `GUEST_VISIT_EXTENSIONS(id, ...)` |

At this stage the user, application, membership, attendance, transaction,
guest, and extension values are represented as scalar columns on individual
rows. Authentication/session, notification, and archive facts are similarly
stored as individual rows in their own relations; their full structures are
listed in Section 5.

### Keys and functional dependencies

The intended row identifiers are the single-column `id` values (or
`archive_id` / `token_hash` for the relevant support tables). On that
logical-key assumption, examples of the intended dependencies are:

```text
USERS.id                 -> full_name, email, password, phone, role, created_at, profile_photo
APPLICATIONS.id          -> user_id, membership_plan, amount, gcash_reference, payment_screenshot, payment_date, status, rejection_reason, created_at
ATTENDANCE.id             -> member_id, guest_id, user_type, check_in, check_out, expires_at, expiration_time, voided_at
GUEST_TRANSACTIONS.id     -> guest_id, guest_name, visit_type, amount, payment_method, transaction_date, ...
```

These express intended row identity, not verified catalog constraints.
An identifier default or application use is not by itself proof of a
declared primary key.

**Result:** the documented relations appear scalar and event facts are
separate rows, so the visible schema is consistent with 1NF. This assessment
does not cover undocumented array/JSON/list contents inside free-text fields.
No structural change is recommended solely to claim 1NF.

## 3. Second normal form (2NF)

**Rule:** a relation is in 1NF and every non-key attribute depends on the
whole of every candidate key; no non-key attribute depends on only part of a
composite candidate key.

### Before → after

| 1NF candidate structure | 2NF assessment / structure after review |
|---|---|
| Each relation in Section 5, keyed by its own single-column logical identifier | Same relations and attributes. With only a single-column candidate key, there is no proper subset of the key and therefore no partial-key dependency to remove. |
| No composite-key intersection/line-item table is evidenced in the project files | No associative/line-item table is invented. The relationships documented by the app use identifiers as references, not a demonstrated composite primary key. |

For example, under the intended key `APPLICATIONS.id`, the dependency is
`id -> user_id, membership_plan, amount, gcash_reference, payment_screenshot,
payment_date, status, rejection_reason, created_at`. This has no partial
dependency because `id` has no component key. Likewise, the apparent
single-column identifiers on transactions and attendance give no evidence
of a composite-key partial dependency.

**Result:** 2NF is conditional on the logical identifiers being the actual
candidate keys and on there being no additional composite candidate key with
partial dependencies. The repository does not expose enough PostgreSQL
catalog information to prove that condition. No 2NF decomposition is
justified by the available evidence.

## 4. Third normal form (3NF)

**Rule:** a relation is in 2NF and non-key attributes do not transitively
depend on a candidate key through another non-key attribute. For each
non-trivial dependency `X -> A`, `X` must be a superkey or `A` must be prime.

### Before → after

| Structure under review | Dependency evidence | 3NF action |
|---|---|---|
| `APPLICATIONS` with applicant ID plus plan, requested/paid amount, payment reference/evidence, date, and status | Application ID is treated by the app as the row identifier. No dependency among non-key columns is established by project files. | Keep the application relation as implemented. Do not split plan/price or payment data without a confirmed dependency and business rule. |
| `MEMBER_TRANSACTIONS` with optional user/member/application references and payment facts | The app copies application user, amount, and reference into a verified transaction. This creates potentially repeated facts; however, the existing application row records submission/review while the transaction records a ledger event, and the code alone does not prove those values must remain synchronized. | Retain both business records; specify transaction fields as recorded payment facts/snapshots. Before a redesign, establish whether `application_id -> user_id`/payment data is a durable dependency and whether payments may exist without an application. |
| `GUESTS` and `GUEST_TRANSACTIONS` | The transaction table holds guest ID and guest name/visit-type text as well as payment data. If name/visit type are intended to equal current guest attributes, a dependency through `guest_id` could cause update anomalies. Runtime insertion shows copied transaction-time labels, but does not fully document the intended historical semantics. | Treat copied values as transaction-time snapshots unless the business owner confirms they should track the live guest. Under the snapshot rule, the historical values are facts about the transaction, not a demonstrated transitive dependency. |
| `ARCHIVED_MEMBERS` | The row contains member/account facts also represented by `MEMBERS` and `USERS`. The archive workflow copies these values while preserving a historical record. | Treat these as point-in-time snapshot attributes. Do not synchronize archive history to mutable current profile values. No 3NF violation is established if snapshot semantics are intended. |
| `GUEST_VISIT_EXTENSIONS` and `GUEST_TRANSACTIONS` | Both contain amounts, payment statuses/references, and expiration values, but the extension row describes the extension event while the transaction row describes a charge. No one-to-one or equality dependency is established. | Keep separate pending evidence of the schema/workflow; do not claim duplication is a 3NF violation without the business rule and key constraints. |
| `MEMBERSHIP_PLAN` and `amount` across application/member/payment records | Repeated plan labels/prices appear in different business events. No managed plan catalog or functional dependency `plan -> price` is evidenced. | Do not invent a plan table. If prices are centrally managed in the future, use a plan/version key and retain charged-amount snapshots for history. |

**Result:** the application-level schema is organized by entity/event and is
3NF-oriented, but formal certification is conditional on verified candidate
keys and dependencies. The evidence does not prove a transitive dependency
requiring decomposition in the current implementation. The duplicated values
identified above may be valid snapshots rather than normalization defects.

## 5. Final relation inventory (3NF-oriented implementation)

`PK*` below means the application/project documentation treats the attribute
as the row key, but this repository does not verify its physical PK
constraint. `PK` means the backend explicitly declares it in its setup SQL.
`FK†` means an application relationship/reference whose physical FK is not
established in the setup code. `FK` means the backend explicitly declares a
foreign-key constraint. Column types are those documented for the existing
schema; exact legacy precision/timezone variants require catalog verification.

### Core account and membership relations

| Relation | Columns and key roles |
|---|---|
| `USERS` | `id INTEGER PK*`; `full_name VARCHAR`; `email VARCHAR`; `password VARCHAR`; `phone VARCHAR`; `role VARCHAR`; `created_at TIMESTAMP`; `profile_photo TEXT` |
| `APPLICATIONS` | `id INTEGER PK*`; `user_id INTEGER FK†`; `membership_plan VARCHAR`; `amount NUMERIC`; `gcash_reference VARCHAR`; `payment_screenshot TEXT`; `payment_date DATE`; `status VARCHAR`; `rejection_reason VARCHAR`; `created_at TIMESTAMP` |
| `MEMBERS` | `id INTEGER PK*`; `user_id INTEGER FK†`; `member_id VARCHAR`; `registration_type VARCHAR`; `membership_plan VARCHAR`; `start_date DATE`; `expiration_date DATE`; `status VARCHAR`; `qr_code VARCHAR`; `paused_days_remaining INTEGER`; `archived_at TIMESTAMP`; `archived_archive_id BIGINT FK†` |
| `MEMBER_TRANSACTIONS` | `id INTEGER PK*`; `user_id INTEGER FK†`; `member_id INTEGER FK†`; `application_id INTEGER FK†`; `amount NUMERIC`; `payment_method VARCHAR`; `gcash_reference VARCHAR`; `transaction_date TIMESTAMP`; `status VARCHAR`; `verified_by INTEGER`; `verification_date TIME`; `created_at TIMESTAMP` |
| `ARCHIVED_MEMBERS` | `archive_id BIGINT PK*`; `original_member_id INTEGER FK†`; `user_id INTEGER FK†`; `member_id VARCHAR`; `full_name VARCHAR`; `email VARCHAR`; `registration_type VARCHAR`; `membership_plan VARCHAR`; `start_date DATE`; `expiration_date DATE`; `status VARCHAR`; `qr_code TEXT`; `archived_at TIMESTAMP`; `removal_reason TEXT`; `restored_at TIMESTAMP` |

### Attendance and guest relations

| Relation | Columns and key roles |
|---|---|
| `ATTENDANCE` | `id INTEGER PK*`; `member_id INTEGER FK†`; `guest_id INTEGER FK†`; `user_type VARCHAR`; `check_in TIMESTAMP`; `check_out TIMESTAMP`; `expires_at TIMESTAMP`; `expiration_time TIMESTAMP`; `voided_at TIMESTAMP` |
| `GUESTS` | `id INTEGER PK*`; `full_name VARCHAR`; `phone VARCHAR`; `visit_type VARCHAR`; `amount_paid NUMERIC`; `payment_method VARCHAR`; `created_at TIMESTAMP`; `hours INTEGER`; `email VARCHAR` |
| `GUEST_TRANSACTIONS` | `id BIGINT PK`; `guest_id BIGINT FK†`; `guest_name TEXT`; `visit_type TEXT`; `amount NUMERIC(10,2)`; `payment_method TEXT`; `transaction_date TIMESTAMPTZ`; `created_at TIMESTAMPTZ`; `transaction_reference TEXT`; `attendance_id BIGINT FK†`; `extension_type TEXT`; `additional_hours INTEGER`; `payment_status TEXT`; `previous_expiration TIMESTAMPTZ`; `new_expiration TIMESTAMPTZ`; `idempotency_key TEXT` |
| `GUEST_VISIT_EXTENSIONS` | `id BIGINT PK`; `attendance_id BIGINT FK†`; `guest_id BIGINT FK†`; `extension_type TEXT`; `additional_hours INTEGER`; `amount NUMERIC(10,2)`; `payment_status TEXT`; `previous_expiration TIMESTAMPTZ`; `new_expiration TIMESTAMPTZ`; `transaction_reference TEXT`; `guest_transaction_id BIGINT FK†`; `idempotency_key TEXT`; `payment_date TIMESTAMPTZ`; `created_at TIMESTAMPTZ` |

### Notifications and authentication relations

| Relation | Columns and key roles |
|---|---|
| `NOTIFICATIONS` | `id INTEGER PK*`; `user_id INTEGER FK†`; `title VARCHAR`; `message VARCHAR`; `is_read BOOLEAN`; `created_at TIMESTAMP`; `type VARCHAR` |
| `ADMIN_SESSIONS` | `token_hash CHAR(64) PK`; `user_id INTEGER FK`; `expires_at TIMESTAMPTZ`; `created_at TIMESTAMPTZ` |
| `CUSTOMER_SESSIONS` | `token_hash CHAR(64) PK`; `user_id INTEGER FK`; `expires_at TIMESTAMPTZ`; `created_at TIMESTAMPTZ` |
| `MEMBER_QR_TOKENS` | `token_hash CHAR(64) PK`; `member_id BIGINT FK`; `expires_at TIMESTAMPTZ`; `consumed_at TIMESTAMPTZ`; `created_at TIMESTAMPTZ` |
| `PASSWORD_RESET_TOKENS` | `token_hash CHAR(64) PK`; `user_id INTEGER FK`; `expires_at TIMESTAMPTZ`; `used_at TIMESTAMPTZ`; `attempts INTEGER`; `verified_at TIMESTAMPTZ`; `reset_token_hash CHAR(64)`; `created_at TIMESTAMPTZ` |

The backend setup explicitly declares primary and foreign keys for the four
authentication/token relations above. It also declares primary keys and
selected checks for `GUEST_TRANSACTIONS` and `GUEST_VISIT_EXTENSIONS`, a
member lifecycle status check, a nonnegative paused-days check, and partial
unique indexes for non-null guest transaction/extension idempotency keys.
Foreign keys on the guest relations are not declared in the inspected setup.
The server's unique-index and check-constraint statements are summarized
here; this inventory is not a substitute for the live database's current
constraint definitions.

## 6. Cross-check and unresolved items

- The final relation names and columns correspond to the ERD; the files differ
  in purpose, not in schema content.
- The 1NF and 2NF analyses do not claim a table violates those forms. With
  single-column candidate keys, partial dependencies do not arise.
- The 3NF analysis explicitly separates demonstrated facts from unverified
  dependencies and historical snapshots.
- `ATTENDANCE` should be validated for exactly one subject (`member_id` XOR
  `guest_id`) consistent with `user_type`.
- Check whether `MEMBER_TRANSACTIONS.application_id` has a unique constraint;
  application code checks for duplicates during approval, but code-level
  checks do not establish database uniqueness.
- Confirm the actual primary/unique keys, nullability, foreign keys and
  delete actions, check constraints, indexes, triggers, and timestamp
  modifiers from the live PostgreSQL catalog before describing this logical
  analysis as formally certified or applying migrations.
- This is documentation only; no schema or application behavior is changed.
