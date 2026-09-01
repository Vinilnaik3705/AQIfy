from backend.simulation import get_sources_for_city, CITIES
seen = set()
dups = []
total = 0
for city in CITIES:
    for s in get_sources_for_city(city):
        total += 1
        key = f"{s.get('city_key') or city}-{s.get('id')}"
        if key in seen:
            dups.append(key)
        seen.add(key)
print("total_sources", total)
print("duplicate_keys", len(dups))
print("sample_duplicates", dups[:5])
