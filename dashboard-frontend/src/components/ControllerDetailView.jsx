import React, { useMemo, useState } from "react";
import { ArrowLeft, Battery, Wifi, Zap, Cpu } from "lucide-react";
import LineChartModal from "./charts/LineChartModal";
import IMU3DModal from "./charts/IMU3DModal";
import ResetPortModal from "./ResetPortModal";
import SensorRenderer from "./SensorRenderer";
import RotaryChartModal from "./charts/RotaryChartModal";

export default function ControllerDetailView({ controller, onBack, t }) {
    const [activeDetail, setActiveDetail] = useState(null);

    // console.log("controller : ",controller);

    const sensor_nodes_filtered = controller.sensor_nodes.filter(node => !node.sensor_data.includes("null"))
    // console.log("sensor_nodes_filtered : ",sensor_nodes_filtered);

    const hubId = useMemo(() => {
        return String(controller?.sensor_controller_id || "").trim();
    }, [controller]);

    const raspiId = useMemo(() => {
        return String(controller?.raspberry_serial_id || "").trim();
    }, [controller]);

    const closeDetail = () => setActiveDetail(null);

    const handleResetSuccess = (result) => {
        closeDetail();
    };

    return (
        <div className="rounded-2xl border border-black/10 bg-white/80 p-6 dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <div className="h-12 w-12 flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500">
                        <Cpu className="h-6 w-6 text-white" />
                    </div>
                    <div>
                        <h2 className="text-xl font-semibold">{controller.sensor_controller_id}</h2>
                        <p className="text-sm text-green-600 capitalize">
                            {controller.controller_status}
                        </p>
                    </div>
                </div>

                <button
                    onClick={onBack}
                    className="inline-flex items-center gap-2 border px-4 py-2 rounded-lg"
                >
                    <ArrowLeft className="h-4 w-4" />
                    <span>{t.controllerDetail.back}</span>
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <InfoBox icon={<Battery />} label={t.controllerDetail.battery} value={`${controller.battery_level}%`} />
                <InfoBox icon={<Wifi />} label={t.controllerDetail.signal} value={`${controller.signal_strength} dBm`} />
                <InfoBox icon={<Zap />} label={t.controllerDetail.sensorNodes} value={sensor_nodes_filtered.length} />
            </div>

            <h3 className="text-base font-medium mb-4">{t.controllerDetail.history}</h3>

            {sensor_nodes_filtered.length === 0 ? (
                <div className="border bg-yellow-500/10 p-3 text-yellow-800">
                    {t.controllerDetail.noNode}
                </div>
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
