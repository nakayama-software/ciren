/**
 * Hapus semua NodeConfig dari MongoDB — reset ke firmware defaults
 * Jalankan: node scripts/clear_node_configs.js
 */
require('dotenv').config()
const mongoose   = require('mongoose')
const NodeConfig = require('../src/models/NodeConfig')

async function main() {
  await mongoose.connect(process.env.MONGO_URI)
  console.log('[DB] Connected')

  const all = await NodeConfig.find().lean()
  if (all.length === 0) {
    console.log('[OK] NodeConfig collection is already empty — nothing to delete')
    process.exit(0)
  }

  console.log(`[INFO] Found ${all.length} NodeConfig record(s):`)
  for (const c of all) {
    console.log(`  device=${c.device_id}  ctrl=${c.ctrl_id}  port=${c.port_num}  interval=${c.interval_ms}ms`)
  }

  const { deletedCount } = await NodeConfig.deleteMany({})
  console.log(`[OK] Deleted ${deletedCount} record(s)`)
  process.exit(0)
}

main().catch(e => { console.error('[ERR]', e.message); process.exit(1) })
