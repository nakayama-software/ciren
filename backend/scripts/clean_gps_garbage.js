/**
 * Hapus GpsReading dengan node_id "garbage" (dari LoRa frame yang salah
 * di-parse sebagai GpsPacket sebelum magic/crc8 guard ditambahkan) —
 * node_id besar/acak seperti 2097699, 84226866, dll.
 *
 * Kriteria "valid" sama persis dengan guard di handleGpsData
 * (backend/src/mqtt/handler.js): node_id harus integer positif dan
 * <= GPS_NODE_ID_MAX (default 100, override lewat env kalau armada berkembang).
 *
 * Dry-run by default — hanya menampilkan apa yang AKAN dihapus.
 * Jalankan dengan --confirm untuk benar-benar menghapus.
 *
 *   node scripts/clean_gps_garbage.js            (dry run)
 *   node scripts/clean_gps_garbage.js --confirm   (hapus beneran)
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.config') })

const mongoose   = require('mongoose')
const GpsReading = require('../src/models/GpsReading')

const GPS_NODE_ID_MAX = Number(process.env.GPS_NODE_ID_MAX) || 100
const CONFIRM = process.argv.includes('--confirm')

async function main() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/ciren')
  console.log('[DB] Connected')

  // Mongo can't check "is integer" directly — pull every distinct node_id
  // first and classify in JS, then delete by the exact bad set.
  const distinctIds = await GpsReading.distinct('node_id')
  const badIds = distinctIds.filter(
    (id) => !Number.isInteger(id) || id < 1 || id > GPS_NODE_ID_MAX
  )
  const goodIds = distinctIds.filter((id) => !badIds.includes(id))

  console.log(`[INFO] node_id values in DB: valid=[${goodIds.join(', ')}]  garbage count=${badIds.length}`)
  if (badIds.length > 0) {
    console.log(`[INFO] garbage node_id sample: ${badIds.slice(0, 20).join(', ')}${badIds.length > 20 ? ', ...' : ''}`)
  }

  if (badIds.length === 0) {
    console.log('[OK] No garbage node_id found — nothing to delete')
    process.exit(0)
  }

  const matchCount = await GpsReading.countDocuments({ node_id: { $in: badIds } })
  console.log(`[INFO] ${matchCount} GpsReading document(s) match garbage node_id(s)`)

  if (!CONFIRM) {
    console.log('[DRY RUN] Nothing deleted. Re-run with --confirm to delete these documents.')
    process.exit(0)
  }

  const { deletedCount } = await GpsReading.deleteMany({ node_id: { $in: badIds } })
  console.log(`[OK] Deleted ${deletedCount} document(s)`)
  process.exit(0)
}

main().catch((e) => { console.error('[ERR]', e.message); process.exit(1) })
