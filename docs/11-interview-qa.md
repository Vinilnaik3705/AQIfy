# 11. Interview Q&A

Use these as short first answers. Expand with the diagrams when asked to draw the design.

## Architecture and product

### 1. What problem does AQIfy solve?

It closes the loop from an AQI signal to likely source, forecast, prioritized enforcement, and citizen guidance. The important output is an actionable work queue, not just a map.

### 2. Who are the users?

Citizens receive local guidance and alerts. Inspectors execute assigned work. Authorities review and create interventions. Admins manage roles and dispatch inspectors.

### 3. Walk me through the architecture.

React on Vercel calls FastAPI on Render through rewrites. FastAPI routes to the simulation engine, forecaster, agents, and SQL persistence; optional Redis accelerates transient reads. External AQ, weather, Gemini, and email services are behind service boundaries.

### 4. Why is the simulation engine separate from the forecaster?

The simulation engine owns spatial state, provider normalization, AQI calculation, and intervention effects. The forecaster owns historical features, model training, inference, evaluation, and persisted model bundles. That separation lets live data remain available while ML training is slow or unavailable.

### 5. What is real and what is simulated?

Provider readings and weather are real when a provider succeeds. Emission inventories, mitigation effects, and `/api/state` vulnerability counts are planning/demo data. The code labels synthetic vulnerability metadata and forecast/model source information.

### 6. Is the dashboard real time?

It refreshes `/api/state` by browser polling every 30 seconds, paused for hidden tabs. A WebSocket endpoint exists, but the current `App.jsx` does not use it for dashboard refresh, so I would not claim push-based real time.

## Data and reliability

### 7. What is the AQI source order?

Executable order is WAQI/CPCB, Open-Meteo CAMS, OpenWeather, then OpenAQ. If all fail, the caller uses a model-derived or safe fallback. The function docstring has a stale OpenWeather/CAMS ordering, so I follow the code path.

### 8. Why multiple providers?

WAQI gives the best nearby ground-station signal when available. CAMS provides broad modeled coverage. OpenWeather and OpenAQ provide independent fallbacks. A provider outage should degrade freshness or fidelity rather than take down the API.

### 9. How do you handle provider rate limits?

Use connection pooling, bounded timeouts, local/Redis caching, batched Open-Meteo calls, route-level in-flight coalescing, and background training deduplication. Redis-backed rate limiting protects selected endpoints, although the current fail-open behavior trades protection for availability when Redis is down.

### 10. What if Redis is down?

The Redis helper returns misses and the route rebuilds data. Rate limiting also allows requests through. Local request coalescing and the model cache continue within the one process, but cross-instance sharing and Redis rate-limit protection are lost.

### 11. What happens if an external API is slow?

HTTPX uses separate connect/read/write/pool timeouts. The service catches provider failures and falls through to the next source or an application fallback. The response should expose a source/model label so the UI can distinguish degraded output.

### 12. Why label data quality?

Because a deterministic synthetic value can look authoritative. The `synthetic_demo` marker makes it possible for an operator or interviewer to distinguish demo vulnerability metadata from a measured population or facility dataset.

## Forecasting

### 13. Why GBM and not LSTM?

The current data is tabular with engineered lags, weather, and calendar interactions, and the service has a constrained CPU/memory budget. GBM is strong for nonlinear tabular data, quicker to retrain, easier to evaluate, and simpler to operate than an LSTM.

### 14. Why predict deltas instead of AQI directly?

The delta target focuses learning on movement from the current anchor. It makes persistence a natural baseline, adapts to the latest observed level, and lets weather and rush-hour interactions explain changes.

### 15. Which horizons are trained?

Six direct models are trained at 6, 12, 24, 36, 48, and 72 hours. PCHIP interpolation creates an hourly output grid between those anchor predictions.

### 16. What features are used?

AQI lags and momentum, rolling statistics, city baseline, horizon, future weather, wind direction sine/cosine, rain washout, stagnation and ventilation proxies, calendar/rush-hour flags, and interactions such as rush × baseline.

### 17. How do you quantify uncertainty?

Two quantile GBMs estimate the 10th and 90th percentile deltas. Those are added to the current AQI and interpolated alongside the point forecast. Bounds are ordered and clamped to the valid AQI range.

### 18. How do you evaluate skill?

Walk-forward expanding windows preserve temporal order. I report ML MAE, persistence MAE, directional accuracy, residual standard deviation, and `1 - ML_MAE / persistence_MAE` as skill score.

### 19. Why walk-forward cross-validation?

Random shuffling would let future patterns leak into training and produce an overly optimistic score. Expanding windows simulate retraining on the past and validating on the next period.

### 20. How do you stop implausible forecasts?

Deltas are limited using historical standard deviation and horizon scaling. AQI is clamped to 0–500, Open-Meteo is blended with a capped weight, and hour-to-hour changes are capped before returning the grid.

### 21. What if the model is missing at request time?

The API schedules non-blocking training and returns an Open-Meteo-derived forecast if inputs exist. If not, it returns a labeled simple fallback. This keeps first-load latency independent of model training completion.

### 22. How is training isolated?

The event loop schedules training through `run_in_executor` with a one-worker `ThreadPoolExecutor`. The same-city in-flight set prevents duplicate fits, and the single Render worker avoids multiplying model memory across Uvicorn processes.

### 23. What does the anomaly check mean?

If current actual AQI differs from the first forecast point by more than twice the residual standard deviation, the route adds an anomaly. A deviation above three standard deviations is marked critical. The possible cause is a hypothesis, not a diagnosis.

## Agents and interventions

### 24. How does attribution work?

It finds the nearest reading, applies inverse-distance weighting to known sources within 10 km, and boosts categories based on pollutant signatures. It returns percentages, confidence, nearby sources, atmospheric conditions, and a narrative.

### 25. What do NO₂ and CO indicate?

The current heuristic treats high NO₂ or CO as a vehicular signal. It is a useful planning prior, not proof, because those pollutants also have other combustion sources.

### 26. What does SO₂ indicate?

High SO₂ or a PM2.5 plus SO₂ combination boosts industrial attribution, reflecting combustion and stack-emission patterns.

### 27. How do PM ratios help?

A high PM10/PM2.5 ratio points toward construction or road dust; a high PM2.5/PM10 ratio with high PM2.5 points toward fine-particle burning. Ratios are heuristics and should be validated with field data.

### 28. How is enforcement priority scored?

Hotspots start at AQI and receive multipliers for wards with at least three hospitals, five schools, or 15% elderly population. The score ranks response priority; it is not a probability of violation.

### 29. What does an evidence package contain?

AQI, pollutants, timestamp, coordinates, dominant pollutant, inferred sources, nearby source metadata, vulnerability flags, and generated recommendations with responsible department and timing context.

### 30. How does a recommendation become work?

The agent returns a recommendation first. An Admin dispatch endpoint persists it as an assigned intervention and links it to an inspector. The inspector can investigate, add findings, and submit before/after AQI for resolution.

### 31. Is attribution regulatory-grade?

No. It is evidence-weighted, spatially weighted planning intelligence. Regulatory source apportionment would require validated inventories, dispersion/chemical transport modeling, and calibrated ground observations.

## Auth, alerts, and operations

### 32. How does RBAC stay current?

JWT identity supplies the user ID, then every protected request loads the active user and role from the database. `require_roles` compares that current role with the route’s allowed roles, so changing a role takes effect without trusting a stale role claim.

### 33. Why an HttpOnly cookie?

It keeps the browser session token inaccessible to JavaScript and is sent automatically with `credentials: include`. Production uses Secure/SameSite settings and explicit CORS. A bearer fallback remains for compatibility.

### 34. What are the alert thresholds?

Asthma 50, sensitive/elderly/outdoor worker 100, and healthy adult 150 AQI. The loop also suppresses repeated alerts unless AQI changes by more than 10 points.

### 35. Is the alert flow truly double opt-in?

Not currently. A confirmation endpoint and token exist, but the public subscribe route sets `confirmed=True` immediately. I would fix that by storing pending state, sending a confirmation link, and activating only from the confirmation endpoint.

### 36. What if Gemini is unavailable?

The guidance service uses static profile- and AQI-bracket precautions and a translation fallback. The product still returns useful guidance without an LLM key.

### 37. How do you handle email provider failure?

Try Brevo, then SMTP, then Resend. If all fail, the alert is counted as failed and will be retried on the next loop because the last-alerted marker advances only after a successful send.

### 38. What are the biggest limitations?

Synthetic vulnerability metadata, fallback/model-derived measurements, heuristic attribution, one-process scaling assumptions, no strict intervention transition enforcement, auto-confirmed subscriptions, and stale documentation in the README. I would state those before presenting the demo.

### 39. What would you build next?

Replace synthetic vulnerability and source inventory inputs with governed datasets, add provider freshness/lineage monitoring, enforce alert double opt-in, move background work to a durable queue, add distributed locks, and evaluate models by city/station and season with calibrated interval coverage.

### 40. What security issue should be checked before sharing the project?

Inspect `.env` and Git history for exposed provider keys, SMTP credentials, and default passwords. Rotate anything that may have been real, remove secrets from tracked history using the repository’s approved process, and use environment-managed secrets in deployment.
