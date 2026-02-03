import React, { useState } from "react";
import * as XLSX from "xlsx";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import "./App.css";

ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend
);

// ------------------ Components ------------------

function AISummary({ summary }) {
  return (
    <div className="ai-card">
      <h3>🤖 Intelligent Summary</h3>
      <ul>
        {summary.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function MetricCard({ kpi }) {
  return (
    <div className="metric-card">
      <h4>{kpi.column}</h4>
      <p className="metric-value">{kpi.avg}</p>
      <span className="metric-sub">
        Min {kpi.min} · Max {kpi.max}
      </span>
    </div>
  );
}

function Dashboard({ kpis }) {
  return (
    <div className="dashboard-grid">
      {kpis.map((kpi, i) => (
        <MetricCard key={i} kpi={kpi} />
      ))}
    </div>
  );
}

// ------------------ App ------------------

function App() {
  const [fileSummary, setFileSummary] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [aiSummary, setAISummary] = useState([]);
  const [loading, setLoading] = useState(false);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setLoading(true);
    const reader = new FileReader();

    reader.onload = (evt) => {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: "array" });
      analyzeWorkbook(workbook);
      setLoading(false);
    };

    reader.readAsArrayBuffer(file);
  };

  // ------------------ Analysis Logic ------------------

  const analyzeWorkbook = (workbook) => {
    const summaries = [];
    let numericValues = {};

    workbook.SheetNames.forEach((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: null });

      if (json.length === 0) return;

      summaries.push({
        sheetName,
        rows: json.length,
        columns: Object.keys(json[0]).length,
      });

      json.forEach((row) => {
        Object.entries(row).forEach(([key, value]) => {
          if (typeof value === "number" && !isNaN(value)) {
            numericValues[key] ??= [];
            numericValues[key].push(value);
          }
        });
      });
    });

    const generatedKPIs = Object.entries(numericValues).map(
      ([column, values]) => {
        const avg =
          values.reduce((a, b) => a + b, 0) / values.length;

        return {
          column,
          avg: avg.toFixed(2),
          min: Math.min(...values),
          max: Math.max(...values),
          count: values.length,
        };
      }
    );

    setFileSummary(summaries);
    setKpis(generatedKPIs);
    setAISummary(generateAISummary(generatedKPIs));
  };

  // ------------------ AI Summary Generator ------------------

  const generateAISummary = (kpis) => {
    const insights = [];

    if (kpis.length === 0) return insights;

    insights.push(
      `📊 Automatically analyzed ${kpis.length} numeric columns across all sheets.`
    );

    const highestAvg = [...kpis].sort((a, b) => b.avg - a.avg)[0];
    insights.push(
      `🏆 "${highestAvg.column}" has the highest average value (${highestAvg.avg}).`
    );

    kpis.forEach((kpi) => {
      if (kpi.max - kpi.min > kpi.avg * 2) {
        insights.push(
          `⚠️ "${kpi.column}" shows high variability between minimum and maximum values.`
        );
      }
    });

    insights.push(
      `🔒 All calculations were performed locally in your browser — no data uploaded.`
    );

    return insights;
  };

  // ------------------ Chart Data ------------------

  const topKPIs = [...kpis]
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5);

  const chartData = {
    labels: topKPIs.map((k) => k.column),
    datasets: [
      {
        label: "Average Value",
        data: topKPIs.map((k) => Number(k.avg)),
        backgroundColor: "#4f46e5",
      },
    ],
  };

  // ------------------ UI ------------------

  return (
    <div className="App" style={{ padding: 30 }}>
      <h1>📊 Excel Analyzer</h1>

      <p>
        🔒 <strong>Privacy First:</strong> All processing happens inside your
        browser.
      </p>

      <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} />

      {loading && <p>⏳ Analyzing file...</p>}

      {/* File Overview */}
      {fileSummary.length > 0 && (
        <>
          <h2>📄 File Overview</h2>
          <table>
            <thead>
              <tr>
                <th>Sheet</th>
                <th>Rows</th>
                <th>Columns</th>
              </tr>
            </thead>
            <tbody>
              {fileSummary.map((s, i) => (
                <tr key={i}>
                  <td>{s.sheetName}</td>
                  <td>{s.rows}</td>
                  <td>{s.columns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* AI Summary */}
      {aiSummary.length > 0 && <AISummary summary={aiSummary} />}

      {/* KPIs */}
      {kpis.length > 0 && (
        <>
          <h2>🚀 Auto-Generated KPIs</h2>
          <Dashboard kpis={kpis} />

          <h2>📈 Interactive Dashboard</h2>
          <Bar data={chartData} />
        </>
      )}
    </div>
  );
}

export default App;