import React from "react";
import { ArrowLeft, Battery, Wifi, Zap, Cpu } from "lucide-react";
import SensorRenderer from "./SensorRenderer";

export default function ControllerDetailView({ controller, onBack, t }) {
    // console.log("controller : ", controller);

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
                <InfoBox icon={<Zap />} label={t.controllerDetail.sensorNodes} value={controller.sensor_nodes.length} />
            </div>

            <h3 className="text-base font-medium mb-4">{t.controllerDetail.history}</h3>

            {controller.sensor_nodes.length === 0 ? (
                <div className="border bg-yellow-500/10 p-3 text-yellow-800">
                    {t.controllerDetail.noNode}
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {controller.sensor_nodes.map((node, i) => {
                        // console.log("2222",node);

                        return (
                            <SensorRenderer
                                key={i}
                                node={node}
                                hubId={controller.sensor_controller_id}
                                raspiId={controller.raspi_id}
                                t={t}
                            />
                        )
                    })}
                </div>
            )}
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
