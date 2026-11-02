# 09. Database and persistence

## ER diagram

```mermaid
erDiagram
    ROLE ||--o{ USER : grants
    USER ||--o| INSPECTOR : has_profile
    USER ||--o{ ALERT_SUBSCRIPTION : owns
    USER ||--o{ ALERT : receives
    LOCATION ||--o{ ALERT_SUBSCRIPTION : targets
    LOCATION ||--o{ ALERT : triggers
    LOCATION ||--o{ INSPECTOR : scopes
    LOCATION ||--o{ INTERVENTION : concerns
    INSPECTOR ||--o{ INTERVENTION : assigned_to
    INTERVENTION ||--o{ INVESTIGATION_FINDING : has
    INSPECTOR ||--o{ INVESTIGATION_FINDING : writes
    INTERVENTION ||--o| INTERVENTION_OUTCOME : resolves_to

    ROLE {
        int id PK
        string name UK
    }
    USER {
        int id PK
        string email UK
        int role_id FK
    }
    LOCATION {
        int id PK
        string city_key
        string name
        float latitude
        float longitude
    }
    ALERT_SUBSCRIPTION {
        int id PK
        int user_id FK
        int location_id FK
        string ward_id
        string email
        string profile
        boolean confirmed
        string lang
    }
    ALERT {
        int id PK
        int user_id FK
        int location_id FK
        string alert_type
        float aqi_value
    }
    INSPECTOR {
        int id PK
        int user_id FK,UK
        int location_id FK
        string specialty
    }
    INTERVENTION {
        int id PK
        int location_id FK
        int assigned_inspector_id FK
        float aqi
        string severity
        string status
        float priority_score
    }
    INVESTIGATION_FINDING {
        int id PK
        int intervention_id FK
        int inspector_id FK
        string findings
    }
    INTERVENTION_OUTCOME {
        int id PK
        int intervention_id FK,UK
        float aqi_before
        float aqi_after
        float change_pct
        string intervention_type
        datetime resolution_date
    }
```

## Modeling notes

- `Location` is the shared geographic parent for subscriptions, alerts, inspectors, and interventions.
- `AlertSubscription` supports both authenticated user/location subscriptions and public email/ward subscriptions; `user_id` and `location_id` are nullable in the current model.
- `InterventionOutcome` is one-to-one with `Intervention`; multiple `InvestigationFinding` rows are allowed.
- Constraints protect AQI ranges, valid coordinates, and intervention priority values.
- In local development, `backend/core/database.py` defaults to `backend/aqify.db`; deployment should use `DATABASE_URL`. `init_db()` calls `create_all`, removes retired reading/forecast tables, and contains a SQLite compatibility shim.

## Active tables

The active schema is `roles`, `users`, `locations`, `alert_subscriptions`, `inspectors`,
`interventions`, `investigation_findings`, `intervention_outcomes`, and optional `alerts`.
AQI readings and forecasts are fetched or computed on demand and are not persisted.
