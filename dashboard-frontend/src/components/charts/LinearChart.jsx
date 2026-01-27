export default function LinearChart({}){
  // Chart.js data (klik legend otomatis hide/show dataset)
  const chartData = useMemo(() => {
    if (!rows.length) return { datasets: [] };

    if (isHumTemp) {
      const tempData = rows
        .map((r) => ({ x: r.ts, y: typeof r.temp === "number" ? r.temp : null }))
        .filter((p) => p.y !== null);

      const humData = rows
        .map((r) => ({ x: r.ts, y: typeof r.hum === "number" ? r.hum : null }))
        .filter((p) => p.y !== null);

      return {
        datasets: [
          {
            label: "Temperature (°C)",
            data: tempData,
            borderColor: "rgb(249,115,22)",
            backgroundColor: "rgba(249,115,22,0.15)",
            pointRadius: 0,
            tension: 0.25,
            spanGaps: true,
          },
          {
            label: "Humidity (%)",
            data: humData,
            borderColor: "rgb(59,130,246)",
            backgroundColor: "rgba(59,130,246,0.15)",
            pointRadius: 0,
            tension: 0.25,
            spanGaps: true,
          },
        ],
      };
    }

    const valueData = rows
      .map((r) => ({ x: r.ts, y: typeof r.value === "number" ? r.value : null }))
      .filter((p) => p.y !== null);

    return {
      datasets: [
        {
          label: `Value (${unitLabel})`,
          data: valueData,
          borderColor: "rgb(99,102,241)",
          backgroundColor: "rgba(99,102,241,0.15)",
          pointRadius: 0,
          tension: 0.25,
          spanGaps: true,
        },
      ],
    };
  }, [rows, isHumTemp, unitLabel]);

  const chartOptions = useMemo(() => {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false, // penting: biar update point gak terasa "reload"
      parsing: false,   // karena pakai {x,y}
      normalized: true,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: {
          display: true,
          position: "top",
          // Chart.js default: klik legend => hide/show dataset ✅
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const x = items?.[0]?.parsed?.x;
              return x ? new Date(x).toLocaleString() : "";
            },
            label: (item) => {
              const y = item?.parsed?.y;
              if (typeof y !== "number") return `${item.dataset.label}: -`;
              return `${item.dataset.label}: ${y.toFixed(2)}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          ticks: {
            callback: (value) => fmtTick(Number(value)),
            maxTicksLimit: 8,
          },
          grid: { display: true },
        },
        y: {
          ticks: {
            callback: (v) => String(v),
          },
          grid: { display: true },
        },
      },
    };
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[1000] bg-black/50 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-black/10 bg-white dark:bg-slate-900 dark:border-white/10 shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
          <div className="text-sm font-medium text-slate-900 dark:text-white">{title}</div>
          <button
            onClick={onClose}
            className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4">
          {loading && <div className="text-center text-sm text-gray-600 dark:text-gray-300">Loading…</div>}
          {err && !loading && <div className="text-center text-sm text-red-600 dark:text-red-400">{err}</div>}

          {!loading && !err && rows.length === 0 && (
            <div className="text-center text-sm text-gray-600 dark:text-gray-300">
              No data yet for this port.
            </div>
          )}

          {!loading && !err && rows.length > 0 && (
            <div className="h-[380px]">
              <Line data={chartData} options={chartOptions} />
              <div className="mt-2 text-[11px] text-gray-600 dark:text-gray-400">
                Points: {rows.length} • Unit: {unitLabel} • (Klik legend untuk hide/show)
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-black/10 dark:border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="text-sm rounded-md border border-black/10 dark:border-white/10 px-3 py-1 hover:bg-black/5 dark:hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}