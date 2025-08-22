# Edge Monitoring Backend

Dit project bevat de backend van de bachelorproef voor het Edge Monitoring System. Het backendproject verzorgt API-endpoints en scripts om testdata in te voegen en resultaten te analyseren in MongoDB, Cassandra en TimescaleDB.

## Vereisten

- Node.js (v18 of hoger aanbevolen)
- Docker en Docker Compose
- ASP.NET Core runtime voor de backend (`dotnet` CLI)

## Installatie

1. Clone dit repository of download de bestanden naar je lokale machine.
2. Installeer de Node.js-dependencies:

```bash
npm install
```

## Installatie

1. **Project dependencies installeren**
```bash
npm install
```

2. **Docker containers starten**
```bash
docker-compose --profile default up -d
```
> **Opmerking:** Wacht ongeveer 1 tot 2 minuten zodat alle containers volledig opgestart zijn.

3. **Databases initialiseren**
```bash
npm run init
```
> **Belangrijk:** Voer dit uit **nadat Docker volledig is opgestart**, anders kunnen de scripts mislukken.

4. **Testdata injecteren**
Kies één van de inject-scripts om data in de databases te zetten:
```bash
npm run inject       # Standaard testdata
npm run testdata     # Vaste testdata voor consistente metingen
npm run realtime     # Realtime simulatie van sensordata
```

5. **Backend starten**
```bash
dotnet run
```
De backend luistert standaard op `http://localhost:5001`.

6. **Analyse en grafieken (optioneel)**
```bash
npm run analyze      # Analyseert resultaten en genereert statistieken
npm run test         # Voert proof-of-concept tests uit
npm run chart        # Genereert grafieken van de testresultaten
```

## Beschikbare scripts

| Script | Omschrijving |
|--------|--------------|
| `npm run init` | Initialiseert de databases (`initDatabases.js`). Voer dit pas uit nadat Docker volledig is opgestart. |
| `npm run inject` | Injecteert standaard testdata (`InsertSensorData.js`). |
| `npm run testdata` | Injecteert vaste testdata (`--fixed`). |
| `npm run realtime` | Start realtime simulatie van sensordata (`--realtime`). |
| `npm run analyze` | Analyseert resultaten en genereert statistieken (`analyzeResults.js`). |
| `npm run test` | Voert proof-of-concept tests uit (`POCTests.js`). |
| `npm run chart` | Genereert grafieken van de testresultaten (`generateCharts.js`). |

## Opmerkingen
- Zorg dat je Docker en de backend hebt gestart voordat je `init`, `inject` of `test` scripts uitvoert.
- Het systeem is getest met de volgende databaseconfiguraties:
  - MongoDB (centraal & sharded)
  - Cassandra (centraal & gepartitioneerd)
  - TimescaleDB (centraal & gepartitioneerd)