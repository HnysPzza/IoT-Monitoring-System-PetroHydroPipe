const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')

const registry = require('../src/shared/sensor-registry.json')

const backendRoot = path.resolve(__dirname, '..')
const migrationSql = fs.readFileSync(
  path.join(backendRoot, 'database', 'migrations', '008_harmonize_plant_sensor_labels.sql'),
  'utf8',
)

test('migration 008 aligns legacy sensor labels and is safe to reapply', async (t) => {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = await PGlite.create()
  t.after(() => db.close())

  await db.exec(`
    create table public.sensors (
      sensor_code text primary key,
      label text not null
    );

    insert into public.sensors (sensor_code, label) values
      ('S-01', 'Raw Material Detection'),
      ('S-02', 'Outside Filler'),
      ('S-03', 'Coil Joint'),
      ('S-04', 'Inside Filler'),
      ('S-05', 'Production Output Cutting'),
      ('S-99', 'Unrelated Sensor');
  `)

  await db.exec(migrationSql)
  await db.exec(migrationSql)

  const { rows } = await db.query(`
    select sensor_code, label
    from public.sensors
    order by sensor_code
  `)

  assert.deepEqual(rows, [
    ...registry.sensors.map(({ code, label }) => ({ sensor_code: code, label })),
    { sensor_code: 'S-99', label: 'Unrelated Sensor' },
  ])
  assert.match(migrationSql, /set local lock_timeout = '2s'/i)
})
