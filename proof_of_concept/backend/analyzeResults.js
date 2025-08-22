const fs = require('fs');

const testResults = JSON.parse(fs.readFileSync('testResults.json', 'utf8'));

const metricsToAnalyze = ["Fault Tolerance", "Scalability", "Realtime Latency", "Realtime Throughput", "Consistency"];
const consolidatedResults = {};
const bestDatabases = {};
const overallScores = {};

const metricWeights = {
  "Fault Tolerance": 0.20,
  "Scalability": 0.20,
  "Realtime Throughput": 0.15,
  "Realtime Latency": 0.15,
  "Consistency": 0.10
};

function normalizeLabel(label) {
  let location = "Onbekend";
  if (label.includes("Centralized")) {
    location = "Gebouw A";
  } else {
    location = "Gebouw B";
  }

  let name = "";

  // Cassandra
  if (label.includes("Cassandra ListPartitioning")) {
    name = "Cassandra (List-Based Partitioning)";
  } else if (label.includes("Cassandra RangePartitioning")) {
    name = "Cassandra (Range-Based Partitioning)";
  } else if (label.includes("Cassandra Centralized")) {
    name = "Cassandra Centralized";
  }

  // MongoDB
  else if (label.includes("MongoDB edge_list_partitioning")) {
    name = "MongoDB (List-Based Sharding)";
  } else if (label.includes("MongoDB edge_range_partitioning")) {
    name = "MongoDB (Range-Based Sharding)";
  } else if (label.includes("MongoDB ListPartitioning")) {
    name = "MongoDB (List-Based Sharding)";
  } else if (label.includes("MongoDB RangePartitioning")) {
    name = "MongoDB (Range-Based Sharding)"
  } else if (label.includes("MongoDB Centralized")) {
    name = "MongoDB Centralized";
  }

  // TimescaleDB
  else if (label.includes("TimescaleDB ListPartitioning")) {
    name = "TimescaleDB (List-Based Partitioning)";
  } else if (label.includes("TimescaleDB RangePartitioning")) {
    name = "TimescaleDB (Range-Based Partitioning)";
  } else if (label.includes("TimescaleDB Centralized")) {
    name = "TimescaleDB Centralized";
  }

  else {
    name = label;
  }

  return `${name} [${location}]`;
}

function consolidateResults() {
  const scalabilityData = {};

  testResults.forEach(({ metric, label, value }) => {
    if (!metricsToAnalyze.includes(metric)) return;

    const normalizedLabel = normalizeLabel(label);
    if (!consolidatedResults[normalizedLabel]) consolidatedResults[normalizedLabel] = {};
    consolidatedResults[normalizedLabel][metric] = parseFloat(value);
    
  });

  for (const dbKey in scalabilityData) {
    const values = scalabilityData[dbKey];
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    consolidatedResults[dbKey]["Scalability"] = parseFloat(avg.toFixed(2));
  }

  for (const dbKey in consolidatedResults) {
    for (const metric in consolidatedResults[dbKey]) {
      if (Array.isArray(consolidatedResults[dbKey][metric])) {
        const values = consolidatedResults[dbKey][metric];
        consolidatedResults[dbKey][metric] = values.length
          ? values.reduce((a, b) => a + b) / values.length
          : null;
      }
    }
  }
}

function isHigherBetter(metric) {
  const lowerIsBetter = ["latency"];
  return !lowerIsBetter.some(m => metric.toLowerCase().includes(m));
}

function determineBestByMetric() {
  metricsToAnalyze.forEach((metric) => {
    let bestDB = null;
    let bestScore = isHigherBetter(metric) ? -Infinity : Infinity;

    for (const dbKey in consolidatedResults) {
      const score = consolidatedResults[dbKey][metric];
      if (score != null && (
          (isHigherBetter(metric) && score > bestScore) ||
          (!isHigherBetter(metric) && score < bestScore)
        )) {
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
    const values = [];
    for (const dbKey in consolidatedResults) {
      const score = consolidatedResults[dbKey][metric];
      if (score != null) values.push(score);
    }
    if (values.length > 0) {
      minMaxValues[metric] = {
        min: Math.min(...values),
        max: Math.max(...values),
      };
    }
  });

  const totalWeight = metricsToAnalyze.reduce(
    (sum, metric) => sum + (metricWeights[metric] || 0),
    0
  );

  for (const dbKey in consolidatedResults) {
    let weightedTotal = metricsToAnalyze.reduce((total, metric) => {
      const weight = metricWeights[metric] || 0;
      const score = consolidatedResults[dbKey][metric];
      const minMax = minMaxValues[metric];
      if (score != null && minMax) {
        const { min, max } = minMax;
        let normalized;
        if (max === min) {
          normalized = 1;
        } else {
          const raw = (score - min) / (max - min);
          normalized = isHigherBetter(metric) ? raw : 1 - raw;
        }
        total += weight * normalized;
      }
      return total;
    }, 0);

    overallScores[dbKey] = totalWeight > 0 ? +(10 * (weightedTotal / totalWeight)).toFixed(2) : 0;
  }
}

consolidateResults();
determineBestByMetric();
calculateOverallScores();

const top3Databases = Object.entries(overallScores)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 3);

console.log("📊 Analysis Results:");
console.table(
  Object.entries(consolidatedResults).reduce((acc, [dbKey, data]) => {
    acc[dbKey] = metricsToAnalyze.reduce((obj, metric) => {
      obj[metric] = data[metric] ?? "-";
      return obj;
    }, {});
    return acc;
  }, {})
);

console.log("\n📈 Overall Scores per Database:");
console.table(
  Object.entries(overallScores).reduce((acc, [dbKey, score]) => {
    acc[dbKey] = { "Overall Score": score.toFixed(2) };
    return acc;
  }, {})
);

console.log("\n🏆 Best Databases by Metric:");
console.table(bestDatabases);

console.log("\n🥇 Top 3 Databases Overall:");
top3Databases.forEach(([db, score], index) => {
  console.log(`${index + 1}. ${db} with a score of ${score.toFixed(2)}`);
});