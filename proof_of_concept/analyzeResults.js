const fs = require('fs');

// Load test results
const testResults = JSON.parse(fs.readFileSync('testResults.json', 'utf8'));

const metricsToAnalyze = ["Latency", "Throughput", "Scalability", "Consistency", "Fault Tolerance", "Network Load Latency", "Edge Performance"];
const consolidatedResults = {};
const bestDatabases = {};
const overallScores = {};
const metricWeights = {
  "Latency": 0.25,                 // Cruciaal voor real-time edge computing.
  "Edge Performance": 0.25,        // Belangrijk voor lokale verwerking en beveiliging.
  "Fault Tolerance": 0.20,         // Essentieel voor het waarborgen van systeemresistentie.
  "Scalability": 0.15,             // Nodig voor het omgaan met groei.
  "Throughput": 0.10,              // Nuttig, maar minder belangrijk dan latentie.
  "Consistency": 0.05,             // Lagere prioriteit voor edge-specifieke workloads.
  "Network Load Latency": 0.00     // Verlaagd voor onderhoudbaarheid/compatibiliteit.
};


// Normalize database labels
function normalizeLabel(label) {
  if (label.includes("Consistent Hashing")) return "Cassandra (Consistent Hashing)";
  if (label.includes("Cassandra Range-Based Partitioning")) return "Alternative Cassandra (Range-Based Partitioning)";
  if (label.includes("Hash-Based Sharding")) return "MongoDB (Hash-Based Sharding)";
  if (label.includes("Range-Based Sharding")) return "MongoDB (Range-Based Sharding)";
  if (label.includes("List-Based Partitioning")) return "Alternative TimescaleDB (List-Based Partitioning)";
  if (label.includes("TimescaleDB Range-Based Partitioning")) return "TimescaleDB (Range-Based Partitioning)";
  if (label.includes("Cassandra Centralized")) return "Cassandra Centralized";
  if (label.includes("TimescaleDB Centralized")) return "TimescaleDB Centralized";
  if (label.includes("MongoDB Centralized")) return "MongoDB Centralized";
  return label;
}

function consolidateResults() {
  const scalabilityData = {};

  testResults.forEach(({ metric, label, value }) => {
    const normalizedLabel = normalizeLabel(label);
    if (!consolidatedResults[normalizedLabel]) consolidatedResults[normalizedLabel] = {};
    if (!consolidatedResults[normalizedLabel][metric]) consolidatedResults[normalizedLabel][metric] = metric === "Scalability" || metric === "Fault Tolerance" ? [] : null;

    if (metric === "Fault Tolerance") {
      consolidatedResults[normalizedLabel][metric].push(value === "Success" ? 1 : 0);
    } else if (metric === "Scalability" && !isNaN(parseFloat(value))) {
      if (!scalabilityData[normalizedLabel]) scalabilityData[normalizedLabel] = [];
      scalabilityData[normalizedLabel].push(parseFloat(value));
    } else if (metric !== "Scalability") {
      consolidatedResults[normalizedLabel][metric] = parseFloat(value);
    }
  });

  for (const dbKey in scalabilityData) {
    const values = scalabilityData[dbKey];
    const averageValue = values.reduce((a, b) => a + b, 0) / values.length;
    consolidatedResults[dbKey]["Scalability"] = parseFloat(averageValue.toFixed(2));
  }

  for (const dbKey in consolidatedResults) {
    for (const metric in consolidatedResults[dbKey]) {
      if (Array.isArray(consolidatedResults[dbKey][metric])) {
        const values = consolidatedResults[dbKey][metric];
        consolidatedResults[dbKey][metric] = values.length ? (values.reduce((a, b) => a + b) / values.length) : null;
      }
    }
  }
}

function determineBestByMetric() {
  metricsToAnalyze.forEach((metric) => {
    if (metric === "Fault Tolerance") return; 
    
    let bestDB = null;
    let bestScore = metric === "Throughput" ? -Infinity : Infinity;

    for (const dbKey in consolidatedResults) {
      const score = consolidatedResults[dbKey][metric];
      if (score != null && ((metric === "Throughput" && score > bestScore) || (metric !== "Throughput" && score < bestScore))) {
        bestDB = dbKey;
        bestScore = score;
      }
    }

    bestDatabases[metric] = { database: bestDB, score: bestScore };
  });
}

function calculateOverallScores() {
  const minMaxValues = {};

  metricsToAnalyze.forEach((metric) => {
    let values = [];
    for (const dbKey in consolidatedResults) {
      const score = consolidatedResults[dbKey][metric];
      if (score != null) values.push(score);
    }
    if (values.length > 0) {
      minMaxValues[metric] = { min: Math.min(...values), max: Math.max(...values) };
    }
  });

  for (const dbKey in consolidatedResults) {
    overallScores[dbKey] = metricsToAnalyze.reduce((total, metric) => {
      const weight = metricWeights[metric] || 0;
      const score = consolidatedResults[dbKey][metric];
      if (score != null && minMaxValues[metric]) {
        const { min, max } = minMaxValues[metric];
        const normalizedScore = max === min ? 1 : (score - min) / (max - min);
        total += weight * normalizedScore;
      }
      return total;
    }, 0);
  }
}

consolidateResults();
determineBestByMetric();
calculateOverallScores();

const top3Databases = Object.entries(overallScores)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3);

console.log("Analysis Results:");
console.table(
  Object.entries(consolidatedResults).reduce((acc, [dbKey, data]) => {
    acc[dbKey] = metricsToAnalyze.reduce((obj, metric) => {
      obj[metric] = data[metric] ?? "-";
      return obj;
    }, {});
    return acc;
  }, {})
);

console.log("\nBest Databases by Metric:");
console.table(bestDatabases);

console.log("\nTop 3 Databases:");
top3Databases.forEach(([db, score], index) => {
  console.log(`${index + 1}. ${db} with a score of ${score.toFixed(2)}`);
});