import React, { useState, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  PointElement,
  LineElement,
  Filler
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import "./App.css";

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

// --- MATH & ANALYTICS ENGINE ---

const calculateMedian = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[half];
  return (sorted[half - 1] + sorted[half]) / 2.0;
};

const calculateStdDev = (values, avg) => {
  if (values.length === 0) return 0;
  const squareDiffs = values.map((value) => {
    const diff = value - avg;
    return diff * diff;
  });
  const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
  return Math.sqrt(avgSquareDiff);
};

const calculateCorrelation = (x, y) => {
  const n = x.length;
  if (n !== y.length || n === 0) return 0;
  
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
  const sumY2 = y.reduce((sum, yi) => sum + yi * yi, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX ** 2) * (n * sumY2 - sumY ** 2));

  if (denominator === 0) return 0; 
  return numerator / denominator;
};

const calculateTrend = (values) => {
  const n = values.length;
  if (n < 2) return { slope: 0, nextVal: 0, trend: 'stable' };

  const x = Array.from({ length: n }, (_, i) => i);
  const y = values;

  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
  const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return { slope: 0, nextVal: values[n-1], trend: 'stable' };

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  const nextVal = slope * n + intercept;
  const trendDirection = slope > 0.05 ? 'increasing' : slope < -0.05 ? 'decreasing' : 'stable';

  return { slope, intercept, nextVal, trendDirection };
};

const detectAnomalies = (values) => {
  if (values.length < 4) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length / 4)];
  const q3 = sorted[Math.floor(sorted.length * (3 / 4))];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  return values.filter(v => v < lowerBound || v > upperBound);
};

const generateInsights = (colName, values) => {
  const { slope, nextVal, trendDirection } = calculateTrend(values);
  const anomalies = detectAnomalies(values);
  
  const insights = [];

  if (trendDirection !== 'stable') {
    insights.push({
      type: 'trend',
      text: `${colName} shows a statistically significant ${trendDirection} trend over the dataset order.`,
      score: 'high'
    });
  }

  insights.push({
    type: 'prediction',
    text: `Based on linear regression, the forecasted value for the next entry is ${nextVal.toFixed(2)}.`,
    score: 'medium'
  });

  if (anomalies.length > 0) {
    insights.push({
      type: 'anomaly',
      text: `Detected ${anomalies.length} anomalies (outliers). Deviations may indicate errors or critical events.`,
      score: 'critical'
    });
  }

  return { insights, anomalies, nextVal, slope };
};

const performPivot = (data, rowDim, colDim, valDim, func) => {
  const rowKeys = new Set();
  const colKeys = new Set();
  const valuesMap = {}; 

  data.forEach((row) => {
    const rKey = rowDim === "None" ? "Total" : (row[rowDim] || "Unknown");
    const cKey = colDim === "None" ? "Total" : (row[colDim] || "Unknown");

    rowKeys.add(rKey);
    colKeys.add(cKey);

    if (!valuesMap[rKey]) valuesMap[rKey] = {};
    if (!valuesMap[rKey][cKey]) valuesMap[rKey][cKey] = [];

    const val = row[valDim];
    if (func === "Count" || typeof val === "number") {
      valuesMap[rKey][cKey].push(val); 
    }
  });

  const sortedRowKeys = Array.from(rowKeys).sort();
  const sortedColKeys = Array.from(colKeys).sort();
  const grid = {};
  
  sortedRowKeys.forEach(rKey => {
    grid[rKey] = {};
    sortedColKeys.forEach(cKey => {
      const vals = valuesMap[rKey]?.[cKey] || [];
      let result = 0;
      
      if (vals.length > 0) {
        switch (func) {
          case "Sum": result = vals.reduce((a, b) => a + b, 0); break;
          case "Average": result = vals.reduce((a, b) => a + b, 0) / vals.length; break;
          case "Count": result = vals.length; break;
          case "Max": result = Math.max(...vals); break;
          case "Min": result = Math.min(...vals); break;
          default: result = 0;
        }
      }
      grid[rKey][cKey] = parseFloat(result.toFixed(2));
    });
  });

  return { rowKeys: sortedRowKeys, colKeys: sortedColKeys, grid };
};

// --- COMPONENTS ---

function Sidebar({ activeTab, setActiveTab, hasData, onUpload }) {
  return (
    <div className="sidebar">
      <div className="brand">
        <div className="brand-icon">⚡</div>
        <div>
          <h2>AnalystPro</h2>
          <p>AI-Powered Analytics</p>
        </div>
      </div>
      
      <div className="upload-section">
        <label className="upload-btn">
          <span>+</span> Import Dataset
          <input type="file" accept=".xlsx,.xls" onChange={onUpload} hidden />
        </label>
      </div>

      <nav>
        <button className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => hasData && setActiveTab('dashboard')} disabled={!hasData}>
          <span className="icon">🚀</span> Executive Dashboard
        </button>
        <button className={activeTab === 'ai' ? 'active' : ''} onClick={() => hasData && setActiveTab('ai')} disabled={!hasData}>
          <span className="icon">🧠</span> AI Insights & Forecasts
        </button>
        <button className={activeTab === 'pivot' ? 'active' : ''} onClick={() => hasData && setActiveTab('pivot')} disabled={!hasData}>
          <span className="icon">🧩</span> Pivot Studio
        </button>
        <button className={activeTab === 'correlations' ? 'active' : ''} onClick={() => hasData && setActiveTab('correlations')} disabled={!hasData}>
          <span className="icon">🔗</span> Correlations
        </button>
        <button className={activeTab === 'data' ? 'active' : ''} onClick={() => hasData && setActiveTab('data')} disabled={!hasData}>
          <span className="icon">🔢</span> Data Inspector
        </button>
      </nav>
    </div>
  );
}

function DashboardView({ numericKPIs, categoricalKPIs, totalRows }) {
  return (
    <div className="view-container fade-in">
      <header className="view-header">
        <h1>Executive Overview</h1>
        <p>Summary of {totalRows} records analyzed.</p>
      </header>

      {/* KPI CARDS */}
      <div className="insights-grid">
        {numericKPIs.slice(0, 4).map((kpi, i) => (
          <div key={i} className="stat-card">
            <h4>{kpi.column}</h4>
            <div className="stat-value">{kpi.avg.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
            <div className="stat-sub">
              Median: {kpi.median.toLocaleString()} · σ {kpi.stdDev.toFixed(1)}
            </div>
          </div>
        ))}
      </div>

      <div className="charts-grid-mixed">
        {/* SEGMENT ANALYSIS (Top/Bottom) */}
        {categoricalKPIs.length > 0 && (
          <div className="chart-card wide">
            <h3>🏆 Top Performing Segments</h3>
            <div className="segment-list">
              {categoricalKPIs.slice(0, 2).map((cat, i) => (
                <div key={i} className="segment-group">
                  <h4>By {cat.column}</h4>
                  <div className="segment-row">
                    <span className="label top">Top</span>
                    <span className="val">{cat.topValues[0]?.name} ({cat.topValues[0]?.count})</span>
                  </div>
                  {cat.topValues.length > 1 && (
                     <div className="segment-row">
                     <span className="label bottom">Runner Up</span>
                     <span className="val">{cat.topValues[1]?.name} ({cat.topValues[1]?.count})</span>
                   </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* DISTRIBUTION CHART */}
        {numericKPIs.length > 0 && (
          <div className="chart-card">
            <h3>Distribution: {numericKPIs[0].column}</h3>
            <div className="chart-container-bar">
               <Bar 
                 data={{
                   labels: numericKPIs[0].rawData.slice(0, 10).map((_,i) => i), // Simplified binning for demo
                   datasets: [{ 
                     label: numericKPIs[0].column, 
                     data: numericKPIs[0].rawData.slice(0, 10), 
                     backgroundColor: '#6366f1' 
                    }]
                 }} 
                 options={{ maintainAspectRatio: false, plugins: { legend: {display:false} } }} 
               />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function AIInsightsView({ numericKPIs }) {
  // Use state to track selection
  const [selectedKPI, setSelectedKPI] = useState(numericKPIs.length > 0 ? numericKPIs[0].column : "");
  
  // FIX: Reset selection when new data is uploaded
  useEffect(() => {
    if (numericKPIs.length > 0) {
      setSelectedKPI(numericKPIs[0].column);
    }
  }, [numericKPIs]);

  const targetKPI = numericKPIs.find(k => k.column === selectedKPI) || numericKPIs[0];
  
  const { insights, anomalies, nextVal, slope } = useMemo(() => {
    if(!targetKPI) return { insights: [], anomalies: [], nextVal: 0, slope: 0 };
    return generateInsights(targetKPI.column, targetKPI.rawData);
  }, [targetKPI]);

  if (!targetKPI) return <div>No numeric data available for analysis.</div>;

  const chartData = {
    labels: [...Array(targetKPI.rawData.length).keys(), 'Forecast'],
    datasets: [
      {
        label: 'Historical',
        data: targetKPI.rawData,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        fill: true,
        tension: 0.4
      },
      {
        label: 'Trend Line',
        data: targetKPI.rawData.map((_, i) => (slope * i) + (targetKPI.avg - (slope * targetKPI.rawData.length/2))),
        borderColor: '#10b981',
        borderDash: [5, 5],
        pointRadius: 0
      },
      {
        label: 'Forecast',
        data: [...Array(targetKPI.rawData.length).fill(null), nextVal],
        borderColor: '#f43f5e',
        backgroundColor: '#f43f5e',
        pointRadius: 6,
        pointStyle: 'star'
      }
    ]
  };

  return (
    <div className="view-container fade-in">
      <header className="view-header">
        <h1>AI Insights & Forecasts</h1>
        <p>Automated pattern detection and predictive analytics.</p>
      </header>

      <div className="ai-controls">
         <label>Select Metric to Analyze:</label>
         <select value={selectedKPI} onChange={e => setSelectedKPI(e.target.value)}>
            {numericKPIs.map(k => <option key={k.column} value={k.column}>{k.column}</option>)}
         </select>
      </div>

      <div className="ai-grid">
        <div className="ai-card narrative-section">
          <h3>🤖 Intelligent Summary</h3>
          <div className="insight-list">
            {insights.map((insight, i) => (
              <div key={i} className={`insight-item ${insight.type}`}>
                <div className="insight-icon">
                  {insight.type === 'anomaly' ? '⚠️' : insight.type === 'prediction' ? '🔮' : '📈'}
                </div>
                <div className="insight-content">
                  <strong>{insight.type.toUpperCase()}</strong>
                  <p>{insight.text}</p>
                </div>
              </div>
            ))}
            {insights.length === 0 && <p>No significant trends or anomalies detected.</p>}
          </div>
        </div>

        <div className="ai-card chart-section">
          <h3>Predictive Model: {targetKPI.column}</h3>
          <div className="chart-wrapper-large">
            <Line data={chartData} options={{ responsive: true, maintainAspectRatio: false }} />
          </div>
        </div>
      </div>

       {anomalies.length > 0 && (
          <div className="ai-card full-width">
            <h3>⚠️ Anomaly Detected Data Points</h3>
            <div className="anomaly-chips">
              {anomalies.slice(0, 15).map((v, i) => (
                <span key={i} className="chip">{v.toLocaleString()}</span>
              ))}
              {anomalies.length > 15 && <span className="chip">+{anomalies.length - 15} more</span>}
            </div>
          </div>
        )}
    </div>
  );
}

function PivotView({ rawData, headers }) {
  const safeHeaders = headers && headers.length > 0 ? headers : [];
  const [rowDim, setRowDim] = useState(safeHeaders[0] || "None");
  const [colDim, setColDim] = useState("None");
  const [valDim, setValDim] = useState(safeHeaders.find(h => rawData[0] && typeof rawData[0][h] === 'number') || safeHeaders[0] || "None");
  const [func, setFunc] = useState("Sum");

  const { rowKeys, colKeys, grid } = useMemo(() => {
    if (!rawData || rawData.length === 0) return { rowKeys: [], colKeys: [], grid: {} };
    return performPivot(rawData, rowDim, colDim, valDim, func);
  }, [rawData, rowDim, colDim, valDim, func]);

  const chartData = useMemo(() => {
    const datasets = colKeys.map((cKey, index) => {
      const color = `hsl(${(index * 360) / colKeys.length}, 70%, 60%)`;
      return { 
        label: cKey, 
        data: rowKeys.map(rKey => grid[rKey][cKey] || 0), 
        backgroundColor: color 
      };
    });
    return { labels: rowKeys, datasets: datasets };
  }, [rowKeys, colKeys, grid]);

  return (
    <div className="view-container fade-in">
      <header className="view-header">
        <h1>Pivot Studio</h1>
        <p>Cross-tabulate data to compare two dimensions.</p>
      </header>

      <div className="pivot-controls">
        <div className="control-group"><label>Rows</label><select value={rowDim} onChange={(e) => setRowDim(e.target.value)}><option value="None">None</option>{safeHeaders.map(h => <option key={h} value={h}>{h}</option>)}</select></div>
        <div className="control-group"><label>Columns</label><select value={colDim} onChange={(e) => setColDim(e.target.value)}><option value="None">None</option>{safeHeaders.map(h => <option key={h} value={h}>{h}</option>)}</select></div>
        <div className="control-group"><label>Values</label><select value={valDim} onChange={(e) => setValDim(e.target.value)}>{safeHeaders.map(h => <option key={h} value={h}>{h}</option>)}</select></div>
        <div className="control-group"><label>Function</label><select value={func} onChange={(e) => setFunc(e.target.value)}><option value="Sum">Sum</option><option value="Average">Average</option><option value="Count">Count</option><option value="Max">Max</option><option value="Min">Min</option></select></div>
      </div>

      <div className="pivot-layout">
        <div className="pivot-table-container">
          <table className="data-table pivot-grid">
            <thead>
              <tr>
                <th className="pivot-corner">{rowDim} \ {colDim}</th>
                {colKeys.map(c => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rowKeys.map(rKey => (
                <tr key={rKey}>
                  <td className="pivot-row-label">{rKey}</td>
                  {colKeys.map(cKey => (
                    <td key={cKey}>{(grid[rKey][cKey] || 0).toLocaleString()}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pivot-chart-container">
          <Bar 
            data={chartData} 
            options={{ 
              responsive: true, 
              maintainAspectRatio: false,
              scales: { x: { stacked: true }, y: { stacked: true } },
              plugins: { title: { display: true, text: `${func} of ${valDim}` } } 
            }} 
          />
        </div>
      </div>
    </div>
  );
}

function CorrelationView({ numericKPIs }) {
  const matrix = useMemo(() => {
    const headers = numericKPIs.map(k => k.column);
    const grid = headers.map((rowName, i) => {
      return headers.map((colName, j) => {
        if (i === j) return 1;
        return calculateCorrelation(numericKPIs[i].rawData, numericKPIs[j].rawData);
      });
    });
    return { headers, grid };
  }, [numericKPIs]);

  const getColor = (value) => {
    const val = Math.abs(value);
    if (value === 1) return '#e0e7ff';
    if (value > 0) return `rgba(16, 185, 129, ${val})`;
    return `rgba(244, 63, 94, ${val})`;
  };

  return (
    <div className="view-container fade-in">
      <header className="view-header">
        <h1>Correlation Matrix</h1>
        <p>Pearson Correlation Coefficient (-1 to 1).</p>
      </header>
      <div className="matrix-wrapper">
        <table className="correlation-table">
          <thead>
            <tr><th></th>{matrix.headers.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {matrix.grid.map((row, i) => (
              <tr key={i}>
                <th>{matrix.headers[i]}</th>
                {row.map((val, j) => (
                  <td key={j} style={{ backgroundColor: getColor(val), color: Math.abs(val) > 0.5 ? '#fff' : '#000' }}>
                    {val.toFixed(2)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataTableView({ rawData }) {
  if (!rawData || rawData.length === 0) return <div>No Data</div>;
  const headers = Object.keys(rawData[0]);
  const previewData = rawData.slice(0, 100);

  return (
    <div className="view-container fade-in">
       <header className="view-header">
        <h1>Raw Data Inspector</h1>
        <p>Showing first 100 rows.</p>
      </header>
      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {previewData.map((row, i) => (
              <tr key={i}>{headers.map(h => <td key={h}>{row[h]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- MAIN APP ---

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [data, setData] = useState({ numeric: [], categorical: [], raw: [], headers: [] });
  const [hasData, setHasData] = useState(false);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const workbook = XLSX.read(bstr, { type: "binary" });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet);

      if (json.length > 0) processData(json);
    };
    reader.readAsBinaryString(file);
  };

  const processData = (json) => {
    const headers = Object.keys(json[0]);
    
    // FIX: Check first 50 rows to detect numeric columns reliably
    const numericCols = {};
    const catCols = {};

    headers.forEach(header => {
      let isNum = true;
      let checkCount = 0;
      for(let i=0; i < Math.min(json.length, 50); i++) {
        const val = json[i][header];
        if (val !== undefined && val !== null && val !== '') {
           checkCount++;
           if(isNaN(Number(val))) {
             isNum = false;
             break;
           }
        }
      }
      // If column is empty or has non-numbers, treat as categorical
      if (checkCount > 0 && isNum) {
        numericCols[header] = [];
      } else {
        catCols[header] = [];
      }
    });

    // Extract Data
    json.forEach(row => {
      headers.forEach(header => {
        if (numericCols.hasOwnProperty(header)) {
           numericCols[header].push(Number(row[header]) || 0);
        } else {
           catCols[header]?.push(String(row[header] || "N/A"));
        }
      });
    });

    const numericKPIs = Object.entries(numericCols).map(([col, values]) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      return {
        column: col,
        rawData: values,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: parseFloat(avg.toFixed(2)),
        median: parseFloat(calculateMedian(values).toFixed(2)),
        stdDev: parseFloat(calculateStdDev(values, avg).toFixed(2))
      };
    });

    const categoricalKPIs = Object.entries(catCols).map(([col, values]) => {
      const counts = {};
      values.forEach(v => counts[v] = (counts[v] || 0) + 1);
      const sorted = Object.entries(counts).sort((a,b) => b[1] - a[1]);
      return {
        column: col,
        topValues: sorted.slice(0, 5).map(([name, count]) => ({ name, count })),
        uniqueCount: sorted.length
      };
    });

    setData({ numeric: numericKPIs, categorical: categoricalKPIs, raw: json, headers: headers });
    setHasData(true);
  };

  return (
    <div className="App">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        hasData={hasData} 
        onUpload={handleFileUpload}
      />
      
      <main className="main-content">
        {!hasData ? (
          <div className="empty-state">
            <div className="pulse-circle">⚡</div>
            <h1>AnalystPro</h1>
            <p>Upload Excel for instant AI Analytics</p>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && <DashboardView numericKPIs={data.numeric} categoricalKPIs={data.categorical} totalRows={data.raw.length} />}
            {activeTab === 'ai' && <AIInsightsView numericKPIs={data.numeric} />}
            {activeTab === 'pivot' && <PivotView rawData={data.raw} headers={data.headers} />}
            {activeTab === 'correlations' && <CorrelationView numericKPIs={data.numeric} />}
            {activeTab === 'data' && <DataTableView rawData={data.raw} />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;