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
import { Bar, Line, Pie } from "react-chartjs-2";
import "./App.css";

// ==========================================
// 0. CONFIGURATION & REGISTRATION
// ==========================================

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

// ==========================================
// 1. UTILITIES, MATH & FINANCIAL ENGINE
// ==========================================

const ExcelDateUtils = {
  // Heuristic: Excel dates usually fall between 32000 (1987) and 75000 (2105)
  isLikelyDate: (values) => {
    if (!values || values.length === 0) return false;
    let validCount = 0;
    const checkLimit = Math.min(values.length, 50);
    
    for(let i=0; i<checkLimit; i++) {
        const v = values[i];
        if (typeof v === 'number' && v > 32000 && v < 75000) {
            validCount++;
        }
    }
    return (validCount / checkLimit) > 0.8;
  },

  serialToDateStr: (serial) => {
    const utc_days  = Math.floor(serial - 25569);
    const utc_value = utc_days * 86400;                                      
    const date_info = new Date(utc_value * 1000);
    const year = date_info.getUTCFullYear();
    const month = String(date_info.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date_info.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
};

const FinancialEngine = {
  // PMT: Calculates loan payment
  PMT: (rate, nper, pv) => {
    if (rate === 0) return -(pv / nper);
    const pvif = Math.pow(1 + rate, nper);
    return (rate / (pvif - 1)) * -(pv * pvif);
  },
  // FV: Calculates future value
  FV: (rate, nper, pmt, pv) => {
    if (rate === 0) return -(pv + pmt * nper);
    const pvif = Math.pow(1 + rate, nper);
    return -pv * pvif - (pmt / rate) * (pvif - 1);
  }
};

const MathEngine = {
  calculateMedian: (values) => {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const half = Math.floor(sorted.length / 2);
    if (sorted.length % 2) return sorted[half];
    return (sorted[half - 1] + sorted[half]) / 2.0;
  },

  calculateStdDev: (values, avg) => {
    if (values.length === 0) return 0;
    const squareDiffs = values.map((value) => {
      const diff = value - avg;
      return diff * diff;
    });
    const avgSquareDiff = squareDiffs.reduce((a, b) => a + b, 0) / squareDiffs.length;
    return Math.sqrt(avgSquareDiff);
  },

  calculateCorrelation: (x, y) => {
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
  },

  calculateTrend: (values) => {
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
  },

  detectAnomalies: (values) => {
    if (values.length < 4) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length / 4)];
    const q3 = sorted[Math.floor(sorted.length * (3 / 4))];
    const iqr = q3 - q1;
    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;
    return values.filter(v => v < lowerBound || v > upperBound);
  },

  generateInsights: (colName, values) => {
    const { slope, nextVal, trendDirection } = MathEngine.calculateTrend(values);
    const anomalies = MathEngine.detectAnomalies(values);
    
    const insights = [];
    if (trendDirection !== 'stable') {
      insights.push({
        type: 'trend',
        text: `${colName} shows a statistically significant ${trendDirection} trend.`,
        score: 'high'
      });
    }
    insights.push({
      type: 'prediction',
      text: `Forecasted next value: ${nextVal.toFixed(2)}.`,
      score: 'medium'
    });
    if (anomalies.length > 0) {
      insights.push({
        type: 'anomaly',
        text: `Detected ${anomalies.length} outliers in the data distribution.`,
        score: 'critical'
      });
    }
    return { insights, anomalies, nextVal, slope };
  },

  performPivot: (data, rowDim, colDim, valDim, func) => {
    const rowKeys = new Set();
    const colKeys = new Set();
    const valuesMap = {}; 
  
    data.forEach((row) => {
      let rKey = "Total";
      if (rowDim !== "None") {
          const val = row[rowDim];
          if (val === undefined || val === null || val === "") return;
          rKey = val;
      }
  
      let cKey = "Total";
      if (colDim !== "None") {
          const val = row[colDim];
          if (val === undefined || val === null || val === "") return;
          cKey = val;
      }
  
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
  }
};

// ==========================================
// 2. DATA TRANSFORMATION ENGINE
// ==========================================

const DataTransformer = {
  removeDuplicates: (data) => {
    const seen = new Set();
    return data.filter(row => {
      const serialized = JSON.stringify(row);
      const isDuplicate = seen.has(serialized);
      seen.add(serialized);
      return !isDuplicate;
    });
  },

  handleMissingValues: (data, column, strategy) => {
    let cleanData = [...data];
    if (strategy === 'drop-row') {
      return cleanData.filter(row => row[column] !== undefined && row[column] !== null && row[column] !== '');
    }
    const numericValues = cleanData
      .map(r => Number(r[column]))
      .filter(v => !isNaN(v));
    const mean = numericValues.length ? numericValues.reduce((a,b)=>a+b,0)/numericValues.length : 0;
    return cleanData.map(row => {
      const val = row[column];
      const isMissing = val === undefined || val === null || val === '';
      if (isMissing) {
        let newVal = val;
        if (strategy === 'fill-zero') newVal = 0;
        else if (strategy === 'fill-mean') newVal = parseFloat(mean.toFixed(2));
        else if (strategy === 'fill-unknown') newVal = "Unknown";
        return { ...row, [column]: newVal };
      }
      return row;
    });
  },

  textToColumns: (data, column, delimiter) => {
    if (!delimiter) return data;
    return data.map(row => {
      const val = String(row[column] || "");
      const parts = val.split(delimiter);
      const newRow = { ...row };
      parts.forEach((part, index) => {
        newRow[`${column}_${index + 1}`] = part.trim();
      });
      return newRow;
    });
  },

  standardizeFormat: (data, column, type) => {
    return data.map(row => {
      let val = row[column];
      if (typeof val !== 'string') return row;
      if (type === 'uppercase') val = val.toUpperCase();
      if (type === 'lowercase') val = val.toLowerCase();
      if (type === 'trim') val = val.trim();
      if (type === 'capitalize') val = val.charAt(0).toUpperCase() + val.slice(1).toLowerCase();
      return { ...row, [column]: val };
    });
  },
  
  validateTypes: (data, headers) => {
    const report = {};
    headers.forEach(header => {
      let numCount = 0;
      let strCount = 0;
      data.forEach(row => {
        const val = row[header];
        if(!isNaN(Number(val)) && val !== "") numCount++;
        else if (val !== undefined && val !== null && val !== "") strCount++;
      });
      if (numCount > 0 && strCount > 0) {
        report[header] = `Mixed types: ${numCount} Numbers, ${strCount} Strings`;
      }
    });
    return report;
  }
};

// ==========================================
// 3. VIEW COMPONENTS
// ==========================================

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
          <span>+</span> New File
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
          <span className="icon">🧩</span> Pivot & Charts
        </button>
        <button className={activeTab === 'whatif' ? 'active' : ''} onClick={() => hasData && setActiveTab('whatif')} disabled={!hasData}>
          <span className="icon">⚖️</span> What-If & Financial
        </button>
        <button className={activeTab === 'correlations' ? 'active' : ''} onClick={() => hasData && setActiveTab('correlations')} disabled={!hasData}>
          <span className="icon">🔗</span> Correlations
        </button>
        <button className={activeTab === 'data' ? 'active' : ''} onClick={() => hasData && setActiveTab('data')} disabled={!hasData}>
          <span className="icon">🔢</span> Data & Formatting
        </button>
      </nav>
    </div>
  );
}

function DataCleaningView({ rawData, onConfirm, onCancel }) {
  const [data, setData] = useState(rawData);
  const [headers, setHeaders] = useState(Object.keys(rawData[0] || {}));
  const [selectedCol, setSelectedCol] = useState(null);
  const [history, setHistory] = useState([]);
  const [validationReport, setValidationReport] = useState({});

  useEffect(() => {
    if (data.length > 0) {
      setHeaders(Object.keys(data[0]));
      setValidationReport(DataTransformer.validateTypes(data, Object.keys(data[0])));
    }
  }, [data]);

  const pushHistory = () => {
    setHistory(prev => [...prev.slice(-4), [...data]]);
  };

  const handleUndo = () => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setData(previous);
    setHistory(prev => prev.slice(0, -1));
  };

  const applyTransform = (action, params = {}) => {
    pushHistory();
    let newData = [...data];

    switch(action) {
      case 'remove-duplicates':
        newData = DataTransformer.removeDuplicates(newData);
        break;
      case 'missing-vals':
        if (!selectedCol) return alert("Select a column first");
        newData = DataTransformer.handleMissingValues(newData, selectedCol, params.strategy);
        break;
      case 'text-to-columns':
        if (!selectedCol) return alert("Select a column first");
        const delimiter = prompt("Enter delimiter (e.g. , or - or space):");
        if(delimiter) newData = DataTransformer.textToColumns(newData, selectedCol, delimiter);
        break;
      case 'standardize':
        if (!selectedCol) return alert("Select a column first");
        newData = DataTransformer.standardizeFormat(newData, selectedCol, params.type);
        break;
      case 'delete-col':
        if (!selectedCol) return alert("Select a column first");
        newData = newData.map(row => {
          const { [selectedCol]: _, ...rest } = row;
          return rest;
        });
        setSelectedCol(null);
        break;
      default: break;
    }
    setData(newData);
  };

  return (
    <div className="cleaning-container fade-in">
      <header className="cleaning-header">
        <div>
          <h1>Data Preparation Studio</h1>
          <p>{data.length} Rows · {headers.length} Columns</p>
        </div>
        <div className="cleaning-actions">
           <button className="secondary" onClick={handleUndo} disabled={history.length===0}>↩ Undo</button>
           <button className="secondary" onClick={onCancel}>Cancel</button>
           <button className="primary" onClick={() => onConfirm(data)}>✅ Analyze Data</button>
        </div>
      </header>

      <div className="cleaning-toolbar">
        <div className="tool-group">
          <span>Global:</span>
          <button onClick={() => applyTransform('remove-duplicates')}>Remove Duplicates</button>
        </div>
        <div className="tool-group">
          <span>Selected Column ({selectedCol || "None"}):</span>
          <button disabled={!selectedCol} onClick={() => applyTransform('delete-col')}>🗑 Drop</button>
          
          <div className="dropdown">
            <button disabled={!selectedCol}>Fix Missing ▾</button>
            <div className="dropdown-content">
              <a onClick={() => applyTransform('missing-vals', {strategy: 'drop-row'})}>Drop Rows</a>
              <a onClick={() => applyTransform('missing-vals', {strategy: 'fill-zero'})}>Fill 0</a>
              <a onClick={() => applyTransform('missing-vals', {strategy: 'fill-mean'})}>Fill Mean</a>
            </div>
          </div>

          <div className="dropdown">
            <button disabled={!selectedCol}>Format ▾</button>
            <div className="dropdown-content">
              <a onClick={() => applyTransform('standardize', {type: 'trim'})}>Trim Whitespace</a>
              <a onClick={() => applyTransform('standardize', {type: 'uppercase'})}>UPPERCASE</a>
              <a onClick={() => applyTransform('standardize', {type: 'capitalize'})}>Capitalize</a>
            </div>
          </div>

          <button disabled={!selectedCol} onClick={() => applyTransform('text-to-columns')}>⑂ Text to Columns</button>
        </div>
      </div>

      {Object.keys(validationReport).length > 0 && (
         <div className="validation-banner">
           <strong>⚠️ Data Quality Issues Detected:</strong>
           {Object.entries(validationReport).map(([col, issue]) => (
             <span key={col} className="issue-tag">Column '{col}': {issue}</span>
           ))}
         </div>
      )}

      <div className="preview-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              {headers.map(h => (
                <th key={h} className={selectedCol === h ? 'selected-th' : ''} onClick={() => setSelectedCol(h)}>
                  {h}
                  {selectedCol === h && <span className="indicator"> ●</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 50).map((row, i) => (
              <tr key={i}>
                {headers.map(h => {
                   const val = row[h];
                   const isEmpty = val === null || val === undefined || val === "";
                   return (
                     <td key={h} className={isEmpty ? 'missing-cell' : ''}>
                       {isEmpty ? <span className="null-tag">NULL</span> : String(val)}
                     </td>
                   )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="table-footer">Showing first 50 rows preview</div>
      </div>
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
                </div>
              ))}
            </div>
          </div>
        )}
        {numericKPIs.length > 0 && (
          <div className="chart-card">
            <h3>Distribution: {numericKPIs[0].column}</h3>
            <div className="chart-container-bar">
               <Bar 
                 data={{
                   labels: numericKPIs[0].rawData.slice(0, 10).map((_,i) => i),
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
  const [selectedKPI, setSelectedKPI] = useState(numericKPIs.length > 0 ? numericKPIs[0].column : "");
  
  useEffect(() => {
    if (numericKPIs.length > 0) setSelectedKPI(numericKPIs[0].column);
  }, [numericKPIs]);

  const targetKPI = numericKPIs.find(k => k.column === selectedKPI) || numericKPIs[0];
  
  const { insights, anomalies, nextVal, slope } = useMemo(() => {
    if(!targetKPI) return { insights: [], anomalies: [], nextVal: 0, slope: 0 };
    return MathEngine.generateInsights(targetKPI.column, targetKPI.rawData);
  }, [targetKPI]);

  if (!targetKPI) return <div className="view-container">No numeric data available for analysis.</div>;

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
    </div>
  );
}

function PivotView({ rawData, headers }) {
  const safeHeaders = headers && headers.length > 0 ? headers : [];
  const [rowDim, setRowDim] = useState(safeHeaders[0] || "None");
  const [colDim, setColDim] = useState("None");
  const [valDim, setValDim] = useState(safeHeaders.find(h => rawData[0] && typeof rawData[0][h] === 'number') || safeHeaders[0] || "None");
  const [func, setFunc] = useState("Sum");
  const [chartType, setChartType] = useState("Bar"); 

  const { rowKeys, colKeys, grid } = useMemo(() => {
    if (!rawData || rawData.length === 0) return { rowKeys: [], colKeys: [], grid: {} };
    return MathEngine.performPivot(rawData, rowDim, colDim, valDim, func);
  }, [rawData, rowDim, colDim, valDim, func]);

  const chartData = useMemo(() => {
    const datasets = colKeys.map((cKey, index) => {
      const color = `hsl(${(index * 360) / colKeys.length}, 70%, 60%)`;
      return { 
        label: cKey, 
        data: rowKeys.map(rKey => grid[rKey][cKey] || 0), 
        backgroundColor: color,
        borderColor: color,
      };
    });
    return { labels: rowKeys, datasets: datasets };
  }, [rowKeys, colKeys, grid]);

  return (
    <div className="view-container fade-in">
      <header className="view-header">
        <h1>Pivot Tables & Charts</h1>
        <p>Cross-tabulate data and visualize relationships.</p>
      </header>
      <div className="pivot-controls">
        <div className="control-group"><label>Rows</label><select value={rowDim} onChange={(e) => setRowDim(e.target.value)}><option value="None">None</option>{safeHeaders.map(h => <option key={h} value={h}>{h}</option>)}</select></div>
        <div className="control-group"><label>Columns</label><select value={colDim} onChange={(e) => setColDim(e.target.value)}><option value="None">None</option>{safeHeaders.map(h => <option key={h} value={h}>{h}</option>)}</select></div>
        <div className="control-group"><label>Values</label><select value={valDim} onChange={(e) => setValDim(e.target.value)}>{safeHeaders.map(h => <option key={h} value={h}>{h}</option>)}</select></div>
        <div className="control-group"><label>Function</label><select value={func} onChange={(e) => setFunc(e.target.value)}><option value="Sum">Sum</option><option value="Average">Average</option><option value="Count">Count</option><option value="Max">Max</option><option value="Min">Min</option></select></div>
        <div className="control-group"><label>Chart Type</label><select value={chartType} onChange={(e) => setChartType(e.target.value)}><option value="Bar">Bar Chart</option><option value="Line">Line Chart</option><option value="Pie">Pie Chart (First Col)</option></select></div>
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
            {chartType === 'Bar' && <Bar data={chartData} options={{ responsive: true, maintainAspectRatio: false, scales: { x: { stacked: true }, y: { stacked: true } } }} />}
            {chartType === 'Line' && <Line data={chartData} options={{ responsive: true, maintainAspectRatio: false }} />}
            {chartType === 'Pie' && <Pie data={{ labels: rowKeys, datasets: [{ data: rowKeys.map(r => grid[r][colKeys[0]] || 0), backgroundColor: rowKeys.map((_,i) => `hsl(${i*30},70%,60%)`) }] }} options={{ maintainAspectRatio: false }} />}
        </div>
      </div>
    </div>
  );
}

function WhatIfView({ numericKPIs }) {
  const [selectedMetric, setSelectedMetric] = useState(numericKPIs[0]?.column || "");
  const [changePercent, setChangePercent] = useState(0);
  const [loanAmount, setLoanAmount] = useState(100000);
  const [interestRate, setInterestRate] = useState(5);
  const [termYears, setTermYears] = useState(30);

  const targetKPI = numericKPIs.find(k => k.column === selectedMetric);
  const currentTotal = targetKPI ? targetKPI.rawData.reduce((a,b)=>a+b,0) : 0;
  const newTotal = currentTotal * (1 + (changePercent/100));
  
  const monthlyPayment = FinancialEngine.PMT(interestRate/100/12, termYears*12, -loanAmount);

  return (
      <div className="view-container fade-in">
          <header className="view-header">
              <h1>What-If Analysis & Financials</h1>
              <p>Scenarios, Goal Seek simulations, and Financial Calculators.</p>
          </header>
          
          <div className="whatif-grid">
              <div className="ai-card">
                  <h3>⚖️ Sensitivity Analysis (Scenario)</h3>
                  <p>Adjust variables to see impact on Total Sum.</p>
                  <div className="control-group">
                      <label>Target Variable:</label>
                      <select value={selectedMetric} onChange={e => setSelectedMetric(e.target.value)}>
                           {numericKPIs.map(k => <option key={k.column} value={k.column}>{k.column}</option>)}
                      </select>
                  </div>
                  <div className="control-group">
                      <label>Change by %: {changePercent}%</label>
                      <input type="range" min="-50" max="50" value={changePercent} onChange={e => setChangePercent(Number(e.target.value))} />
                  </div>
                  <div className="scenario-result">
                      <div className="scenario-row">
                          <span>Current Total:</span>
                          <strong>{currentTotal.toLocaleString(undefined, {maximumFractionDigits:0})}</strong>
                      </div>
                      <div className="scenario-row">
                          <span>Projected Total:</span>
                          <strong style={{color: changePercent > 0 ? '#10b981' : '#f43f5e'}}>
                              {newTotal.toLocaleString(undefined, {maximumFractionDigits:0})}
                          </strong>
                      </div>
                  </div>
              </div>

              <div className="ai-card">
                  <h3>💰 Financial Calculator (PMT)</h3>
                  <p>Calculate Loan Payments or Returns.</p>
                  <div className="input-row">
                      <label>Loan Amount ($)</label>
                      <input type="number" value={loanAmount} onChange={e => setLoanAmount(Number(e.target.value))} />
                  </div>
                  <div className="input-row">
                      <label>Interest Rate (%)</label>
                      <input type="number" value={interestRate} onChange={e => setInterestRate(Number(e.target.value))} />
                  </div>
                  <div className="input-row">
                      <label>Term (Years)</label>
                      <input type="number" value={termYears} onChange={e => setTermYears(Number(e.target.value))} />
                  </div>
                  <div className="pmt-result">
                      <h4>Monthly Payment</h4>
                      <div className="big-number">${monthlyPayment.toLocaleString(undefined, {maximumFractionDigits:2})}</div>
                      <small>Total Interest: ${((monthlyPayment * termYears * 12) - loanAmount).toLocaleString(undefined, {maximumFractionDigits:0})}</small>
                  </div>
              </div>
          </div>
      </div>
  );
}

function DataTableView({ rawData, numericKPIs }) {
  const [useConditionalFormatting, setUseConditionalFormatting] = useState(false);
  
  if (!rawData || rawData.length === 0) return <div>No Data</div>;
  const headers = Object.keys(rawData[0]);
  const previewData = rawData.slice(0, 100);

  const limits = {};
  if(useConditionalFormatting && numericKPIs) {
      numericKPIs.forEach(kpi => {
          limits[kpi.column] = { min: kpi.min, max: kpi.max };
      });
  }

  const getCellStyle = (header, value) => {
      if (!useConditionalFormatting || !limits[header] || typeof value !== 'number') return {};
      const { min, max } = limits[header];
      if (max === min) return {};
      const ratio = (value - min) / (max - min);
      const hue = ratio * 120; // 0=Red, 120=Green
      return { backgroundColor: `hsla(${hue}, 70%, 50%, 0.3)` };
  };

  return (
    <div className="view-container fade-in">
       <header className="view-header">
        <h1>Raw Data Inspector</h1>
        <div className="header-controls">
            <label className="checkbox-label">
                <input type="checkbox" checked={useConditionalFormatting} onChange={e => setUseConditionalFormatting(e.target.checked)} />
                Enable Conditional Formatting (Heatmap)
            </label>
        </div>
      </header>
      <div className="table-responsive">
        <table className="data-table">
          <thead>
            <tr>{headers.map(h => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {previewData.map((row, i) => (
              <tr key={i}>{headers.map(h => (
                  <td key={h} style={getCellStyle(h, row[h])}>{row[h]}</td>
              ))}</tr>
            ))}
          </tbody>
        </table>
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
        return MathEngine.calculateCorrelation(numericKPIs[i].rawData, numericKPIs[j].rawData);
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

// ==========================================
// 4. MAIN APP COMPONENT
// ==========================================

function App() {
  const [appState, setAppState] = useState('upload'); // 'upload' | 'cleaning' | 'dashboard'
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [rawJSON, setRawJSON] = useState([]); 
  const [cleanData, setCleanData] = useState([]);
  
  const [analyticsData, setAnalyticsData] = useState({ numeric: [], categorical: [], raw: [], headers: [] });

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

      if (json.length > 0) {
        setRawJSON(json);
        setAppState('cleaning');
      }
    };
    reader.readAsBinaryString(file);
  };

  const handleCleaningComplete = (finalData) => {
    setCleanData(finalData);
    processData(finalData);
    setAppState('dashboard');
  };

  const processData = (json) => {
    if(!json || json.length === 0) return;
    
    // 1. Detect and Convert Dates
    const headers = Object.keys(json[0]);
    const dateColumns = new Set();
    
    headers.forEach(header => {
        const sampleValues = json.slice(0, 50).map(row => row[header]);
        if (ExcelDateUtils.isLikelyDate(sampleValues)) {
            dateColumns.add(header);
        }
    });

    if (dateColumns.size > 0) {
        json.forEach(row => {
            dateColumns.forEach(col => {
                if (typeof row[col] === 'number') {
                    row[col] = ExcelDateUtils.serialToDateStr(row[col]);
                }
            });
        });
    }

    // 2. Classify Columns
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
      if (checkCount > 0 && isNum) numericCols[header] = [];
      else catCols[header] = [];
    });

    json.forEach(row => {
      headers.forEach(header => {
        if (numericCols.hasOwnProperty(header)) {
           numericCols[header].push(Number(row[header]) || 0);
        } else {
           catCols[header]?.push(String(row[header] || "N/A"));
        }
      });
    });

    // 3. Calculate KPIs
    const numericKPIs = Object.entries(numericCols).map(([col, values]) => {
      const avg = values.reduce((a, b) => a + b, 0) / values.length;
      return {
        column: col,
        rawData: values,
        min: Math.min(...values),
        max: Math.max(...values),
        avg: parseFloat(avg.toFixed(2)),
        median: parseFloat(MathEngine.calculateMedian(values).toFixed(2)),
        stdDev: parseFloat(MathEngine.calculateStdDev(values, avg).toFixed(2))
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

    setAnalyticsData({ numeric: numericKPIs, categorical: categoricalKPIs, raw: json, headers: headers });
  };

  // State Routing
  if (appState === 'cleaning') {
    return (
      <DataCleaningView 
        rawData={rawJSON} 
        onConfirm={handleCleaningComplete} 
        onCancel={() => setAppState('upload')} 
      />
    );
  }

  return (
    <div className="App">
      <Sidebar 
        activeTab={activeTab} 
        setActiveTab={setActiveTab} 
        hasData={appState === 'dashboard'} 
        onUpload={handleFileUpload}
      />
      
      <main className="main-content">
        {appState === 'upload' ? (
          <div className="empty-state">
            <div className="pulse-circle">⚡</div>
            <h1>AnalystPro</h1>
            <p>Upload Excel to begin the Data Prep & Analysis Workflow</p>
            <label className="upload-btn-large">
              Select File
              <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} hidden />
            </label>
          </div>
        ) : (
          <>
            {activeTab === 'dashboard' && <DashboardView numericKPIs={analyticsData.numeric} categoricalKPIs={analyticsData.categorical} totalRows={analyticsData.raw.length} />}
            {activeTab === 'ai' && <AIInsightsView numericKPIs={analyticsData.numeric} />}
            {activeTab === 'pivot' && <PivotView rawData={analyticsData.raw} headers={analyticsData.headers} />}
            {activeTab === 'whatif' && <WhatIfView numericKPIs={analyticsData.numeric} />}
            {activeTab === 'correlations' && <CorrelationView numericKPIs={analyticsData.numeric} />}
            {activeTab === 'data' && <DataTableView rawData={analyticsData.raw} numericKPIs={analyticsData.numeric} />}
          </>
        )}
      </main>
    </div>
  );
}

export default App;