import { ChartRenderer } from '../../renderer/components/chart/ChartRenderer';
import { autoDetectAxes } from '../../renderer/components/chart/ChartControls';
import { ChartType } from 'chart.js';

interface ChartSpec {
  containerId?: string;
  canvas: HTMLCanvasElement;
  rows: any[];
  chartType: string; // 'bar' | 'line' | 'area' | 'pie' | 'doughnut' | 'stackedBar'
  xAxis?: string;
  yAxis?: string;
  title?: string;
}

/**
 * Global entrypoint attached to window for rendering inline chat charts.
 */
export function renderChatChart(spec: ChartSpec): ChartRenderer | null {
  const { canvas, rows, chartType, xAxis, yAxis, title } = spec;
  if (!canvas || !rows || rows.length === 0) return null;

  const columns = Object.keys(rows[0] || {});

  // Auto-detect axes if not specified
  let xAxisCol = xAxis;
  let yAxisCols: string[] = yAxis ? [yAxis] : [];

  if (!xAxisCol || yAxisCols.length === 0) {
    const detected = autoDetectAxes(columns, rows);
    if (!xAxisCol && detected.xAxis) {
      xAxisCol = detected.xAxis;
    }
    if (yAxisCols.length === 0 && detected.yAxes && detected.yAxes.length > 0) {
      yAxisCols = detected.yAxes;
    }
  }

  if (!xAxisCol || yAxisCols.length === 0) {
    console.warn('[ChatChart] Could not determine suitable X/Y axes for chart rendering');
    return null;
  }

  // Map requested chartType to ChartRenderer options
  let type: ChartType = 'bar';
  let fillArea = false;

  switch (chartType) {
    case 'line':
      type = 'line';
      break;
    case 'area':
      type = 'line';
      fillArea = true;
      break;
    case 'pie':
      type = 'pie';
      break;
    case 'doughnut':
      type = 'doughnut';
      break;
    case 'stackedBar':
    case 'bar':
    default:
      type = 'bar';
      break;
  }

  const renderer = new ChartRenderer(canvas);
  renderer.render(rows, {
    type,
    xAxisCol,
    yAxisCols,
    numericCols: yAxisCols,
    chartTitle: title || '',
  });

  return renderer;
}

// Attach to window object for webview script invocation
(window as any).renderChatChart = renderChatChart;
