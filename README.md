# Sky

A sleek weather metasearch front-end with selectable providers, local proxy routes, and light/dark mode.

## Providers

- **Open-Meteo** — no API key. Direct browser request for current + 7-day forecast.
- **wttr.in** — public JSON endpoint, proxied locally to avoid browser CORS issues.
- **MET Norway** — global Locationforecast API, proxied locally so a custom `User-Agent` can be supplied.
- **WeatherAPI.com** — optional API key; free plan exists. Key is entered in the Settings panel and stored in browser local storage.
- **OpenWeather** — optional API key; local proxy route included.

### MET Norway identification

MET Norway asks clients to identify themselves with a descriptive `User-Agent`. The server defaults to `WeatherMetaSearch/1.0 https://localhost/`. For a real deployment, set a meaningful value, for example:

```bash
MET_USER_AGENT="WeatherMetaSearch/1.0 https://your-site.example contact@example.com" npm run dev
```

### Notes

This project deliberately uses public APIs instead of scraping Google's or other consumer-weather pages. Consumer weather sites often change their markup, use JavaScript rendering, and/or restrict automated access. The server includes a small HTML scraping helper and the architecture is ready for future source-specific adapters when a site's terms permit it.
