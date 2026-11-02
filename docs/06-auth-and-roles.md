# 06. Authentication and RBAC

## Diagram

```mermaid
sequenceDiagram
    participant Client as React client
    participant API as FastAPI auth route
    participant Redis as Optional Redis rate limiter
    participant DB as SQL database
    participant Route as Protected route

    Client->>API: POST /api/auth/register or /login
    API->>Redis: Rate-limit auth request
    API->>DB: Find/create user and role
    API->>API: Verify/hash password and create JWT
    API-->>Client: Set HttpOnly aqify_session cookie

    Client->>Route: Request with cookie
    Route->>API: get_current_user()
    API->>API: Prefer cookie over bearer compatibility fallback
    API->>API: Decode signature, iat, exp, subject
    API->>DB: Load active user by subject
    DB-->>API: Current role from database
    API->>API: require_roles() checks current DB role
    alt allowed
        Route-->>Client: Protected response
    else denied
        Route-->>Client: 401 or 403
    end
```

## Authentication behavior

- Passwords are hashed with Passlib (`pbkdf2_sha256`, with bcrypt compatibility).
- JWTs use HS256, contain `sub`, `role`, `iat`, and `exp`, and default to 120 minutes.
- The token is stored in the `aqify_session` cookie with `HttpOnly`; production also uses `Secure` and `SameSite=None` because the frontend and backend are separate origins.
- `get_current_user` prefers the cookie. An `Authorization: Bearer` token remains supported for older clients.
- The role claim is not trusted for authorization by itself. The user is reloaded from SQL and `require_roles` checks the current relationship to `Role` on every protected request.
- Public registration can create **Citizen** only. Elevated roles are provisioned by an admin or reserved environment-configured accounts.

## Role matrix

| Capability | Citizen | Inspector | Authority | Admin |
|---|:---:|:---:|:---:|:---:|
| Register/login/profile | ✓ | ✓ | ✓ | ✓ |
| Public state, forecasts, advisory, alerts | ✓ | ✓ | ✓ | ✓ |
| View enforcement dashboard |  | ✓ | ✓ | ✓ |
| Run `/api/agents/dispatch` |  | ✓ | ✓ | ✓ |
| Create location/intervention |  |  | ✓ | ✓ |
| Dispatch inspector |  |  |  | ✓ |
| Manage roles/users |  |  |  | ✓ |
| Update assigned intervention |  | Own assignment | ✓ | ✓ |
| Add findings/outcome |  | Own assignment | ✓ | ✓ |
| Clear caches |  |  |  | ✓ |

## Cookie versus bearer token

The HttpOnly cookie is the default for the browser because JavaScript cannot read it, reducing exposure to token theft through ordinary local-storage access. `credentials: include` and explicit production CORS are required. The bearer fallback is useful for scripts and older clients, but it must be treated like any other bearer secret and sent only over HTTPS.
