import { ChartRenderer } from '../../renderer/components/chart/ChartRenderer';
import { autoDetectAxes } from '../../renderer/components/chart/ChartControls';

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

  // ChartRenderOptions.type is a plain string and ChartRenderer already handles
  // 'area' (line + fill) and 'stackedBar' (stacked bar scales) natively — no
  // need to collapse them into 'line'/'bar' here (that used to lose the
  // distinction entirely). Unrecognized values fall back to 'bar' there too.
  const renderer = new ChartRenderer(canvas);
  renderer.render(rows, {
    type: chartType || 'bar',
    xAxisCol,
    yAxisCols,
    numericCols: yAxisCols,
    chartTitle: title || '',
  });

  return renderer;
}

// Attach to window object for webview script invocation
(window as any).renderChatChart = renderChatChart;
