// src/components/ControllerDetailView.jsx - IMPROVED VERSION
import React, { useState, useEffect } from "react";
import { ArrowLeft, Battery, Wifi, Zap, Cpu, Activity, Grid, List } from "lucide-react";
import SensorRenderer from "./SensorRenderer";

export default function ControllerDetailView({ controller, onBack, t }) {
    const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'
    const [filterType, setFilterType] = useState('all'); // 'all' or specific sensor type

    // Get unique sensor types
    const sensorTypes = [...new Set(controller.sensor_nodes.map(n => n.sensor_type))];


    // Filter nodes based on selected type
    const filteredNodes = filterType === 'all'
        ? controller.sensor_nodes
        : controller.sensor_nodes.filter(n => n.sensor_type === filterType);

    // Statistics
    const stats = {
        online: controller.sensor_nodes.filter(n => n.status === 'online').length,
        offline: controller.sensor_nodes.filter(n => n.status === 'offline').length,
        total: controller.sensor_nodes.length,
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="rounded-2xl border border-black/10 bg-white/80 p-6 dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="h-12 w-12 flex items-center justify-center rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-500">
                            <Cpu className="h-6 w-6 text-white" />
                        </div>
                        <div>
                            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">
                                Hub {controller.sensor_controller_id}
                            </h2>
                            <p className={`text-sm font-medium capitalize ${controller.controller_status === 'online'
                                    ? 'text-green-600 dark:text-green-400'
                                    : 'text-red-600 dark:text-red-400'
                                }`}>
                                {controller.controller_status}
                            </p>
                        </div>
                    </div>

                    <button
                        onClick={onBack}
                        className="inline-flex items-center gap-2 rounded-lg border border-black/10 
                                   bg-white/70 px-4 py-2 text-sm font-medium text-slate-900 
                                   hover:bg-black/5 dark:border-white/10 dark:bg-slate-800/60 
                                   dark:text-white dark:hover:bg-white/10"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        <span>{t.controllerDetail.back}</span>
                    </button>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    <InfoBox
                        icon={<Battery className="w-5 h-5" />}
                        label={t.controllerDetail.battery}
                        value={`${controller.battery_level}%`}
                        color={controller.battery_level > 50 ? 'green' : controller.battery_level > 20 ? 'yellow' : 'red'}
                    />
                    <InfoBox
                        icon={<Wifi className="w-5 h-5" />}
                        label={t.controllerDetail.signal}
                        value={`${controller.signal_strength} dBm`}
                        color="blue"
                    />
                    <InfoBox
                        icon={<Activity className="w-5 h-5" />}
                        label="Online Sensors"
                        value={`${stats.online}/${stats.total}`}
                        color="green"
                    />
                    <InfoBox
                        icon={<Zap className="w-5 h-5" />}
                        label="Ports Connected"
                        value={controller.ports_connected || controller.sensor_nodes.length}
                        color="indigo"
                    />
                </div>

                {/* Controls */}
                <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                    <div className="flex gap-2 overflow-x-auto pb-2 sm:pb-0">
                        <button
                            onClick={() => setFilterType('all')}
                            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${filterType === 'all'
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                    : 'bg-white/70 text-slate-700 border border-black/10 hover:bg-black/5 dark:bg-slate-800/60 dark:text-gray-300 dark:border-white/10'
                                }`}
                        >
                            All ({controller.sensor_nodes.length})
                        </button>
                        {sensorTypes.map(type => {
                            const count = controller.sensor_nodes.filter(n => n.sensor_type === type).length;
                            return (
                                <button
                                    key={type}
                                    onClick={() => setFilterType(type)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap capitalize transition-colors ${filterType === type
                                            ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                            : 'bg-white/70 text-slate-700 border border-black/10 hover:bg-black/5 dark:bg-slate-800/60 dark:text-gray-300 dark:border-white/10'
                                        }`}
                                >
                                    {type.replace('_', ' ')} ({count})
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => setViewMode('grid')}
                            className={`p-2 rounded-lg transition-colors ${viewMode === 'grid'
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                    : 'bg-white/70 text-slate-700 border border-black/10 hover:bg-black/5 dark:bg-slate-800/60 dark:text-gray-300'
                                }`}
                            title="Grid View"
                        >
                            <Grid className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setViewMode('list')}
                            className={`p-2 rounded-lg transition-colors ${viewMode === 'list'
                                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                    : 'bg-white/70 text-slate-700 border border-black/10 hover:bg-black/5 dark:bg-slate-800/60 dark:text-gray-300'
                                }`}
                            title="List View"
                        >
                            <List className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            </div>

            {/* Sensors Display */}
            <div className="rounded-2xl border border-black/10 bg-white/80 p-6 dark:border-white/10 dark:bg-slate-800/60 shadow-sm">
                <h3 className="text-base font-medium mb-4 text-slate-900 dark:text-white">
                    {t.controllerDetail.history}
                    {filterType !== 'all' && ` - ${filterType.replace('_', ' ')}`}
                </h3>

                {filteredNodes.length === 0 ? (
                    <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-6 text-center">
                        <p className="text-sm text-yellow-800 dark:text-yellow-200">
                            {filterType === 'all'
                                ? t.controllerDetail.noNode
                                : `No ${filterType.replace('_', ' ')} sensors found`
                            }
                        </p>
                    </div>
                ) : (
                    <div className={
                        viewMode === 'grid'
                            ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'
                            : 'space-y-3'
                    }>
                        {filteredNodes.map((node, i) => (
                            <SensorRenderer
                                key={i}
                                node={node}
                                hubId={controller.sensor_controller_id}
                                raspiId={controller.raspi_id}
                                viewMode={viewMode}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function InfoBox({ icon, label, value, color = 'gray' }) {
    const colorClasses = {
        green: 'text-green-600 dark:text-green-400 bg-green-500/10',
        yellow: 'text-yellow-600 dark:text-yellow-400 bg-yellow-500/10',
        red: 'text-red-600 dark:text-red-400 bg-red-500/10',
        blue: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
        indigo: 'text-indigo-600 dark:text-indigo-400 bg-indigo-500/10',
        gray: 'text-gray-600 dark:text-gray-400 bg-gray-500/10',
    };

    return (
        <div className="rounded-xl border border-black/10 bg-white/70 p-4 dark:border-white/10 dark:bg-slate-800/60">
            <div className={`flex items-center gap-2 mb-2 ${colorClasses[color]}`}>
                <div className="p-1.5 rounded-lg">
                    {icon}
                </div>
            </div>
            <div className="text-xl font-semibold text-slate-900 dark:text-white">{value}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 mt-1">{label}</div>
        </div>
    );
}
