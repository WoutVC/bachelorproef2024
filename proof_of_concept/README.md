# Proof of Concept - README

Deze Proof of Concept (PoC) simuleert en analyseert de prestaties van verschillende databases in een Edge Computing-omgeving. De stappen hieronder leggen uit hoe je de PoC kunt uitvoeren, van het opstarten van de omgeving tot het analyseren van de resultaten.

## Stappen om de PoC uit te voeren

1. **Start de Docker-omgeving**  
   Gebruik het volgende commando om de benodigde containers op te starten:  
   ```bash
   docker-compose up -d
   ```
   Dit zorgt ervoor dat de databases worden gestart in een gecontaineriseerde omgeving.

2. **Voeg testdata toe aan de databases**  
   Voer het script uit om gesynthetiseerde data in de databases te laden:  
   ```bash
   node AddFakeDataToDatabase.js
   ```
   Dit script gebruikt de Faker.js-bibliotheek om realistische testdata te genereren en in te voegen.

3. **Voer de Proof of Concept tests uit**  
   Start de tests die verschillende metrieken zoals latentie, throughput en schaalbaarheid meten:  
   ```bash
   node POCTests.js
   ```
   De resultaten van deze tests worden opgeslagen in een JSON-bestand.

4. **Genereer grafieken van de testresultaten**  
   Gebruik dit script om de testresultaten te visualiseren in grafieken:  
   ```bash
   node generateCharts.js
   ```
   De grafieken worden opgeslagen in een aparte map, klaar om te worden gebruikt in rapporten of presentaties.

5. **Analyseer de resultaten**  
   Voer de analyse uit op de verzamelde testdata om conclusies te trekken over de prestaties:  
   ```bash
   node analyzeResults.js
   ```
   Dit script genereert een overzicht van de beste presterende databases en technieken.

## Vereisten

- **Docker**: Zorg ervoor dat Docker en Docker Compose zijn geïnstalleerd.
- **Node.js**: Versie 14 of hoger.
- **Bibliotheken**: Installeer de benodigde Node.js-pakketten met:  
  ```bash
  npm install
  ```

## Resultaten

- Het script `analyzeResults.js` genereert een geaggregeerd overzicht van de databaseprestaties.

Met deze PoC kun je eenvoudig inzicht krijgen in de prestaties van verschillende databases en partitioneringstechnieken in een Edge Computing-omgeving.