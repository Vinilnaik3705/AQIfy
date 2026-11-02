# 01. Overall system architecture

## Diagram

```mermaid
flowchart LR
    classDef client fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e,stroke-width:2px
    classDef api fill:#ede9fe,stroke:#7c3aed,color:#4c1d95,stroke-width:2px
    classDef engine fill:#dcfce7,stroke:#16a34a,color:#14532d,stroke-width:2px
    classDef store fill:#fef3c7,stroke:#d97706,color:#78350f,stroke-width:2px
    classDef external fill:#f1f5f9,stroke:#64748b,color:#1e293b,stroke-width:2px

    Browser["Browser\nReact dashboard"] --> Vercel["Vercel\nstatic frontend"]
    Vercel -->|"/api and /ws rewrites"| API["FastAPI\nRender · 1 Uvicorn worker"]

    subgraph App["Application services"]
        Routes["Routes\nstate · forecast · auth\nagents · alerts · interventions"]
        Simulation["Simulation engine\nAQI · spatial state · fallbacks"]
        Forecaster["Forecaster\nGBM horizons · uncertainty"]
        Agents["Four agents\nattribution · predictive\nenforcement · advisory"]
        Alerts["Alert loop\nthresholds · guidance · email"]
    end

    API --> Routes
    Routes --> Simulation
    Routes --> Forecaster
    Routes --> Agents
    Routes --> Alerts
    Agents --> Simulation
    Agents --> Forecaster

    subgraph Data["Durable and transient data"]
        DB[("SQL database\nPostgreSQL / local SQLite")]
        Redis[("Optional Redis\ncache + rate limits")]
        Models[("model_cache\ncity.joblib bundles")]
    end

    Routes --> DB
    Routes --> Redis
    Alerts --> DB
    Alerts --> Redis
    Forecaster --> Models

    subgraph External["External providers"]
        AQ["WAQI → CAMS\n→ OpenWeather → OpenAQ"]
        Weather["WeatherAPI /\nOpen-Meteo weather"]
        Gemini["Gemini\noptional guidance"]
        Email["Brevo / SMTP /\nResend email"]
    end

    Simulation --> AQ
    Simulation --> Weather
    Forecaster --> AQ
    Forecaster --> Weather
    Alerts --> Gemini
    Alerts --> Email

    class Browser,Vercel client
    class API,Routes api
    class Simulation,Forecaster,Agents,Alerts engine
    class DB,Redis,Models store
    class AQ,Weather,Gemini,Email external
```

## Why each component exists

- **React/Vercel:** presents the map, forecasts, advisory widgets, and enforcement console. The frontend API helper sends cookies with requests and coalesces duplicate GETs.
- **FastAPI:** centralizes route registration, CORS, security headers, lifecycle startup/shutdown, and the public API.
- **Simulation engine:** normalizes external readings, calculates Indian AQI, builds city/ward state, and supplies spatial context.
- **Forecaster:** fetches historical and future inputs, trains direct-horizon models, and produces hourly forecast grids.
- **Agents:** separate analysis responsibilities so source explanation, prediction, enforcement, and citizen communication can evolve independently.
- **SQL database:** durable users, roles, locations, readings/forecasts, subscriptions, alerts, inspectors, and intervention records.
- **Redis:** an optional accelerator. A failed ping causes cache/rate-limit helpers to fail open, so Redis is not a hard runtime dependency.
- **Joblib model cache:** avoids retraining every request and lets evicted in-memory city models be reloaded or retrained.
- **Single Render worker:** avoids multiplying model memory and training work; CPU-bound fitting is bounded by a one-worker executor.

## Request-level mental model

1. The browser calls a route through Vercel’s rewrite.
2. FastAPI authenticates only where the route requires it.
3. The route reads Redis if applicable, then calls a singleton simulation/forecaster/agent service.
4. External data is normalized and returned with source, confidence, and fallback metadata where relevant.
5. Durable workflow changes are committed to SQL; transient state stays in caches.
