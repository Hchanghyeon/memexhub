# Home (Home Assistant)

memexhub reads Home Assistant (read-only) so Claude can see what is going on at home and what happened on a day. It never calls services: no light, lock or switch can be changed through memexhub.

1. In Home Assistant: your profile → Security → **Long-lived access tokens** → create one.
2. Admin UI → Connections → **Home Assistant**: the address (e.g. `http://192.168.0.10:8123`), the token, and "on my home network".
3. Optional: **entities for the daily summary**, comma separated: e.g. `person.me, binary_sensor.front_door`. Their logbook goes into `day_summary`.

Tools: `home_states` (current states, filter by text), `home_day` (the logbook of a day, optionally one entity).
