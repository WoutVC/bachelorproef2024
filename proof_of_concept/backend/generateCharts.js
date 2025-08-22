const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');

const width = 800;
const height = 600;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

const resultsFile = path.join(__dirname, 'testResults.json');
const outputDir = path.join(__dirname, 'charts');
const testResults = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const isNumeric = (value) => !isNaN(parseFloat(value)) && isFinite(value);

const normalizeLabel = (label) => {
  let location = label.includes("Centralized") ? "Gebouw A" : "Gebouw B";
  let name = "";

  if (label.includes("Cassandra ListPartitioning")) {
    name = "Cassandra (List-Based Partitioning)";
  } else if (label.includes("Cassandra RangePartitioning")) {
    name = "Cassandra (Range-Based Partitioning)";
  } else if (label.includes("Cassandra Centralized")) {
    name = "Cassandra Centralized";
  } else if (label.includes("MongoDB ListPartitioning")) {
    name = "MongoDB (List-Based Sharding)";
  } else if (label.includes("MongoDB RangePartitioning")) {
    name = "MongoDB (Range-Based Sharding)";
  } else if (label.includes("MongoDB Centralized")) {
    name = "MongoDB Centralized";
  } else if (label.includes("TimescaleDB ListPartitioning")) {
    name = "TimescaleDB (List-Based Partitioning)";
  } else if (label.includes("TimescaleDB RangePartitioning")) {
    name = "TimescaleDB (Range-Based Partitioning)";
  } else if (label.includes("TimescaleDB Centralized")) {
    name = "TimescaleDB Centralized";
  } else {
    name = label;
  }

  return `${name} [${location}]`;
};

const labelColorMap = {
  "MongoDB (List-Based Sharding) [Gebouw B]": "hsl(0, 80%, 50%)",
  "MongoDB (Range-Based Sharding) [Gebouw B]": "hsl(20, 80%, 50%)",
  "MongoDB Centralized [Gebouw A]": "hsl(40, 80%, 50%)",

  "Cassandra (List-Based Partitioning) [Gebouw B]": "hsl(120, 70%, 50%)",
  "Cassandra (Range-Based Partitioning) [Gebouw B]": "hsl(140, 70%, 50%)",
  "Cassandra Centralized [Gebouw A]": "hsl(160, 70%, 50%)",

  "TimescaleDB (List-Based Partitioning) [Gebouw B]": "hsl(240, 70%, 50%)",
  "TimescaleDB (Range-Based Partitioning) [Gebouw B]": "hsl(260, 70%, 50%)",
  "TimescaleDB Centralized [Gebouw A]": "hsl(280, 70%, 50%)",
};

const darkenColor = (hslColor) => {
  const hsl = hslColor.match(/^hsl\((\d+), (\d+)%, (\d+)%\)$/);
  if (hsl) {
    const lightness = Math.max(0, parseInt(hsl[3]) - 10);
    return `hsl(${hsl[1]}, ${hsl[2]}%, ${lightness}%)`;
  }
  return hslColor;
};

const groupByLabel = (data) => {
  return data.reduce((acc, entry) => {
    const key = normalizeLabel(entry.label);
    if (!acc[key]) acc[key] = [];
    acc[key].push(entry);
    return acc;
  }, {});
};

async function createBarChart(metric, data, outputFile) {
  let labels, values;

  labels = data.map(entry => normalizeLabel(entry.label));
  values = data.map(entry => entry.value);  

  const colors = labels.map(label => labelColorMap[label] || "hsl(0, 0%, 50%)");
  const borderColors = labels.map(label =>
    labelColorMap[label] ? darkenColor(labelColorMap[label]) : "hsl(0, 0%, 30%)"
  );

  const configuration = {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: metric,
          data: values,
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            generateLabels: (chart) => {
              return labels.map((label) => ({
                text: label,
                fillStyle: labelColorMap[label] || "hsl(0, 0%, 50%)",
              }));
            },
          },
        },
        title: {
          display: true,
          text: `${metric} Results`,
          font: {
            size: 24,
          },
        },
      },
      scales: {
        x: {
          display: false,
          ticks: { autoSkip: false, maxRotation: 45, minRotation: 45 },
        },
        y: {
          beginAtZero: true,
        },
      },
    },
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  fs.writeFileSync(outputFile, imageBuffer);
  console.log(`Chart saved: ${outputFile}`);
}

async function createPieChart(metric, data, outputFile) {
  const counts = data.reduce((acc, entry) => {
    if (entry.metric === metric && !isNumeric(entry.value)) {
      acc[entry.value] = (acc[entry.value] || 0) + 1;
    }
    return acc;
  }, {});

  const labels = Object.keys(counts);
  const values = Object.values(counts);

  const configuration = {
    type: 'pie',
    data: {
      labels,
      datasets: [
        {
          label: metric,
          data: values,
          backgroundColor: [
            'rgba(255, 99, 132, 0.6)',
            'rgba(54, 162, 235, 0.6)',
            'rgba(255, 206, 86, 0.6)',
            'rgba(75, 192, 192, 0.6)',
            'rgba(153, 102, 255, 0.6)',
          ],
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: true },
        title: { display: true, text: `${metric} Results` },
      },
    },
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  fs.writeFileSync(outputFile, imageBuffer);
  console.log(`Chart saved: ${outputFile}`);
}

const metrics = Array.from(new Set(testResults.map((entry) => entry.metric)));

(async () => {
  for (let rawMetric of metrics) {
    let metric = rawMetric;
    if (metric === "Realtime Latency") metric = "Latency";
    if (metric === "Realtime Throughput") metric = "Throughput";

    const data = testResults.filter((entry) => {
      if (entry.metric === rawMetric) {
        entry.metric = metric;
        return true;
      }
      return false;
    });
    const outputFile = path.join(outputDir, `${metric.replace(' ', '_')}.png`);
    if (metric !== "Offline Scenario") {
      await createBarChart(metric, data, outputFile);
    } else {
      await createPieChart(metric, data, outputFile);
    }
  }
})();