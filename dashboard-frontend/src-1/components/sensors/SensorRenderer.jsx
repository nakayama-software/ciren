import React from "react";
import TemperatureCard from "./TemperatureCard";
import HumidityCard from "./HumidityCard";
import PressureCard from "./PressureCard";
import LightIntensityCard from "./LightIntensityCard";
import UltrasonicCard from "./UltrasonicCard";
import InfraredCard from "./InfraredCard";
import IMUCard from "./IMUCard";
import GenericCard from "./GenericCard";

/**
 * Pemilih kartu berdasarkan sensor_type.
 * Input node WAJIB punya: { node_id, sensor_type, value, unit? }
 */
export default function SensorRenderer({ node }) {
  const type = String(node.sensor_type || "").toLowerCase();

  if (type === "temperature") return <TemperatureCard node={node} />;
  if (type === "humidity") return <HumidityCard node={node} />;
  if (type === "pressure") return <PressureCard node={node} />;
  if (type === "light_intensity" || type === "light-intensity" || type === "light") return <LightIntensityCard node={node} />;
  if (type === "ultrasonic") return <UltrasonicCard node={node} />;
  if (type === "infrared" || type === "pir") return <InfraredCard node={node} />;
  if (type === "imu") return <IMUCard node={node} />;

  return <GenericCard node={node} />;
}
