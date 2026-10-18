# ANCHOR Gym System — Entity-Relationship Diagram

## Scope and evidence

This is a logical ERD of the 14 database entities used by the project. It was
prepared from the existing database-design documentation and application
queries/schema setup in [`backend/server.js`](./backend/server.js). The
application runs on PostgreSQL.

The repository does not include a live PostgreSQL catalog export or a
foundational migration defining every legacy table. Consequently, identifiers
and relationships used by the application are shown as logical keys where the
physical constraint could not be verified. This diagram does not claim that
all displayed relationships are enforced by PostgreSQL.

## Diagram

```mermaid
erDiagram
    USERS {
        integer id PK
        varchar full_name
        varchar email
        varchar password
        varchar phone
        varchar role
        timestamp created_at
        text profile_photo
    }
    APPLICATIONS {
        integer id PK
        integer user_id FK
        varchar membership_plan
        numeric amount
        varchar gcash_reference
        text payment_screenshot
        date payment_date
        varchar status
        varchar rejection_reason
        timestamp created_at
    }
    MEMBERS {
        integer id PK
        integer user_id FK
        varchar member_id
        varchar registration_type
        varchar membership_plan
        date start_date
        date expiration_date
        varchar status
        varchar qr_code
        integer paused_days_remaining
        timestamp archived_at
        bigint archived_archive_id FK
    }
    MEMBER_TRANSACTIONS {
        integer id PK
        integer user_id FK
        integer member_id FK
        integer application_id FK
        numeric amount
        varchar payment_method
        varchar gcash_reference
        timestamp transaction_date
        varchar status
        integer verified_by
        time verification_date
        timestamp created_at
    }
    ATTENDANCE {
        integer id PK
        integer member_id FK
        integer guest_id FK
        varchar user_type
        timestamp check_in
        timestamp check_out
        timestamp expires_at
        timestamp expiration_time
        timestamp voided_at
    }
    GUESTS {
        integer id PK
        varchar full_name
        varchar phone
        varchar visit_type
        numeric amount_paid
        varchar payment_method
        timestamp created_at
        integer hours
        varchar email
    }
    GUEST_TRANSACTIONS {
        bigint id PK
        bigint guest_id FK
        text guest_name
        text visit_type
        numeric amount
        text payment_method
        timestamp transaction_date
        timestamp created_at
        text transaction_reference
        bigint attendance_id FK
        text extension_type
        integer additional_hours
        text payment_status
        timestamp previous_expiration
        timestamp new_expiration
        text idempotency_key
    }
    GUEST_VISIT_EXTENSIONS {
        bigint id PK
        bigint attendance_id FK
        bigint guest_id FK
        text extension_type
        integer additional_hours
        numeric amount
        text payment_status
        timestamp previous_expiration
        timestamp new_expiration
        text transaction_reference
        bigint guest_transaction_id FK
        text idempotency_key
        timestamp payment_date
        timestamp created_at
    }
    ARCHIVED_MEMBERS {
        bigint archive_id PK
        integer original_member_id FK
        integer user_id FK
        varchar member_id
        varchar full_name
        varchar email
        varchar registration_type
        varchar membership_plan
        date start_date
        date expiration_date
        varchar status
        text qr_code
        timestamp archived_at
        text removal_reason
        timestamp restored_at
    }
    NOTIFICATIONS {
        integer id PK
        integer user_id FK
        varchar title
        varchar message
        boolean is_read
        timestamp created_at
        varchar type
    }
    ADMIN_SESSIONS {
        char token_hash PK
        integer user_id FK
        timestamp expires_at
        timestamp created_at
    }
    CUSTOMER_SESSIONS {
        char token_hash PK
        integer user_id FK
        timestamp expires_at
        timestamp created_at
    }
    MEMBER_QR_TOKENS {
        char token_hash PK
        bigint member_id FK
        timestamp expires_at
        timestamp consumed_at
        timestamp created_at
    }
    PASSWORD_RESET_TOKENS {
        char token_hash PK
        integer user_id FK
        timestamp expires_at
        timestamp used_at
        integer attempts
        timestamp verified_at
        char reset_token_hash
        timestamp created_at
    }

    USERS ||--o{ APPLICATIONS : submits
    USERS ||--o{ MEMBERS : owns
    USERS o|--o{ MEMBER_TRANSACTIONS : associated_payment
    MEMBERS o|--o{ MEMBER_TRANSACTIONS : payment_history
    APPLICATIONS o|--o{ MEMBER_TRANSACTIONS : payment_for
    MEMBERS o|--o{ ATTENDANCE : member_visit
    GUESTS o|--o{ ATTENDANCE : guest_visit
    GUESTS ||--o{ GUEST_TRANSACTIONS : charged_to
    ATTENDANCE o|--o{ GUEST_TRANSACTIONS : charged_visit
    ATTENDANCE ||--o{ GUEST_VISIT_EXTENSIONS : extended_visit
    GUESTS ||--o{ GUEST_VISIT_EXTENSIONS : extension_for
    GUEST_TRANSACTIONS o|--o{ GUEST_VISIT_EXTENSIONS : may_record_payment
    USERS ||--o{ ARCHIVED_MEMBERS : account_snapshot
    MEMBERS o|--o{ ARCHIVED_MEMBERS : source_membership
    ARCHIVED_MEMBERS o|--o{ MEMBERS : current_archive_pointer
    USERS ||--o{ NOTIFICATIONS : receives
    USERS ||--o{ ADMIN_SESSIONS : admin_authentication
    USERS ||--o{ CUSTOMER_SESSIONS : customer_authentication
    USERS ||--o{ PASSWORD_RESET_TOKENS : password_reset
    MEMBERS ||--o{ MEMBER_QR_TOKENS : qr_tokens
```

## Legend and relationship rules

- `PK`: row identifier treated as the logical primary key by the application.
  It is explicitly declared by the server for `guest_transactions`,
  `guest_visit_extensions`, `admin_sessions`, `customer_sessions`,
  `member_qr_tokens`, and `password_reset_tokens`. For the legacy tables, the
  project documentation/application use the displayed identifier as a row
  key, but this repository does not prove a physical primary-key constraint.
- `FK`: relationship column used by the application. A column label alone
  does not mean PostgreSQL enforces it.
- Crow's Foot notation: `||` = exactly one; `o|` = zero or one; `o{` = zero
  or many. Read each connector from either endpoint. These are logical
  cardinalities based on nullability and workflow; where the physical
  constraint is unknown, they are not a catalog guarantee.
- All listed attributes belong to the entities in the deployed/application
  schema. Exact timestamp timezone modifiers and some legacy column
  constraints are not available in the repository's catalog evidence; verify
  them against PostgreSQL before using this as a physical-schema specification.

### Relationship details and enforcement status

| Relationship | Logical cardinality | What the project evidence supports |
|---|---|---|
| `USERS` — `APPLICATIONS` | One user to zero or many applications; each application belongs to one user | Used by application queries; no FK DDL for this legacy link was found in the server setup |
| `USERS` — `MEMBERS` | One user to zero or many memberships; each member row belongs to one user | Used by membership workflow; no FK DDL for this legacy link was found |
| `USERS` / `MEMBERS` / `APPLICATIONS` — `MEMBER_TRANSACTIONS` | Each transaction may reference zero or one row of each parent; each parent may have many transactions | Application behavior uses these IDs; legacy FK and unique constraints were not established. Approval rejects duplicate transactions for one application in code, but the database uniqueness rule is unverified |
| `MEMBERS` / `GUESTS` — `ATTENDANCE` | Each attendance row is intended for either one member or one guest; each subject may have many visits | Polymorphic reference using `user_type` and nullable IDs. The XOR/consistency rule is an application design requirement, not a verified database constraint |
| `GUESTS` — `GUEST_TRANSACTIONS` | One guest to zero or many transactions; each transaction has one guest | The table creation declares `guest_id NOT NULL`; no FK was declared in the inspected server DDL |
| `ATTENDANCE` — `GUEST_TRANSACTIONS` | An attendance row may have many charges; a transaction may have zero or one attendance | `attendance_id` is nullable; no FK was declared in the inspected server DDL |
| `ATTENDANCE` / `GUESTS` — `GUEST_VISIT_EXTENSIONS` | One attendance and one guest to zero or many extensions; each extension references one of each | Table creation declares both IDs `NOT NULL`; no FKs were declared in the inspected server DDL |
| `GUEST_TRANSACTIONS` — `GUEST_VISIT_EXTENSIONS` | A transaction may relate to zero or many extensions; an extension may have zero or one transaction | Extension `guest_transaction_id` is nullable; the workflow may leave it null for a no-charge extension. No FK/unique rule was declared |
| `USERS` / `MEMBERS` — `ARCHIVED_MEMBERS` | One user may have many snapshots; a snapshot may reference zero or one source member | Archive rows copy profile and membership facts; `original_member_id` is treated as optional lineage. No FKs were declared in the inspected server DDL |
| `ARCHIVED_MEMBERS` — `MEMBERS.archived_archive_id` | An archive row may be pointed to by zero or more member rows; a member row has zero or one current archive pointer | The application sets/clears this pointer during archive/restore; no FK or uniqueness constraint was declared |
| `USERS` — `NOTIFICATIONS` | One user to zero or many notifications | Used by application queries; legacy FK enforcement was not established |
| `USERS` — `ADMIN_SESSIONS`, `CUSTOMER_SESSIONS`, `PASSWORD_RESET_TOKENS` | One user to zero or many records; each record belongs to one user | Server DDL explicitly declares `user_id REFERENCES users(id) ON DELETE CASCADE` |
| `MEMBERS` — `MEMBER_QR_TOKENS` | One member to zero or many tokens; each token belongs to one member | Server DDL explicitly declares `member_id REFERENCES members(id) ON DELETE CASCADE` |

## Notes and unresolved schema questions

1. `ATTENDANCE` is polymorphic. The expected invariant is exactly one of
   `member_id` and `guest_id`, consistent with `user_type`; a check constraint
   or alternative schema is not evidenced here.
2. `members.archived_archive_id` is included because the archive/restore
   workflow writes and reads it. It is a logical pointer; no physical FK was
   found in the server's setup code.
3. `MEMBER_TRANSACTIONS.verified_by` is retained as an attribute but is not
   linked to `USERS`: the repository does not establish its meaning,
   nullability, or FK constraint.
4. `GUEST_TRANSACTIONS.guest_name` and `visit_type`, and the copied
   `ARCHIVED_MEMBERS` profile/membership fields, may be transaction-time or
   archive-time snapshots. They should not be interpreted as live copies
   without confirming the business rule.
5. Existing project documentation provides the legacy table column list;
   backend setup code explicitly defines only some constraints and selected
   support tables. A live catalog export is still needed to certify all
   physical keys, nullability, FKs, checks, indexes, and triggers.
