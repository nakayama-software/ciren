import React, { useMemo } from "react";
import { ArrowLeft, Zap, Cpu, Download } from "lucide-react";
import LineChartModal from "./charts/LineChartModal";
import IMU3DModal from "./charts/IMU3DModal";
import ResetPortModal from "./ResetPortModal";
import SensorRenderer from "./SensorRenderer";
import RotaryChartModal from "./charts/RotaryChartModal";
import LabelManager from "./LabelManager";
import MultiSensorView from "./MultiSensorView";
import ExportModal from "./ExportModal";
import AliasInlineEdit from "./AliasInlineEdit";
import { useState } from "react";

const NODE_STALE_MS = 30_000; // sesuai dengan Dashboard

// now dipass dari Dashboard agar sumber waktu konsisten dan tidak perlu timer sendiri
export default function ControllerDetailView({ controller, now, onBack, t }) {
    const [activeDetail, setActiveDetail] = useState(null);
    const [activeLabel,  setActiveLabel]  = useState(null);
    const [showExport,   setShowExport]   = useState(false);

    // console.log("datas t: ",t);
    

    const hubId = useMemo(
        () => String(controller?.sensor_controller_id || "").trim(),
        [controller]
    );
    const raspiId = useMemo(
        () => String(controller?.raspi_id || "").trim(),
        [controller]
    );

    // Filter node: hanya tampilkan yang punya data valid dan last_seen < 30 detik
    const sensor_nodes_filtered = controller.sensor_nodes.filter(
        (node) =>
            node.sensor_type && node.sensor_type !== 'null' &&
            node.value != null && node.value !== 'null' &&
            node.last_seen && (now - node.last_seen <= NODE_STALE_MS)
    );

    const closeDetail       = () => setActiveDetail(null);
    const handleResetSuccess = () => closeDetail();

    const handlePopOut = (sensor) => {
        setActiveLabel(null);
        const { port, sensor_type } = sensor;
        if (sensor_type === "imu") {
            setActiveDetail({ type: "imu3d", raspiId, hubId, portId: port, sensorTypeHint: sensor_type });
        } else if (sensor_type === "rotary_sensor") {
            setActiveDetail({ type: "rotary_sensor", raspiId, hubId, portId: port, sensorTypeHint: sensor_type });
        } else {
            setActiveDetail({ type: "line", raspiId, hubId, portId: port, sensorTypeHint: sensor_type });
        }
    };

    // console.log("sensor_nodes_filtered : ",sensor_nodes_filtered);

    return (
        <div className="rounded-2xl border border-black/10 bg-white/80 p-6 dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="h-12 w-12 flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500">
                        <Cpu className="h-6 w-6 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold">
                            <AliasInlineEdit
                                raspiId={raspiId}
                                controllerId={hubId}
                                originalName={hubId}
                                textClass="text-xl font-semibold"
                            />
                        </h2>
                        <p className="text-sm text-green-600 capitalize">{controller.controller_status}</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowExport(true)}
                        className="inline-flex items-center gap-2 border border-black/10 dark:border-white/10 px-3 py-2 rounded-lg text-sm text-slate-700 dark:text-gray-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    >
                        <Download className="h-4 w-4" />
                        <span className="hidden sm:inline">Export</span>
                    </button>
                    <button
                        onClick={onBack}
                        className="inline-flex items-center gap-2 border border-black/10 dark:border-white/10 px-4 py-2 rounded-lg text-sm"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span>{t.controllerDetail.back}</span>
                    </button>
                </div>
            </div>

            {/* Info boxes */}
            <div className="grid grid-cols-1 sm:grid-cols-1 gap-4 mb-6">
                <InfoBox icon={<Zap />} label={t.controllerDetail.sensorNodes} value={sensor_nodes_filtered.length} />
            </div>

            {/* Sensor grid */}
            <h3 className="text-base font-medium mb-4">{t.controllerDetail.history}</h3>

            {sensor_nodes_filtered.length === 0 ? (
                <div className="border bg-yellow-500/10 p-3 text-yellow-800">{t.controllerDetail.noNode}</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {sensor_nodes_filtered.map((node) => (
                        <SensorRenderer
                            key={`${hubId}-${node.node_id}`}
                            node={node}
                            hubId={hubId}
                            raspiId={raspiId}
                            onOpenDetail={(payload) => setActiveDetail(payload)}
                        />
                    ))}
                </div>
            )}

            {/* Analysis Labels */}
            <LabelManager
                raspiId={raspiId}
                hubId={hubId}
                sensor_nodes_filtered={sensor_nodes_filtered}
                onOpenLabel={(label) => setActiveLabel(label)}
            />

            {/* Modals */}
            <MultiSensorView
                open={!!activeLabel}
                onClose={() => setActiveLabel(null)}
                label={activeLabel}
                raspiId={raspiId}
                hubId={hubId}
                onPopOut={handlePopOut}
            />

            <ExportModal
                open={showExport}
                onClose={() => setShowExport(false)}
                raspiId={raspiId}
                hubId={hubId}
                sensor_nodes_filtered={sensor_nodes_filtered}
            />

            <LineChartModal
                open={activeDetail?.type === "line"}
                onClose={closeDetail}
                raspiId={controller?.raspi_id}
                hubId={activeDetail?.hubId}
                portId={activeDetail?.portId}
                sensorTypeHint={activeDetail?.sensorTypeHint}
            />
            <IMU3DModal
                open={activeDetail?.type === "imu3d"}
                onClose={closeDetail}
                raspiId={controller?.raspi_id}
                hubId={activeDetail?.hubId}
                portId={activeDetail?.portId}
                sensorTypeHint={activeDetail?.sensorTypeHint}
                node={sensor_nodes_filtered}
            />
            <RotaryChartModal
                open={activeDetail?.type === "rotary_sensor"}
                onClose={closeDetail}
                raspiId={controller?.raspi_id}
                hubId={activeDetail?.hubId}
                portId={activeDetail?.portId}
                sensorTypeHint={activeDetail?.sensorTypeHint}
                node={sensor_nodes_filtered}
            />
            <ResetPortModal
                open={activeDetail?.type === "reset"}
                onClose={closeDetail}
                raspiId={controller?.raspi_id}
                hubId={activeDetail?.hubId}
                portId={activeDetail?.portId}
                sensorType={activeDetail?.sensorTypeHint}
                onSuccess={handleResetSuccess}
            />
        </div>
    );
}

function InfoBox({ icon, label, value }) {
    return (
        <div className="rounded-xl border p-4 bg-white/70 dark:bg-slate-800/60">
            <div className="flex items-center gap-2 mb-1">
                {icon}
                <span className="text-xs text-gray-600">{label}</span>
            </div>
            <div className="text-xl font-semibold">{value}</div>
        </div>
    );
}