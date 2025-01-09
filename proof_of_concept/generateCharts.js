const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const fs = require('fs');
const path = require('path');

// File paths
const resultsFile = path.join(__dirname, 'testResults.json');
const outputDir = path.join(__dirname, 'charts');

// Check for file existence
if (!fs.existsSync(resultsFile)) {
  console.error(`File not found: ${resultsFile}`);
  process.exit(1);
}

const testResults = JSON.parse(fs.readFileSync(resultsFile, 'utf-8'));

// Ensure output directory exists
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}

const width = 800;
const height = 600;
const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

// Helper function to determine if a value is numeric
const isNumeric = (value) => !isNaN(parseFloat(value)) && isFinite(value);

// Function to create bar charts
async function createBarChart(metric, data, outputFile) {
  const combinedData = data.reduce((acc, entry) => {
    if (entry.metric === metric && isNumeric(entry.value)) {
      acc.labels.push(entry.label);
      acc.values.push(parseFloat(entry.value));
    }
    return acc;
  }, { labels: [], values: [] });

  const configuration = {
    type: 'bar',
    data: {
      labels: combinedData.labels,
      datasets: [
        {
          label: metric,
          data: combinedData.values,
          backgroundColor: 'rgba(75, 192, 192, 0.6)',
          borderColor: 'rgba(75, 192, 192, 1)',
          borderWidth: 1,
        },
      ],
    },
    options: {
      responsive: false,
      plugins: {
        legend: { display: true },
        title: { display: true, text: `${metric} Results` },
      },
      scales: {
        x: { ticks: { autoSkip: false, maxRotation: 45, minRotation: 45 } },
        y: { beginAtZero: true },
      },
    },
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  fs.writeFileSync(outputFile, imageBuffer);
  console.log(`Chart saved: ${outputFile}`);
}

// Function to create pie charts for qualitative data
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

// Generate charts for all metrics
const metrics = Array.from(new Set(testResults.map((entry) => entry.metric)));

(async () => {
  for (const metric of metrics) {
    const data = testResults.filter((entry) => entry.metric === metric);
    const hasNumericValues = data.some((entry) => isNumeric(entry.value));

    const outputFile = path.join(outputDir, `${metric.replace(' ', '_')}.png`);
    if (hasNumericValues) {
      await createBarChart(metric, data, outputFile);
    } else {
      await createPieChart(metric, data, outputFile);
    }
  }
})();