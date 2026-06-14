# FundFlow Mock API

Money-movement mock API for the QA Evergreen **steel thread**. Synthetic data
only — no real accounts, names, or card data. State lives in memory, is seeded
from `../shared/fixtures.json` at startup, and is resettable via
`POST /api/reset`.

Both front-ends call this same API:

- React dev server — `http://localhost:5173`
- Angular dev server — `http://localhost:4200`

CORS is enabled for both origins, allowing the `Authorization` and
`Content-Type` headers.

## Run

```bash
npm install
npm start          # node server.js
```

The server listens on **http://localhost:4000**.

## Auth model

- `POST /api/login` returns an opaque token of the form `tok_<username>`.
- All other `/api/*` endpoints (except `/api/login` and `/api/reset`) require
  `Authorization: Bearer <token>`. Any non-empty token that maps back to a
  known user is accepted; missing/empty/unknown tokens get a `401`.

## Seed data (from fixtures)

| username     | password   | role       | approvalLimit |
| ------------ | ---------- | ---------- | ------------- |
| `analyst`    | `demo1234` | analyst    | `10000`       |
| `supervisor` | `demo1234` | supervisor | `null`        |

Accounts: `ACC-1001` Operating (50000), `ACC-1002` Payroll (12500),
`ACC-1003` Reserve (250000).
Payees: `PAYEE-9001` Acme Supplies, `PAYEE-9002` Globex Payroll,
`PAYEE-9003` Initech Services.

## Endpoints

| Method | Path                  | Auth   | Description                                  |
| ------ | --------------------- | ------ | -------------------------------------------- |
| GET    | `/health`             | no     | `{ ok: true }`                               |
| GET    | `/openapi.yaml`       | no     | Raw OpenAPI contract                         |
| POST   | `/api/reset`          | no     | Reload fixtures, returns `204` (test hook)   |
| POST   | `/api/login`          | no     | `{ token, role, displayName, approvalLimit }`|
| GET    | `/api/accounts`       | bearer | `[{ id, name, balance }]`                    |
| GET    | `/api/payees`         | bearer | `[{ id, name }]`                             |
| POST   | `/api/transfers`      | bearer | Create a transfer, returns `201` Receipt     |
| GET    | `/api/transfers/{id}` | bearer | Stored Receipt, or `404`                     |

### Transfer business rules

`POST /api/transfers` body: `{ fromAccountId, payeeId, amount, memo }`.
Rules are checked **in this order**, each returning HTTP `422`:

1. `amount` missing / not a positive finite number →
   `INVALID_AMOUNT` — "Enter a valid amount greater than zero"
2. role is `analyst` and `amount > approvalLimit` (10000) →
   `OVER_APPROVAL_LIMIT` — "Amount exceeds your approval limit of $10,000"
3. `amount > fromAccount.balance` →
   `INSUFFICIENT_FUNDS` — "Amount exceeds available balance"

On success: debits the from-account, mints `transactionId` (`TXN-<5 digits>`),
stores the receipt, appends to recent activity, and returns `201` with the
Receipt `{ transactionId, status: "completed", fromAccountId, payeeId, amount,
memo, newBalance }`.

## Example curl calls

### Login as analyst

```bash
curl -s -X POST http://localhost:4000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"analyst","password":"demo1234"}'
# { "token":"tok_analyst", "role":"analyst", "displayName":"Avery Analyst", "approvalLimit":10000 }
```

Capture the token for the calls below:

```bash
TOKEN=tok_analyst
```

### List accounts

```bash
curl -s http://localhost:4000/api/accounts -H "Authorization: Bearer $TOKEN"
# [ { "id":"ACC-1001","name":"Operating","balance":50000 }, ... ]
```

### Successful transfer

```bash
curl -s -X POST http://localhost:4000/api/transfers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fromAccountId":"ACC-1001","payeeId":"PAYEE-9001","amount":1500,"memo":"Invoice 42"}'
# 201
# { "transactionId":"TXN-#####","status":"completed","fromAccountId":"ACC-1001",
#   "payeeId":"PAYEE-9001","amount":1500,"memo":"Invoice 42","newBalance":48500 }
```

### 422 case 1 — INVALID_AMOUNT

```bash
curl -s -X POST http://localhost:4000/api/transfers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fromAccountId":"ACC-1001","payeeId":"PAYEE-9001","amount":0}'
# 422  { "code":"INVALID_AMOUNT","message":"Enter a valid amount greater than zero" }
```

### 422 case 2 — OVER_APPROVAL_LIMIT (analyst only)

```bash
curl -s -X POST http://localhost:4000/api/transfers \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"fromAccountId":"ACC-1003","payeeId":"PAYEE-9001","amount":20000}'
# 422  { "code":"OVER_APPROVAL_LIMIT","message":"Amount exceeds your approval limit of $10,000" }
```

(Supervisors have a `null` limit and skip this check; sign in as
`supervisor` / `demo1234` to move larger amounts.)

### 422 case 3 — INSUFFICIENT_FUNDS

```bash
# Payroll holds 12500; ask for more than that (but under the analyst limit
# would still trip funds — use the supervisor to isolate this case, or pick an
# amount <= 10000 that still exceeds a small balance).
curl -s -X POST http://localhost:4000/api/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"supervisor","password":"demo1234"}'
SUP=tok_supervisor

curl -s -X POST http://localhost:4000/api/transfers \
  -H "Authorization: Bearer $SUP" -H 'Content-Type: application/json' \
  -d '{"fromAccountId":"ACC-1002","payeeId":"PAYEE-9002","amount":99999}'
# 422  { "code":"INSUFFICIENT_FUNDS","message":"Amount exceeds available balance" }
```

### Fetch a receipt

```bash
curl -s http://localhost:4000/api/transfers/TXN-12345 -H "Authorization: Bearer $TOKEN"
# 200 Receipt, or 404 { "code":"NOT_FOUND","message":"Transfer not found" }
```

### Reset state (test hook)

```bash
curl -s -X POST http://localhost:4000/api/reset -o /dev/null -w '%{http_code}\n'
# 204
```
